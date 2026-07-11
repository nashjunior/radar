# Módulo `serverless` — workers serverless com teto de concorrência P-41 (RAD-181/RAD-182)

Seam P-27: workers Lambda com `reserved_concurrent_executions` como TETO de conexões ao
banco (P-41). Gated off (`enabled=false`, `count=0`) no MVP-Now — workers coabitam
`apps/api` Fargate (P-96). Binding hoje = AWS Lambda. Contrato usa vocabulário neutro
(`network_id`, `private_subnet_ids`, `proxy_firewall_group_ref`, `encryption_key_ref`,
`secret_refs`, `firewall_group_ref`).

## O que é genuinamente portável

| Conceito | Contrato | Binding AWS |
|---|---|---|
| Rede privada | `network_id` | VPC id |
| Sub-redes privadas | `private_subnet_ids` | Subnet ids |
| Grupo de firewall do proxy | `proxy_firewall_group_ref` | Security Group id |
| Cifra (decrypt secrets) | `encryption_key_ref` | KMS key ARN |
| Handles dos secrets | `secret_refs` | Secrets Manager ARNs |
| DATABASE_URL secret | `database_url_secret_ref` | Secrets Manager ARN |
| Grupo de firewall dos workers | `firewall_group_ref` | Security Group id |
| Nomes das funções | `function_names` | Lambda function names |

## O que é provider-bound (custo real de exit → GCP Cloud Functions / Azure Functions)

- **`reserved_concurrent_executions`** (teto P-41) — Lambda por-função; em GCP Cloud
  Functions é `max_instance_count`; em Azure Functions é `functionAppScaleLimit`.
  Conceito idêntico, parâmetro diferente por provedor.
- **`aws_lambda_event_source_mapping` + `scaling_config.maximum_concurrency`** — wiring
  SQS→Lambda no provedor; em GCP é Pub/Sub trigger; em Azure é Queue trigger.
- **VPC Lambda** — Lambda em VPC exige ENI + `AWSLambdaVPCAccessExecutionRole`; em GCP
  Cloud Functions é VPC Connector; em Azure é VNET Integration.
- **`AWSLambdaVPCAccessExecutionRole`** — ARN de política gerenciada AWS.
- **`kms:Decrypt` resource = KMS ARN** — em GCP é `cloudkms.cryptoKeyVersions.useToDecrypt`
  por key resource; em Azure é Key Vault `unwrapKey` permission.
- **`awslogs` CloudWatch Logs** — em GCP é Cloud Logging; em Azure é Application Insights.

## Guardrails anti-pin no driver (P-41 — modo transação do proxy)

Ver `../db_proxy/README.md`. Em modo transação: sem `SET` de sessão, sem prepared
statement **nomeado** (`name:` no pg), sem `pg_advisory_lock` de sessão, sem
`LISTEN/NOTIFY`. Field crypto (AES-256-GCM em JS) é app-level — não toca sessão.
