# Módulo `secrets` — cofre de segredos (RAD-181/RAD-182)

Segredos da aplicação; runtime lê em tempo de execução, nada no pipeline. Binding
hoje = AWS Secrets Manager. LGPD 13.709/2018.

## O que é genuinamente portável

| Conceito | Contrato | Binding AWS |
|---|---|---|
| Handle do segredo | `*_secret_ref` | Secrets Manager ARN |
| Cifra em repouso | `encryption_key_ref` | KMS key ARN (`kms_key_id`) |

## O que é provider-bound (custo real de exit → GCP/Azure)

- **`aws_secretsmanager_secret_version`** — AWS separa secret (metadados) de version
  (valor); em GCP Secret Manager o valor é uma `secret_version`; em Azure Key Vault
  é um `key_vault_secret`. Mesmo conceito, recurso diferente.
- **`recovery_window_in_days`** — AWS tem janela de recuperação de 7–30 dias antes de
  destruição; GCP e Azure têm soft-delete configurável por dias também (portável no
  conceito, diferente nos parâmetros).
- **`lifecycle { ignore_changes = [secret_string] }`** — mecanismo de IaC para não
  sobrescrever rotação manual. Equivale a `prevent_destroy` no conceito; a semântica
  de "IaC seta só o PLACEHOLDER, runtime seta o real" é universal mas o atributo
  Terraform é específico.
- **`kms_key_id` em Secrets Manager** — AWS usa KMS por secret; GCP Secret Manager
  usa CMEK por secret version; Azure Key Vault tem cifra por cofre.
