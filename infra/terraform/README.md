# `infra/terraform` — contratos provider-agnósticos (RAD-181)

> **Estado vivo (pós-swap, 2026-07-11).** Este é o `infra/terraform` oficial — nasceu como
> rewrite na pasta temporária `infra/terraform-next` e foi swapado in-place após a paridade de
> endereço + config resolvida ser provada estaticamente. O gate de `tofu plan` = *no changes* e
> o histórico do swap estão em [`PARIDADE.md`](PARIDADE.md); a validação corrente é a pipeline
> (Gate 8 `terraform-validate`) + o primeiro `apply` real (AWS-account gated, RAD-134).

Refaz os **contratos** (`variables.tf`/`outputs.tf`) dos módulos Terraform para que sejam
genuinamente **provider-agnósticos** (A08 §4/§6), contendo a troca de provedor ao `main.tf`
de cada módulo. Decisão do Nash (2026-07-10): rewrite agora, com o board ocioso, sai mais
barato que refatorar sob fatura AWS.

## O princípio que governa o rewrite: contratos neutros, recursos conservados

A meta do issue tem duas metades em tensão aparente:

1. **"Rewrite do zero, contratos provider-agnósticos"** — melhorar a interface.
2. **"Paridade obrigatória: `plan` = no changes vs. o estado atual"** — MESMA infra.

A resolução é a regra que todo módulo deste rewrite segue:

> **O que muda é o CONTRATO (nomes de `variables`/`outputs`). O que NÃO muda é o RECURSO
> (todo bloco `resource "<tipo>" "<nome>"` e sua config *resolvida* ficam idênticos).**

`terraform plan` compara **estado ↔ recurso resolvido**, não nomes de variável. Renomear
`var.kms_key_arn` → `var.encryption_key_ref` e passar o mesmo valor produz **zero diff de
recurso** — o endereço de estado (`module.database.aws_rds_cluster.this`) e todos os
atributos continuam iguais. É isso que torna o rewrite **swap-safe**: interface nova, infra
byte-a-byte igual. Um `plan` que queira **recriar** recurso = contrato quebrou a paridade e
**não pode trocar** (regra do issue).

Corolário: **não movemos recurso entre módulos nem renomeamos instância de módulo no stack**
(isso mudaria o endereço de estado → destroy/create). Mantemos *modules-by-primitive +
stacks-by-env*, composição só no stack (A08 §6).

## Vocabulário neutro (A08 §4 — coluna "Primitiva")

Convenção de sufixo: **`_ref`** = handle opaco do provedor (ARN/ID que só o provedor
resolve); **sem sufixo** = valor genuinamente portável (URL, endpoint, CIDR, região, nome,
porta, número).

| Conceito (A08 §4) | Contrato neutro | Binding hoje (AWS) — vive no `main.tf` |
|---|---|---|
| Projeto / ambiente | `project`, `env` | prefixo de tag |
| Região | `region` | `sa-east-1`; `kms:ViaService` |
| Rede privada | `network_id`, `network_cidr`, `private_subnet_ids` | VPC id/cidr, subnet ids |
| Cifra em repouso (chave gerenciada) | `encryption_key_ref` | KMS key ARN (`kms_key_id`) |
| Segredo (handle) | `<nome>_secret_ref`, `secret_refs` | Secrets Manager ARN |
| Imagem OCI | `container_image_uri` | ECR URI |
| Grupo de firewall | `firewall_group_ref` (+ `db_firewall_group_ref`) | Security Group id |
| Endpoint de banco | `cluster_endpoint`, `reader_endpoint`, `proxy_endpoints` | RDS / RDS Proxy endpoint |
| Cluster de banco (handle) | `cluster_ref` | Aurora `cluster_identifier` |
| Fila | `queue_url`, `queue_ref`, `dlq_ref` | SQS URL/ARN |
| Tópico de alarme | `alarm_topic_ref` | SNS topic ARN |

## O irredutivelmente provider-bound = o custo real de um exit (documentado, não fingido)

A08 §6 é explícito: alguns pontos **não têm** equivalente neutro honesto. Renomeá-los para
parecer neutro **esconde** o custo de troca — pior que expô-lo. Então: onde o conceito é
provider-bound, o contrato mantém um nome honesto (`*_ref`) **e o `README.md` do módulo
lista o que um exit para GCP/Azure custaria**. Exemplos que ficam documentados, não
neutralizados:

- **Semântica de pool do RDS Proxy** — `max_connections_percent`, `max_idle_connections_percent`,
  `connection_borrow_timeout` (o pgbouncer/Auth-Proxy equivalente configura por número
  absoluto, não percentual).
- **Anti-pin do modo transação** — `DatabaseConnectionsCurrentlySessionPinned` (métrica
  CloudWatch), `session_pinning_filters` (MySQL-only).
- **Wiring SG→SG** — a invariante P-41 "nunca pro RDS direto" é uma regra de ingress
  `referenced_security_group_id` (AWS); em GCP são firewall rules por tag, em Azure NSG.
- **Concorrência reservada de função** — `reserved_concurrency` (modelo Lambda).
- **Claim de tenant** — `custom:tenantId` (atributo custom do Cognito).

## PRESERVAR (guardrail — o rewrite é estrutural, NÃO reseta decisão de infra)

Toda decisão já tomada continua valendo byte-a-byte (é o que a paridade prova):

- **P-41/RAD-165** — RDS Proxy modo transação, **um proxy por workload** (bulkhead físico),
  `max_connections_percent` 8/5/5/3/3, pisos do parameter group (`max_connections=200`,
  `work_mem=16MB`, `idle_in_transaction=30s`, backstop `statement_timeout=300s`,
  `lock_timeout=0` global), alarme de pin, teto de `reserved_concurrency`.
- **Cifra em repouso (KMS, LGPD 13.709/2018)** em banco, fila, storage, segredos.
- **Sub-redes privadas**, SG do banco **só via proxy** (sem ingress direto).
- **SQS com DLQ**, **Secrets Manager**, **Cognito** (identity), **Aurora PG16 serverless v2**
  scaling, **tiering S3**.
- **Seam serverless gated-off** (workers Fargate no MVP-Now, P-96) — `count`/`enabled=false`.

## Estado deste rewrite (2026-07-10)

| Módulo | Contrato neutro | `main.tf` conservado | README exit-cost | Status |
|---|---|---|---|---|
| `database` | ✅ | ✅ | ✅ | **referência** |
| `db_proxy` | ✅ | ✅ | ✅ | **referência** |
| `vpc` | ✅ | ✅ | ✅ | RAD-182 ✅ |
| `queue` | ✅ | ✅ | ✅ | RAD-182 ✅ |
| `storage` | ✅ | ✅ | ✅ | RAD-182 ✅ |
| `secrets` | ✅ | ✅ | ✅ | RAD-182 ✅ |
| `identity` | ✅ | ✅ | ✅ | RAD-182 ✅ |
| `compute` | ✅ | ✅ | ✅ | RAD-182 ✅ |
| `serverless` | ✅ | ✅ | ✅ | RAD-182 ✅ |
| stacks dev/staging/prod | ✅ | ✅ | — | RAD-182 ✅ |

Parte A (RAD-182) completa — todos os módulos escritos com vocabulário neutro + READMEs
de exit-cost + stacks wireados. Parte B (paridade via `tofu plan -detailed-exitcode`)
bloqueada pela mesma frente de credenciais AWS de RAD-134/RAD-130. Ver
[`PARIDADE.md`](PARIDADE.md) para o gate e o swap.
