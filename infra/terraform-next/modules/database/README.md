# Módulo `database` — Postgres gerenciado (contrato neutro, RAD-181)

Primitiva A08 §4 "Postgres gerenciado". **Contrato** (`variables.tf`/`outputs.tf`) neutro;
**implementação** (`main.tf`) = RDS Aurora Serverless v2 (PG16). O binding vive só no
`main.tf` — trocar de provedor é reescrever este arquivo, mantendo o contrato.

## Contrato (o que o stack passa/consome — não vaza AWS)

| Input | Conceito | AWS |
|---|---|---|
| `project`, `env` | prefixo/ambiente | tag |
| `network_id`, `private_subnet_ids` | rede privada | VPC id, subnet ids |
| `db_name`, `db_username`, `db_password` | banco/credenciais | RDS master |
| `encryption_key_ref` | chave de cifra em repouso | KMS key ARN |
| `max_connections`, `statement_timeout_ms`, `lock_timeout_ms` | pisos P-41 | parâmetros PG |

| Output | Conceito | AWS |
|---|---|---|
| `cluster_endpoint`, `reader_endpoint` | endpoints (portáveis) | RDS endpoints |
| `cluster_ref` | handle do cluster | Aurora `cluster_identifier` |
| `firewall_group_ref` | grupo de firewall do banco | Security Group id |
| `parameter_group_name` | grupo de parâmetros (bound) | RDS parameter group |
| `max_connections` | teto de conexões (P-41) | valor PG |

## PRESERVAR (P-41 / LGPD) — a paridade prova que nada disto muda

- **Cifra em repouso** (`storage_encrypted=true`, `kms_key_id`) — LGPD 13.709/2018.
- **SG do banco sem ingress inline** — só o db_proxy adiciona o ingress 5432 (proxy-only).
- **Parameter group P-41** — `max_connections=200` (pending-reboot), `work_mem=16384`,
  `maintenance_work_mem=524288`, `idle_in_transaction_session_timeout=30000`,
  `statement_timeout=300000` (backstop), `lock_timeout=0` (global; 3 s por role nos quentes).
- **Serverless v2 scaling** — `min_capacity=0.5`; `max_capacity` 16 (prod) / 4 (não-prod).
- **`deletion_protection`/`backup_retention`** elevados em prod.

## Custo real de um exit (o irredutivelmente provider-bound)

Reescrever `main.tf` para GCP Cloud SQL / Azure DB for PostgreSQL exige:

- **Parameter group → flags do provedor.** Cloud SQL usa `database_flags`; Azure usa
  `azurerm_postgresql_flexible_server_configuration`. Os *nomes* de parâmetro PG
  (`work_mem`, `statement_timeout`…) são portáveis; o *recurso* que os carrega, não.
- **Serverless v2 (`db.serverless` + `serverlessv2_scaling_configuration`)** não tem
  equivalente 1:1 — Cloud SQL/AlloyDB e Azure Flexible escalam por tier/compute, não por ACU.
- **SG standalone + ingress externo** — o padrão "SG do banco sem ingress, proxy anexa
  depois" é AWS. Em GCP/Azure a regra proxy-only é firewall rule por tag / NSG.
- **`engine="aurora-postgresql"`, `engine_version="16.4"`, `kms_key_id`** — identificadores
  do provedor.

## Diferenças vs. `infra/terraform/modules/database` (paridade preservada)

- `vpc_id`→`network_id`, `subnet_ids`→`private_subnet_ids`, `kms_key_arn`→`encryption_key_ref`;
  outputs `cluster_id`→`cluster_ref`, `security_group_id`→`firewall_group_ref`. **Renome de
  identificador de contrato — mesmo valor, mesmo recurso, `plan` sem diff.**
- **Removido `vpc_cidr`** (input morto: nenhum recurso o usava depois do proxy-only). Remover
  input não referenciado = zero impacto de `plan`.
- `min_capacity = var.env=="prod" ? 0.5 : 0.5` simplificado para `0.5` (resolve idêntico).
