# Módulo `storage` — object storage (RAD-181/RAD-182)

Object storage para anexos de editais **e** para o I/O do batch inference do Bedrock
(P-92/RAD-231/RAD-236). Binding hoje = AWS S3 (+ IAM role de serviço do Bedrock).
LGPD 13.709/2018.

## O que é genuinamente portável

| Conceito | Contrato | Binding AWS |
|---|---|---|
| Nome do bucket | `bucket_name` | S3 bucket name |
| Cifra em repouso | `encryption_key_ref` | KMS key ARN (`kms_master_key_id`) |
| Handle do bucket (anexos) | `bucket_ref` | S3 bucket ARN |
| URI de entrada do batch | `batch_input_ref` | S3 URI (`s3://bucket/batch/input/`) |
| URI de saída do batch | `batch_output_ref` | S3 URI (`s3://bucket/batch/output/`) |
| Handle do bucket de batch | `batch_bucket_ref` | S3 bucket ARN |
| Handle da role de serviço do batch | `batch_service_role_ref` | IAM role ARN |

## O que é provider-bound (custo real de exit → GCP/Azure)

- **`aws_s3_bucket_public_access_block`** — bloco de acesso público é um recurso
  separado no S3; em GCP Cloud Storage é o `public_access_prevention` no bucket;
  em Azure Blob Storage são configurações de "allow Blob public access" no storage account.
- **`bucket_key_enabled = true`** — otimização S3+KMS (reduz chamadas de KMS); sem
  equivalente direto em GCP/Azure.
- **`sse_algorithm = "aws:kms"`** — AWS-specific; GCP usa CMEK via Cloud KMS; Azure usa
  Customer-managed key no storage account.
- **Versionamento (`aws_s3_bucket_versioning`)** — conceito portável (GCP/Azure têm
  equivalente), mas recurso separado é padrão AWS; em outros provedores é atributo do bucket.
- **`aws_iam_role.bedrock_batch` + trust policy `aws:SourceAccount`/`aws:SourceArn`** —
  o modelo "service role que o serviço gerenciado assume" é IAM/STS da AWS; em
  GCP/Azure a delegação equivalente é service account impersonation / Managed Identity,
  sem o mesmo par de condições anti-confused-deputy.
- **`bedrock:InvokeModel`/`bedrock:CreateModelInvocationJob` e ARNs `bedrock:...`** —
  namespace e formato de recurso (`foundation-model/`, `inference-profile/`,
  `model-invocation-job/`) são do Bedrock; Vertex AI (GCP) e Azure OpenAI/AI Foundry têm
  modelos de job batch e de IAM próprios, sem estes ARNs. Este é o item de exit mais caro
  do módulo — é também o "seam" já previsto em P-66 (`LlmLoteGateway` provider-agnóstico
  na camada de aplicação; só o adapter e esta IaC mudam num swap).

## Batch inference do Bedrock — o que cada policy cobre (P-92)

- **Service role (`bedrock_batch`)**: só lê `batch/input/*`, só escreve `batch/output/*`,
  decifra/cifra com a CMK do projeto (`kms:ViaService=s3`), e invoca o modelo via
  cross-region inference profile (`bedrock:InvokeModel`, escopado a `inference-profile/*`
  desta conta + `foundation-model/anthropic.*` — nunca `Resource: "*"`).
- **Worker (task role do `compute`)**: submete/monitora o job
  (`CreateModelInvocationJob`/`GetModelInvocationJob`/`StopModelInvocationJob`) e faz
  `iam:PassRole` restrito a **esta** role (`iam:PassedToService=bedrock.amazonaws.com`) —
  nunca a `Resource: "*"` em PassRole, que abriria escalonamento de privilégio via Bedrock.
- **Retenção**: `batch_lifecycle_expiration_days` (default 30) expira o JSONL de
  entrada/saída — artefato de trabalho transiente, não custódia de documento (P-30/P-44
  regem o anexo original, não este prefixo).
- **Residência (P-28/P-66, sem mudança jurídica aqui)**: a submissão é `sa-east-1`, mas a
  inferência do modelo por cross-region profile roda fora do Brasil — mesma ressalva já
  registrada em P-66, este módulo não altera esse fato.
