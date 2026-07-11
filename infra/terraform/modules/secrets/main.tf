# Módulo: secrets
# Cofre de segredos da aplicação. Nenhum segredo no pipeline; runtime lê daqui.
# Binding hoje = AWS Secrets Manager. Contrato usa `*_secret_ref` + `encryption_key_ref`.
# LGPD 13.709/2018 — credenciais de acesso a dados pessoais são segredos críticos.
# Refs: arquitetura/08 §§3,4,6; docs/98 P-08; RAD-181/RAD-182

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

locals {
  tags = {
    project     = var.project
    environment = var.env
    managed_by  = "terraform"
  }
}

resource "aws_secretsmanager_secret" "database_url" {
  name        = "/${var.project}/${var.env}/database-url"
  description = "Connection string do PostgreSQL (radar-${var.env})"
  kms_key_id  = var.encryption_key_ref

  recovery_window_in_days = var.env == "prod" ? 30 : 7

  tags = local.tags
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id = aws_secretsmanager_secret.database_url.id
  secret_string = jsonencode({
    url = "postgresql://PLACEHOLDER:PLACEHOLDER@localhost:5432/radar"
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# Credenciais master do banco no formato {username,password} que o pool gerenciado
# exige para autenticar proxy→banco. Distinto do database-url (que aponta ao endpoint
# do proxy, nunca ao cluster — P-41). Preencher pós-bootstrap. Refs: docs/98 P-41/P-08.
resource "aws_secretsmanager_secret" "db_credentials" {
  name        = "/${var.project}/${var.env}/db-credentials"
  description = "Credenciais master {username,password} para o pool gerenciado (radar-${var.env})"
  kms_key_id  = var.encryption_key_ref

  recovery_window_in_days = var.env == "prod" ? 30 : 7

  tags = local.tags
}

resource "aws_secretsmanager_secret_version" "db_credentials" {
  secret_id = aws_secretsmanager_secret.db_credentials.id
  secret_string = jsonencode({
    username = "PLACEHOLDER"
    password = "PLACEHOLDER"
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "pncp_api_key" {
  name        = "/${var.project}/${var.env}/pncp-api-key"
  description = "Chave de acesso à API do PNCP (se exigida)"
  kms_key_id  = var.encryption_key_ref

  recovery_window_in_days = var.env == "prod" ? 30 : 7

  tags = local.tags
}

# Chave da API do LLM. O tier sempre-ligado é BFF **+ triagem-pool** (P-96): sem esta chave,
# `iniciarWorkers()` devolve null e METADE do tier fica inerte — de novo, sem o apply falhar.
# Some quando P-66 aterrissar (Bedrock autentica por IAM/SigV4, sem chave); o segredo é a
# ponte enquanto o adapter é `AnthropicSdkClient` direto.
resource "aws_secretsmanager_secret" "llm_api_key" {
  name        = "/${var.project}/${var.env}/anthropic-api-key"
  description = "ANTHROPIC_API_KEY do worker de triagem (P-66: vira IAM quando migrar p/ Bedrock)"
  kms_key_id  = var.encryption_key_ref

  recovery_window_in_days = var.env == "prod" ? 30 : 7

  tags = local.tags
}

# Versão placeholder. NÃO é decoração: o ECS busca o segredo pela EXECUTION role ao montar a
# task, e segredo sem versão AWSCURRENT dá `ResourceInitializationError: unable to pull
# secrets` — a task morre no boot e o `apply` sai 0. O valor real entra por fora (console/CLI,
# ver runbook) e o `ignore_changes` impede o Terraform de sobrescrevê-lo.
resource "aws_secretsmanager_secret_version" "llm_api_key" {
  secret_id     = aws_secretsmanager_secret.llm_api_key.id
  secret_string = "PLACEHOLDER"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "field_crypto_key" {
  name        = "/${var.project}/${var.env}/field-crypto-key"
  description = "Chave AES-256-GCM em base64 para FIELD_CRYPTO_KEY (${var.project}-${var.env})"
  kms_key_id  = var.encryption_key_ref

  recovery_window_in_days = var.env == "prod" ? 30 : 7

  tags = local.tags
}

# Mesma armadilha do llm_api_key: era inerte enquanto o compute não estava instanciado
# (RAD-199) e vira `unable to pull secrets` no primeiro apply do serviço.
resource "aws_secretsmanager_secret_version" "field_crypto_key" {
  secret_id     = aws_secretsmanager_secret.field_crypto_key.id
  secret_string = "PLACEHOLDER"

  lifecycle {
    ignore_changes = [secret_string]
  }
}
