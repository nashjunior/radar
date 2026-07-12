# Módulo: identity
# Provedor de identidade OIDC do MVP. Authorization Code + PKCE via Hosted/Managed Login.
# Binding hoje = Amazon Cognito (P-08 decidido; P-53 operação).
# O que é OIDC-padrão usa vocabulário neutro; o que é Cognito-bound está no README.md.
# REGRA: não renomear outputs sem avisar Flávia — são contratos back↔front.
# Refs: arquitetura/08 §§3,5,11; docs/05 §4; docs/98 P-08/P-53/P-91; RAD-181/RAD-182

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

resource "aws_cognito_user_pool" "this" {
  name = "${var.project}-${var.env}"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  mfa_configuration = "ON"
  software_token_mfa_configuration {
    enabled = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  admin_create_user_config {
    allow_admin_create_user_only = !var.permitir_auto_cadastro
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }

  user_pool_add_ons {
    advanced_security_mode = var.advanced_security_mode
  }

  # Atributo custom:tenantId — imutável (anti escalonamento de tenant, AB1/P-51).
  # O app client NÃO inclui custom:tenantId em write_attributes.
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

  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  deletion_protection = var.env == "prod" ? "ACTIVE" : "INACTIVE"

  tags = local.tags
}

resource "aws_cognito_user_pool_domain" "this" {
  domain       = var.hosted_ui_domain_prefix
  user_pool_id = aws_cognito_user_pool.this.id
}

resource "aws_cognito_user_pool_client" "spa" {
  name         = "${var.project}-${var.env}-spa"
  user_pool_id = aws_cognito_user_pool.this.id

  generate_secret = false

  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH"]

  callback_urls = var.callback_urls
  logout_urls   = var.logout_urls

  id_token_validity      = var.id_token_validity_minutes
  access_token_validity  = var.access_token_validity_minutes
  refresh_token_validity = var.refresh_token_validity_days
  token_validity_units {
    id_token      = "minutes"
    access_token  = "minutes"
    refresh_token = "days"
  }

  enable_token_revocation = true

  refresh_token_rotation {
    feature                    = "ENABLED"
    retry_grace_period_seconds = 0
  }

  prevent_user_existence_errors = "ENABLED"

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

# A associação mora aqui (a ACL é 1:N — pode proteger outras bordas), mas o handle vem do
# stack: `waf` e `identity` são primitivas irmãs, nenhuma importa a outra (A08 §1). Mesmo
# padrão do módulo `edge`. RAD-273/P-109 L2: rate-limit + CAPTCHA no fluxo de signup.
resource "aws_wafv2_web_acl_association" "this" {
  count = var.web_acl_ref == null ? 0 : 1

  resource_arn = aws_cognito_user_pool.this.arn
  web_acl_arn  = var.web_acl_ref
}
