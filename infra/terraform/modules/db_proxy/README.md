# Módulo `db_proxy` — RDS Proxy em modo transação + bulkheads (P-41/RAD-165)

Materializa o **piso e o teto** da solução de pool decidida em **P-41** (arq/05 §6): um
**RDS Proxy em modo transação** por workload na frente do Aurora PostgreSQL. É o que segura
a explosão de conexões dos *workers* + do *seam* serverless (P-27) e isola a rajada da
ingestão do caminho crítico do alerta (DB3, "pool dedicado").

Refs: `arquitetura/05 §6` · `arquitetura/08 §§3,4` · `docs/98` P-41/P-27/P-64 · `arquitetura/09` (A09 tuning).

> **Estado (2026-07-10):** IaC **escrita e validada** (`tofu validate` verde). O `apply` +
> a coleta de evidência ficam **bloqueados junto do unblock de AWS** (mesma frente do
> Cognito RAD-134): não há conta/credenciais AWS do Radar neste ambiente. Ver seção **Pendente**.

## Por que "um proxy por pool"

`max_connections_percent` do RDS Proxy é **por proxy** — um único proxy = um único pool
compartilhado, e uma rajada de ingestão pode consumir todos os *backends* e **matar de
fome** o caminho do alerta. O bulkhead de P-41 exige isolamento **físico**: logo, **um
proxy por workload**. Cada `max_connections_percent` fatia o `max_connections=200` do
banco de modo que a **soma** dos pools fique `< 200` com folga de admin/superuser.

| Pool (P-41) | `default_pool_size` alvo | `max_connections_percent` | Papel |
|---|---|---|---|
| `ingestao` | 15 | 8 % | rajada de escrita/upsert (S1) |
| `matching` | 10 | 5 % | leitura/fan-out do alerta |
| `triagem` | 10 | 5 % | interativo/API — **protegido** |
| `analitico` | 5 | 3 % | range scans / reconciliação |
| `jobs` | 5 | 3 % | retenção/partição, fora de pico |

Soma ≈ **24 %** (~48 *backends* de 200) — folga enorme. `var.pools` é o mapa; **stacks
podem colapsar** (dev/staging → `ingestao` + `critical`) por **custo** (o RDS Proxy é
cobrado *por proxy*). O gate de validação recusa soma de percentuais `> 80 %`.

Os `statement_timeout`/`lock_timeout` **por pool** (30/10/5/60/300 s e 3 s) **não** cabem no
proxy — em modo transação não se fixa estado de sessão. Eles são aplicados **por role** no
bootstrap: `ALTER ROLE ingestao SET statement_timeout='30s'`, etc. O `db_parameter_group`
do módulo `database` guarda os **pisos globais** (`max_connections`, `work_mem=16MB`,
`idle_in_transaction=30s`, backstop de `statement_timeout`).

## A pegadinha do modo transação — o que **pina** a conexão

Modo transação multiplexa transações OLTP curtas sobre poucos *backends*. Qualquer estado
que **cruze** o limite da transação força o RDS Proxy a **fixar (pin)** a conexão àquele
cliente — a multiplexação some e o pool satura. **Não use, na app/worker:**

- ❌ `SET`/`SET SESSION` (estado de sessão) → use **`SET LOCAL`** (escopo de transação).
- ❌ `pg_advisory_lock()` (lock de **sessão**) → use **`pg_advisory_xact_lock()`** (de transação).
- ❌ *Prepared statement* **nomeado** que persista → ver guardrail do `node-pg` abaixo.
- ❌ `LISTEN`/`NOTIFY`, `WITH HOLD` cursor, `SET ROLE` não resetado, tabelas `TEMP` de sessão.

**Vigie `DatabaseConnectionsCurrentlySessionPinned`** — o módulo cria um alarme por proxy
(`threshold > 0`, 3×5 min). Pin sustentado é **bug de driver a caçar**, não ruído.

### Guardrails do driver `node-pg` (o único a cuidar — P-41)

O **field crypto** é AES-256-GCM em **nível de app** (cifra/decifra em JS, RAD-164): não
toca sessão do Postgres, **não pina**. O que pode pinar é o driver:

- **`node-postgres` usa *prepared statements* não-nomeados por padrão** (protocolo estendido
  sem `name`) → **não pina**. **Não** passe `name:` no objeto de query (isso cria um
  *named prepared statement* que pina). Nenhum adapter em `modules/*/src/infra` usa `name:` hoje.
- **Sem `client.query('SET ...')`** fora de transação. Timeout por statement vem da **role**
  (`ALTER ROLE`) ou de `SET LOCAL` dentro do `BEGIN`.
- **Pool do driver enxuto** (`pg.Pool` com `max` baixo) — o *fan-out* de conexões é papel do
  `max_client_conn` do proxy (alto), não do pool local do processo.
- `DATABASE_URL` **aponta para o endpoint do proxy** do pool correspondente, com `sslmode=require`
  (o proxy exige TLS) — **nunca** o endpoint do cluster.

## Config resolvida (valores para revisão)

| Requisito P-41 | Setting Terraform | Valor |
|---|---|---|
| Pooler em modo transação | `aws_db_proxy.engine_family` | `POSTGRESQL` (multiplexa por transação; sem toggle) |
| TLS cliente→proxy | `require_tls` | `true` |
| Auth proxy→banco | `auth.auth_scheme` | `SECRETS` (secret `{username,password}`) |
| Bulkhead por workload | 1 `aws_db_proxy` por `var.pools` | ingestao/matching/triagem/analitico/jobs |
| Fatia do pool | `connection_pool_config.max_connections_percent` | 8/5/5/3/3 % |
| Devolve backend ocioso | `idle_client_timeout` | 1800 s |
| Watch de pin | `aws_cloudwatch_metric_alarm` | `DatabaseConnectionsCurrentlySessionPinned > 0` |

## Pendente (unblock de AWS — mesma frente de RAD-134)

`terraform apply` + evidência (endpoints reais, teste de pin sob carga A09/RAD-162) seguem
bloqueados por falta de conta/credenciais AWS do Radar e do backend de estado remoto
(`radar-tf-state-<env>` + `radar-tf-lock`). Owner do unblock: **DevOps/Segurança**. Após o
apply: preencher o secret `db-credentials` com o par master real, construir o `DATABASE_URL`
de cada pool a partir do endpoint do proxy, e rodar o *tuning* fino sob carga (A09).
