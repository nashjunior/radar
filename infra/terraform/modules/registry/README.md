# Módulo `registry` — registro de imagens OCI (RAD-199)

Onde vive a imagem do tier sempre-ligado (`apps/api` — BFF + triagem-pool, P-96). Existe
porque `compute.container_image_uri` não tinha para onde apontar: nenhum stack provisionava
repositório de imagem e o repo não tinha Dockerfile. Binding hoje = AWS ECR.

## O que é genuinamente portável

| Conceito | Contrato | Binding AWS |
|---|---|---|
| URI da imagem | `repository_uri` | `<acct>.dkr.ecr.<region>.amazonaws.com/<repo>` |
| Handle do repositório | `repository_ref` | ECR repository ARN |
| Cifra em repouso | `encryption_key_ref` | KMS key ARN |
| Imutabilidade de tag | `image_tag_mutability` | ECR `imageTagMutability` |

A imagem em si é OCI — o artefato é portável mesmo quando o registro não é. O exit custa um
`docker pull` + `docker push` para o registro do outro provedor (GCP Artifact Registry, Azure
ACR), não um rebuild.

## O que é provider-bound (custo real de exit)

- **Lifecycle policy** (JSON de regras de expiração) — GCP/Azure têm o conceito, com esquema
  próprio. Regra portável, sintaxe não.
- **`scan_on_push`** — é o gate P-56 de A08 §6. GCP/Azure oferecem scan equivalente
  (Container Analysis / Microsoft Defender), com integração diferente.
- **Cifra por CMK** — o ECR cria um *grant* na chave para servir o pull; quem puxa (a
  execution role do ECS) precisa de `kms:Decrypt` restrito a `kms:ViaService = ecr.*` (está
  no módulo `compute`).

## Convenção de tag

`image_tag_mutability = IMMUTABLE` em prod: a tag NUNCA é reescrita, então a task definition
é uma referência auditável e o rollback aponta para um binário, não para um ponteiro móvel.
O CI publica a imagem taguada pelo SHA do commit; `latest` não é contrato de deploy. Dev e
staging usam `MUTABLE` para permitir re-push da mesma tag.
