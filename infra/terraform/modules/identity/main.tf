# Módulo: identity
# Amazon Cognito User Pool — provedor de identidade do MVP (P-08 decidido; P-53 operação).
# Authorization Code + PKCE via Hosted/Managed Login; a borda valida o ID token e o BFF
# deriva o tenantId de claim verificado (custom:tenantId), nunca de header do cliente.
# Operação de identidade (MFA, recuperação, brute-force, TTLs, rotação/revogação) = P-53.
# Refs: arquitetura/08 §§3,5,11; docs/05 §4; docs/98 P-08/P-53/P-91; apps/api middleware/tenant.ts

terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
      # refresh_token_rotation entrou no provider AWS v5.98.0.
      version = ">= 5.98, < 6.0"
    }
  }
}

data "aws_region" "current" {}

# --- User Pool -------------------------------------------------------------------------
resource "aws_cognito_user_pool" "this" {
  name = "${var.project}-${var.env}"

  # Login por e-mail; e-mail auto-verificado habilita recuperação por e-mail (canal ≠ MFA).
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  # MFA obrigatório, apenas TOTP (software token) — sem dependência de SMS (anti SIM-swap,
  # sem custo/entregabilidade de SMS). RAD-130 / P-53.
  mfa_configuration = "ON"
  software_token_mfa_configuration {
    enabled = true
  }

  # Recuperação de conta por e-mail verificado — canal distinto do TOTP usado no MFA,
  # conforme restrição do Cognito (recovery ≠ canal de MFA). RAD-130 / P-53.
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # Sem autocadastro público: MVP é convite-only (admin cria usuário). Coerente com
  # P-98 (o app não tem UX própria de credencial/signup — tudo na Managed Login).
  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }

  # Advanced Security (adaptive auth / risk-based) = defesa brute-force/credential-stuffing
  # nativa do Cognito. RAD-130. Custo extra por MAU — ver nota de custo na config-spec.
  user_pool_add_ons {
    advanced_security_mode = var.advanced_security_mode
  }

  # Atributo de tenant → vira o claim custom:tenantId no token. IMUTÁVEL: definido só na
  # criação/admin, o usuário nunca reescreve (anti escalonamento de tenant, AB1/P-51).
  # O app client abaixo NÃO inclui custom:tenantId em write_attributes.
  schema {
    name                     = "tenantId"
    attribute_data_type      = "String"
    mutable                  = false
    required                 = false
    developer_only_attribute = false
    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  # Rastreamento de dispositivo desligado no MVP: sem "remembered devices" — o MFA é
  # desafiado a cada nova sessão (RAD-130: "se houver remembered devices, justificar ou
  # desabilitar"). Omissão do bloco device_configuration = tracking OFF.

  # E-mail padrão do Cognito (limite ~50/dia) atende o MVP convite-only. Para volume de
  # produção, migrar para SES (mesma conta do transacional, arquitetura/14). Ver config-spec.
  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  deletion_protection = var.env == "prod" ? "ACTIVE" : "INACTIVE"

  tags = local.tags
}

# --- Domínio Hosted/Managed Login ------------------------------------------------------
resource "aws_cognito_user_pool_domain" "this" {
  domain       = var.hosted_ui_domain_prefix
  user_pool_id = aws_cognito_user_pool.this.id
}

# --- App client (SPA público, Authorization Code + PKCE, sem client secret) -------------
resource "aws_cognito_user_pool_client" "spa" {
  name         = "${var.project}-${var.env}-spa"
  user_pool_id = aws_cognito_user_pool.this.id

  # SPA público: PKCE, sem segredo de cliente (o segredo não vive no browser). P-91/P-98.
  generate_secret = false

  # OAuth só por código (Hosted UI); nada de implicit. Refresh habilitado p/ renovação
  # silenciosa; sem password/SRP auth expostos ao cliente (credencial fica na Managed Login).
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH"]

  callback_urls = var.callback_urls
  logout_urls   = var.logout_urls

  # TTLs curtos de ID/access; refresh com janela limitada (RAD-130 / P-53).
  id_token_validity      = var.id_token_validity_minutes
  access_token_validity  = var.access_token_validity_minutes
  refresh_token_validity = var.refresh_token_validity_days
  token_validity_units {
    id_token      = "minutes"
    access_token  = "minutes"
    refresh_token = "days"
  }

  # Revogação de refresh token habilitada (endpoint /oauth2/revoke via domínio Hosted UI).
  enable_token_revocation = true

  # Rotação de refresh token: a cada uso emite um novo refresh e invalida o anterior.
  # Requer provider aws recente — ver nota no required_providers acima.
  refresh_token_rotation {
    feature                    = "ENABLED"
    retry_grace_period_seconds = 0
  }

  # Não revela se um usuário existe (anti-enumeração no login/recuperação).
  prevent_user_existence_errors = "ENABLED"

  # BFF/SPA leem o tenant; o usuário NÃO pode escrever custom:tenantId (fora de write).
  read_attributes  = ["email", "email_verified", "profile", "custom:tenantId"]
  write_attributes = ["email", "profile"]
}

locals {
  tags = {
    project     = var.project
    environment = var.env
    managed_by  = "terraform"
    component   = "identity"
  }
}
