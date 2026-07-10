# Módulo `serverless` — workers Lambda + reserved concurrency como teto (P-41/RAD-165)

Materializa o **teto** de P-41 no *tier* serverless: `reserved_concurrent_executions` por
função limita quantas invocações concorrem e, como cada invocação abre ~1 conexão pelo
RDS Proxy, **limita os backends do banco**. Para os workers dirigidos por SQS, o
`scaling_config.maximum_concurrency` espelha o teto na fila.

Refs: `arquitetura/08 §2` (compute por workload) · `docs/98` P-41/P-27/P-96/P-64.

## Este módulo é o *seam* de P-27 — hoje gated (off)

No **MVP-Now** os consumers **coabitam `apps/api`** (Fargate; P-96 item 4, `iniciarWorkers()`
gated por `WORKERS_ENABLED`). O *tier* Lambda é o **destino** quando A09 justificar o
isolamento (12-factor: separar *web dyno* de *consumer dyno*). Por isso os stacks o
instanciam com `enable_serverless_workers = false` por padrão — o grafo é **validado**
(`tofu validate`), mas nada é criado até a decisão de extrair o seam.

O valor entregue **agora**: os **tetos** (números de P-41) e o **wiring** (endpoint do
proxy, VPC, secrets, egress só p/ o SG do proxy) escritos e revisados; e o **gate de plan**
que recusa `soma(reserved_concurrency) > max_total_reserved_concurrency` — a invariante
"soma dos pools < `max_connections` com folga de admin" vira erro de `plan`, não surpresa
em produção.

## Mapeamento função → pool → teto (partida)

| Função | Pool do proxy | `reserved_concurrency` | Origem |
|---|---|---|---|
| `ingestao` | `ingestao` | 12 | agendada (EventBridge) — rajada do PNCP |
| `matching` | `matching` | 8 | fila `alertas-*` (fan-out do alerta) |
| `notificacao` | `matching`/`triagem` | 4 | fila de alertas gerados |

Soma = 24 ≤ `max_total_reserved_concurrency` (40) < `max_connections` (200). Números de
**partida**; *tuning* fino sob carga em A09/RAD-162.

## Invariantes de wiring

- `DB_PROXY_ENDPOINT` de cada função aponta ao **endpoint do proxy do seu pool**, nunca ao
  cluster (P-41). `DATABASE_URL_SECRET_ARN` é lido em runtime do Secrets Manager.
- SG do worker: **egress 5432 apenas para o SG do proxy** + 443 (Secrets/SQS/Bedrock).
- Handler `node-pg` segue os guardrails anti-*pin* do `db_proxy/README.md` (sem `SET` de
  sessão, sem *prepared statement* nomeado, `SET LOCAL`/`pg_advisory_xact_lock`).

## Pendente

`apply` bloqueado no mesmo unblock de AWS (RAD-134) **e** na extração real do seam (P-27):
`lambda_package_path` é placeholder até haver artefato de build dos workers. Owner do
unblock de infra: **DevOps/Segurança**; decisão de extrair o seam: **Eng/Artur** sob gatilho A09.
