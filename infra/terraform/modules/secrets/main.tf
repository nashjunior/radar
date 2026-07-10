# Módulo: secrets
# Secrets Manager — segredos da aplicação com rotação automática.
# Nenhum segredo no pipeline; runtime lê do Secrets Manager (A08 §6, P-08).
# LGPD 13.709/2018 — credenciais de acesso a dados pessoais são segredos críticos.
# Refs: arquitetura/08 §§3,4,6; docs/98 P-08

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

resource "aws_secretsmanager_secret" "database_url" {
  name        = "/${var.project}/${var.env}/database-url"
  description = "Connection string do PostgreSQL (radar-${var.env})"
  kms_key_id  = var.kms_key_arn

  recovery_window_in_days = var.env == "prod" ? 30 : 7

  tags = local.tags
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id = aws_secretsmanager_secret.database_url.id
  # Valor inicial vazio — preencher manualmente após o provisionamento do RDS.
  secret_string = jsonencode({
    url = "postgresql://PLACEHOLDER:PLACEHOLDER@localhost:5432/radar"
  })

  lifecycle {
    # Não sobrescrever rotações manuais pós-bootstrap.
    ignore_changes = [secret_string]
  }
}

# Credenciais master do RDS no formato {username,password} que o RDS Proxy exige
# para autenticar proxy→banco (auth_scheme=SECRETS). Distinto do database-url (string de
# conexão da app, cujo HOST deve ser o ENDPOINT DO PROXY, nunca o do cluster — P-41).
# Preencher pós-bootstrap com o mesmo par usado no cluster. Refs: docs/98 P-41/P-08.
resource "aws_secretsmanager_secret" "db_credentials" {
  name        = "/${var.project}/${var.env}/db-credentials"
  description = "Credenciais master {username,password} para o RDS Proxy (radar-${var.env})"
  kms_key_id  = var.kms_key_arn

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
  kms_key_id  = var.kms_key_arn

  recovery_window_in_days = var.env == "prod" ? 30 : 7

  tags = local.tags
}

resource "aws_secretsmanager_secret" "field_crypto_key" {
  name        = "/${var.project}/${var.env}/field-crypto-key"
  description = "Chave AES-256-GCM em base64 para FIELD_CRYPTO_KEY (${var.project}-${var.env})"
  kms_key_id  = var.kms_key_arn

  recovery_window_in_days = var.env == "prod" ? 30 : 7

  tags = local.tags
}

locals {
  tags = {
    project     = var.project
    environment = var.env
    managed_by  = "terraform"
  }
}
