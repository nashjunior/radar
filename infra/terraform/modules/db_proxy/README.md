# Módulo `db_proxy` — pool de conexão gerenciado (contrato neutro, RAD-181)

Primitiva A08 §4 "Pool de conexão". **Contrato** neutro; **implementação** = RDS Proxy modo
transação + bulkheads por workload (P-41/RAD-165). Este é o módulo **mais** provider-bound do
repo — por isso a seção de exit-cost abaixo é a maior: expor o custo é honestidade de
arquitetura, não neutralizá-lo (A08 §6). A decisão P-41 permanece intacta; a paridade prova.

## Contrato (não vaza AWS)

| Input | Conceito | AWS |
|---|---|---|
| `project`, `env`, `region` | prefixo/ambiente/região | tag, `kms:ViaService` |
| `network_id`, `network_cidr`, `private_subnet_ids` | rede privada | VPC id/cidr, subnets |
| `cluster_ref` | handle do cluster fronteado | Aurora `cluster_identifier` |
| `db_firewall_group_ref` | grupo de firewall do banco (anexa ingress proxy-only) | Security Group id |
| `db_credentials_secret_ref` | secret {user,pass} da auth proxy→banco | Secrets Manager ARN |
| `encryption_key_ref` | chave que cifra o secret | KMS key ARN |
| `db_max_connections` | teto de conexões (base do rateio P-41) | valor PG |
| `pools` | bulkheads por workload | 1 RDS Proxy por entrada |
| `session_pinned_threshold`, `alarm_topic_ref`, `debug_logging` | observabilidade | CloudWatch/SNS |

| Output | Conceito | AWS |
|---|---|---|
| `proxy_endpoints` | mapa pool→endpoint (portável) | RDS Proxy endpoint |
| `proxy_refs` | mapa pool→handle | RDS Proxy ARN |
| `firewall_group_ref` | grupo de firewall do proxy | Security Group id |
| `backends_reservados` | soma de backends reservados (gate P-41) | valor computado |

## PRESERVAR (P-41 / LGPD) — a paridade prova que nada disto muda

- **Um proxy por pool** (`for_each var.pools`) — bulkhead físico; `max_connections_percent`
  8/5/5/3/3 (soma ≤ 80%, gate). Isolamento da rajada de ingestão vs. caminho do alerta.
- **Modo transação** (`engine_family=POSTGRESQL`, nativo) + `require_tls=true` (dado em
  trânsito cifrado) + auth `SECRETS` (secret master ou role por pool).
- **`idle_client_timeout=1800`**, `max_idle=max_connections_percent` (backends quentes),
  `connection_borrow_timeout=120`.
- **Enforce proxy-only** — `aws_vpc_security_group_ingress_rule.db_from_proxy`: o único
  caminho 5432 ao cluster é do SG do proxy (P-41 fechada na rede, não por convenção).
- **Alarme de pin** por proxy (`DatabaseConnectionsCurrentlySessionPinned > 0`, 3×5 min).

## Custo real de um exit (o irredutivelmente provider-bound)

Trocar RDS Proxy por Cloud SQL Auth Proxy / pgbouncer (GCP) ou pgbouncer no Flexible Server
(Azure) — A08 §4 lista os equivalentes, mas o `main.tf` reescreve **muito**:

- **Rateio por percentual → por número absoluto.** `max_connections_percent` é RDS-Proxy.
  pgbouncer configura `default_pool_size`/`max_client_conn` em números. O *bulkhead* (um
  pool por workload) é portável; a *unidade* (percent vs. count) não — daí `pools` manter a
  intenção mas o percentual ser provider-bound.
- **Anti-pin do modo transação** é próprio do multiplexador: em pgbouncer é `pool_mode =
  transaction` + as mesmas disciplinas de driver; a **métrica** de pin
  (`DatabaseConnectionsCurrentlySessionPinned`) e o **alarme** são CloudWatch — sem
  equivalente 1:1.
- **Wiring SG→SG** (`referenced_security_group_id`) que fecha o proxy-only é AWS. GCP =
  firewall rules por *service account/tag*; Azure = NSG. A invariante "só o proxy alcança o
  banco" é portável; a *mecânica* que a implementa, não.
- **IAM role + `kms:ViaService` + auth `SECRETS`** — o modelo de identidade do proxy é AWS
  (IAM/STS/Secrets Manager). GCP usa service account + Secret Manager; Azure usa Managed
  Identity + Key Vault.
- **`aws_db_proxy` / `aws_db_proxy_default_target_group` / `aws_db_proxy_target`** — trio de
  recursos específico do RDS Proxy.

## A pegadinha do modo transação (o que PINA) — resumo

Estado que cruza o limite da transação força o pin e derrota a multiplexação. Na app/worker:
`SET LOCAL` (não `SET`), `pg_advisory_xact_lock` (não de sessão), **sem** prepared statement
nomeado (não passe `name:` no `node-pg`), sem `LISTEN`/`NOTIFY`/`WITH HOLD`. O field crypto
AES-256-GCM é app-side (JS) e **não pina**. Detalhe e runbook: ver o README equivalente em
`infra/terraform/modules/db_proxy/README.md` (migrar na conclusão do rewrite, RAD-182).

## Diferenças vs. `infra/terraform/modules/db_proxy` (paridade preservada)

Renome de contrato — mesmo valor, mesmo recurso, `plan` sem diff:
- `aws_region`→`region`, `vpc_id`→`network_id`, `vpc_cidr`→`network_cidr`,
  `subnet_ids`→`private_subnet_ids`, `db_cluster_id`→`cluster_ref`,
  `db_security_group_id`→`db_firewall_group_ref`,
  `db_credentials_secret_arn`→`db_credentials_secret_ref`, `kms_key_arn`→`encryption_key_ref`,
  `alarm_sns_topic_arn`→`alarm_topic_ref`; no `pools`, `secret_arn`→`secret_ref`.
- Outputs `proxy_arns`→`proxy_refs`, `security_group_id`→`firewall_group_ref`.
