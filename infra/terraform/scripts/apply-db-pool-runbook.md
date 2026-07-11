# Runbook — aplicar o pool (RDS Proxy modo transação + reserved concurrency) · P-41/RAD-165/RAD-180

Materializa a decisão **P-41** na IaC: `modules/db_proxy` (RDS Proxy por workload) +
`modules/database` (parameter group com os pisos) + `modules/serverless` (reserved
concurrency dos workers, seam P-27). Refs: `arquitetura/05 §6`, `arquitetura/08 §§3,4`,
`docs/98` P-41/P-27/P-64.

## Estado

- **IaC:** escrita e **validada** (`tofu validate` verde nos 3 stacks). ✅ (RAD-180)
- **apply + evidência:** **BLOQUEADO** — mesmo unblock de AWS do Cognito (RAD-134): sem
  conta/credenciais AWS do Radar e sem backend de estado remoto neste ambiente.
  Owner do unblock: **DevOps/Segurança** (conta Radar + `radar-tf-state-<env>` + `radar-tf-lock`).

> ⚠️ Os perfis AWS presentes são `cs-*`/`chargescape-*` — de **outra empresa (ChargeScape)**.
> **Não** usar para infra do Radar (fronteira de tenant). Ver `apply-cognito-runbook.md`.

## Pré-requisitos (quando o AWS destravar)

1. Perfil AWS do Radar com permissão de `rds`, `secretsmanager`, `iam`, `lambda`, `ec2`, `cloudwatch`.
2. Backend de estado: bucket `radar-tf-state-<env>` + tabela `radar-tf-lock` (ver `backend.tf`).
3. KMS do ambiente (`var.kms_key_arn`) já provisionada.

## Ordem de aplicação

O RDS Proxy depende do cluster e do secret de credenciais. O `apply` do stack já resolve a
ordem pelo grafo, mas o **preenchimento dos secrets** é manual (placeholders com
`ignore_changes`):

```bash
export PATH="/tmp/opentofu:$PATH"   # ou tofu no PATH
cd infra/terraform/stacks/staging   # idem dev/prod
tofu init            # com backend real
tofu plan  -out tfplan
tofu apply tfplan
```

1. **Preencher `db-credentials`** com o par master real do cluster (o mesmo `db_username`/
   `db_password` passados ao módulo `database`):
   ```bash
   aws secretsmanager put-secret-value \
     --secret-id /radar/staging/db-credentials \
     --secret-string '{"username":"<master>","password":"<senha>"}'
   ```
   O RDS Proxy autentica proxy→banco por este secret (`auth_scheme=SECRETS`).

   > **Hardening (follow-up):** `manage_master_user_password=true` no `aws_rds_cluster`
   > mantém a senha master **fora do tfstate** e cria um secret gerenciado que o proxy pode
   > referenciar direto — elimina o placeholder manual. Fora do escopo mínimo de RAD-180
   > (o par master já vinha de `db_username`/`db_password`); avaliar no unblock.

   > **Migração/roles agora vão pelo proxy:** o SG do banco é **proxy-only** (P-41). Rode as
   > migrações e o `ALTER ROLE`/`ALTER TABLE` conectando ao **endpoint do proxy** (pool
   > `jobs`/`triagem`), ou abra uma regra de bastion temporária no SG do banco.

2. **Construir o `DATABASE_URL` de cada pool a partir do endpoint do proxy** — nunca o do
   cluster (P-41). `tofu output db_proxy_endpoints` dá o mapa pool→endpoint:
   ```bash
   tofu output -json db_proxy_endpoints
   # DATABASE_URL do caminho interativo/API (pool triagem):
   #   postgresql://<user>:<pass>@<endpoint-triagem>:5432/radar?sslmode=require
   ```
   `sslmode=require` é obrigatório (o proxy tem `require_tls=true`). O HOST muda por
   workload: ingestão→proxy `ingestao`, matching→`matching`, API/Fargate→`triagem`.

## Timeouts POR POOL (o que o parameter group **não** carrega)

O parameter group carrega os **pisos globais** (`work_mem=16MB`, `idle_in_transaction=30s`,
`max_connections=200`, `statement_timeout` backstop=300s, `lock_timeout=0`). O **tightening
por pool** de P-41 (30/10/5/60/300 s e `lock_timeout=3s` nos quentes) é **app-side** — e tem
uma **pegadinha**: como todo backend passa pelo mesmo secret de auth do proxy, `ALTER ROLE`
**não** basta a menos que o proxy autentique **como aquela role** (ver mecanismo B).

### Mecanismo A (recomendado) — `SET LOCAL` por transação (pin-safe, P-41-blessed)

`SET LOCAL` tem escopo de transação — **não pina** (é exatamente o permitido em modo
transação). O worker sabe seu pool (env `WORKLOAD_POOL`) e abre cada unidade de trabalho com:

```sql
BEGIN;
SET LOCAL statement_timeout = '10s';   -- valor do pool (matching=10s, triagem=5s, ...)
SET LOCAL lock_timeout      = '3s';    -- só nos pools quentes (ingestao/triagem)
-- ... o trabalho ...
COMMIT;
```

Leitura interativa autocommit (API) que hoje não abre transação explícita: envolver o SELECT
num `BEGIN…COMMIT` de leitura, ou herdar o piso via role (mecanismo B). O analítico sobe
`SET LOCAL work_mem='128MB'` aqui — nunca global.

### Mecanismo B (opcional) — role por pool + secret por pool no proxy

Se preferir o timeout **no connect** (sem tocar o driver), crie uma role por pool com
`ALTER ROLE` e faça o **proxy autenticar como ela**: passe `secret_arn` por pool em
`var.pools` (cada secret = `{username: "<role>", password: ...}`). O módulo registra esse
secret no `auth` do proxy do pool e amplia a policy de leitura de secret automaticamente.

Roles + `ALTER ROLE` são **executáveis**, não só prosa —
`infra/terraform/scripts/bootstrap-db-roles.sql` (RAD-191, idempotente, testado no
Testcontainers de `tests/db-stress`):

```bash
psql "$DATABASE_URL_MASTER" -f infra/terraform/scripts/bootstrap-db-roles.sql
```

O script cria as 5 roles e roda:

```sql
ALTER ROLE ingestao  SET statement_timeout = '30s'; ALTER ROLE ingestao SET lock_timeout = '3s';
ALTER ROLE matching  SET statement_timeout = '10s';
ALTER ROLE triagem   SET statement_timeout = '5s';  ALTER ROLE triagem  SET lock_timeout = '3s';
ALTER ROLE analitico SET statement_timeout = '60s';
ALTER ROLE jobs      SET statement_timeout = '300s';
```

Senha de cada role fica **fora do script** (nunca hardcoded) — ver o próprio arquivo para o
comando de geração + onde registrar em `var.pools[<pool>].secret_arn`.

> ⚠️ Sem o secret por pool (mecanismo B), TODO backend loga como master e os `ALTER ROLE`
> **não surtem efeito** — use o mecanismo A. Não confie em `SET ROLE` pós-connect (pina).

Autovacuum agressivo é **por-tabela** nas tabelas quentes (migrações — RAD-191, aplica no
unblock, testado no Testcontainers de `tests/db-stress`), não global:

- `modules/ingestao/src/infra/migrations/003_autovacuum_edital.sql` — `EDITAL`:
  `autovacuum_vacuum_scale_factor`/`analyze_scale_factor = 0.02` + `fillfactor = 90`
  (churn de upsert).
- `modules/matching/src/infra/migrations/004_autovacuum_alerta.sql` — `ALERTA`: mesmos
  scale factors (sem fillfactor — insert-only).
- `modules/triagem/src/infra/migrations/002_extracao_edital_toast_gin.sql` —
  `EXTRACAO_EDITAL`: `toast_tuple_target = 128` + índice GIN/tsvector do `objeto`
  (`fastupdate`/`gin_pending_list_limit`, documento 11 §5).

Ambas as migrações de `EDITAL`/`ALERTA` lidam com a tabela particionada (P-39): Postgres
recusa storage parameters no pai particionado, então o `DO $$ ... $$` de cada migração
aplica em cada partição folha.

## Guardrails anti-pin no driver (node-pg) — P-41 "pegadinha"

Ver `modules/db_proxy/README.md`. Resumo: sem `SET` de sessão, sem *prepared statement*
**nomeado** (não passe `name:` na query), sem `pg_advisory_lock` de sessão (use
`pg_advisory_xact_lock`), sem `LISTEN/NOTIFY`. **Field crypto é app-level (AES-256-GCM em
JS) — não toca sessão, não pina.**

## Evidência (coletar no apply)

1. `tofu output db_proxy_endpoints` — endpoints reais dos pools.
2. `tofu output db_pool_backends_reservados` — confirmar `< 200` com folga.
3. **Pin = 0** sob operação normal:
   ```bash
   aws cloudwatch get-metric-statistics --namespace AWS/RDS \
     --metric-name DatabaseConnectionsCurrentlySessionPinned \
     --dimensions Name=ProxyName,Value=radar-staging-triagem \
     --start-time <t0> --end-time <t1> --period 300 --statistics Maximum
   ```
   O módulo já cria alarme por proxy (`*-session-pinned`, threshold > 0).
4. **Bulkhead sob carga (A09/RAD-162):** rajada de ingestão **não** derruba o p95 do pool
   `triagem`/`matching` (caminho do alerta). É o *tuning* fino que fecha DB3/DB5.

## Seam serverless (P-27) — quando extrair

Hoje os workers coabitam `apps/api` (Fargate, P-96, `WORKERS_ENABLED`). O módulo
`serverless` fica gated (`enable_serverless_workers=false`). Ao extrair (gatilho A09):
empacotar os handlers, apontar `lambda_package_path`, `enable_serverless_workers=true`,
`enabled=true`. O gate de plan já recusa `soma(reserved_concurrency) > 40` (folga sobre 200).
