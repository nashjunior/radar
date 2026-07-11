# Módulo `storage` — object storage (RAD-181/RAD-182)

Object storage para anexos de editais. Binding hoje = AWS S3. LGPD 13.709/2018.

## O que é genuinamente portável

| Conceito | Contrato | Binding AWS |
|---|---|---|
| Nome do bucket | `bucket_name` | S3 bucket name |
| Cifra em repouso | `encryption_key_ref` | KMS key ARN (`kms_master_key_id`) |
| Handle do bucket | `bucket_ref` | S3 bucket ARN |

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
