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

Em modo transação não se fixa estado de sessão, então os `statement_timeout`/`lock_timeout`
**por pool** de P-41 vão nas **roles** (aplicados no connect, não pinam). Rodar uma vez:

```sql
-- Piso global já vem do parameter group (work_mem=16MB, idle_in_transaction=30s,
-- max_connections=200, statement_timeout backstop=300s). Aqui só o tightening por pool:
ALTER ROLE ingestao  SET statement_timeout = '30s'; ALTER ROLE ingestao  SET lock_timeout = '3s';
ALTER ROLE matching  SET statement_timeout = '10s';
ALTER ROLE triagem   SET statement_timeout = '5s';  ALTER ROLE triagem   SET lock_timeout = '3s';
ALTER ROLE analitico SET statement_timeout = '60s';
ALTER ROLE jobs      SET statement_timeout = '300s';
-- work_mem alto é SÓ no analítico, e por transação (não pina), no código: SET LOCAL work_mem='128MB';
-- autovacuum agressivo é por-tabela nas churn tables:
ALTER TABLE edital SET (autovacuum_vacuum_scale_factor = 0.02);
ALTER TABLE alerta SET (autovacuum_vacuum_scale_factor = 0.02);
```

Cada workload conecta com **sua role** (ou aponta o secret do seu pool a essa role) para
herdar o timeout. As roles são criadas nas migrações (Bento/DB).

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
