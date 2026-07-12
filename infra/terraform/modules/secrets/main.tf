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

# --- Gateway de pagamento Asaas (P-107 (5), RAD-252/RAD-253) --------------------------
#
# Dois segredos distintos: o TOKEN que a aplicação COMPARA contra o header
# `asaas-access-token` recebido no webhook (`apps/api/src/routes/webhooks/pagamento.ts`,
# env `ASAAS_WEBHOOK_TOKEN`) e a API KEY que a aplicação ENVIA ao chamar o Asaas de volta
# — a confirmação outbound que a compensação de segurança exige antes de ativar
# entitlement (aceite RAD-239/RAD-253: "webhook é gatilho, não autoridade").
#
# ⚠️ Rotação automática (Lambda de rotação chamando a API do Asaas) NÃO existe aqui — não
# existe para NENHUM segredo deste módulo hoje (nem `llm_api_key`, nem `pncp_api_key`); seria
# uma primitiva nova (custom rotation Lambda) fora do escopo desta issue, e o endpoint da
# Asaas para reemitir token/chave programaticamente não está confirmado (mesmo
# `[A VALIDAR]` de `asaas-pagamento-gateway.ts`). Ambos os segredos vivem em Secrets Manager
# com KMS e `recovery_window_in_days` — o mesmo cofre com rotação NATIVA que P-08 decidiu —
# mas a rotação automatizada por Lambda é follow-up registrado (não inventado aqui).
resource "aws_secretsmanager_secret" "asaas_webhook_token" {
  name        = "/${var.project}/${var.env}/asaas-webhook-token"
  description = "Segredo comparado contra o header asaas-access-token do webhook (P-107 (5), RAD-253)"
  kms_key_id  = var.encryption_key_ref

  recovery_window_in_days = var.env == "prod" ? 30 : 7

  tags = local.tags
}

# Mesma armadilha do llm_api_key/field_crypto_key: sem versão AWSCURRENT, ECS não sobe a
# task (`unable to pull secrets`). O valor real (token gerado por nós, configurado também
# no dashboard do Asaas) entra por fora; `ignore_changes` protege contra sobrescrita.
resource "aws_secretsmanager_secret_version" "asaas_webhook_token" {
  secret_id     = aws_secretsmanager_secret.asaas_webhook_token.id
  secret_string = "PLACEHOLDER"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# Segredo TRANSITÓRIO da dupla-chave (RAD-261/RAD-262): valor anterior aceito por
# `tokenWebhookAsaasValido` durante a janela de rotação. Ao contrário dos demais segredos
# deste módulo, a version inicial é STRING VAZIA — não "PLACEHOLDER" — porque
# `tokenWebhookAsaasValido` trata segredo vazio como "pula" (nunca compara), enquanto
# qualquer string não-vazia viraria um segundo token válido por omissão. O estado normal
# (fora da janela de rotação) é vazio; só o runbook (README, "Rotação") o popula, e só
# nessa janela.
resource "aws_secretsmanager_secret" "asaas_webhook_token_anterior" {
  name        = "/${var.project}/${var.env}/asaas-webhook-token-anterior"
  description = "Valor anterior do ASAAS_WEBHOOK_TOKEN, aceito durante a janela de rotação (dupla-chave, RAD-261)"
  kms_key_id  = var.encryption_key_ref

  recovery_window_in_days = var.env == "prod" ? 30 : 7

  tags = local.tags
}

resource "aws_secretsmanager_secret_version" "asaas_webhook_token_anterior" {
  secret_id     = aws_secretsmanager_secret.asaas_webhook_token_anterior.id
  secret_string = ""

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "asaas_api_key" {
  name        = "/${var.project}/${var.env}/asaas-api-key"
  description = "Chave de API do Asaas (AsaasPagamentoGateway) — confirmação outbound antes de ativar entitlement (P-107 (5)/(6))"
  kms_key_id  = var.encryption_key_ref

  recovery_window_in_days = var.env == "prod" ? 30 : 7

  tags = local.tags
}

resource "aws_secretsmanager_secret_version" "asaas_api_key" {
  secret_id     = aws_secretsmanager_secret.asaas_api_key.id
  secret_string = "PLACEHOLDER"

  lifecycle {
    ignore_changes = [secret_string]
  }
}
