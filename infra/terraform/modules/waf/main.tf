# Módulo: waf
# Firewall de aplicação (L7) da borda pública. Binding hoje = AWS WAFv2 (scope REGIONAL).
# Primitiva PRÓPRIA, não parte da borda: a mesma ACL pode ser associada a um balanceador
# hoje e a um CDN/gateway amanhã — quem associa é o stack (composição), via `web_acl_ref`.
# Fecha a metade "WAF + rate-limit" de P-55; a outra metade (headers/CORS/CSRF/schema) já
# está no código (`apps/api/src/security.ts`, RAD-160).
# Refs: arquitetura/08 §5; docs/98 P-55; RAD-199

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

resource "aws_wafv2_web_acl" "this" {
  name  = "${var.project}-${var.env}-waf"
  scope = "REGIONAL"

  # Default ALLOW: a autorização de verdade é a validação de JWT + autorização por objeto
  # (AB1) na aplicação. O WAF é filtro de LIXO (bot, payload malformado, flood), não porta de
  # autenticação — default DENY aqui só faria a app ser inalcançável sem provar nada.
  default_action {
    allow {}
  }

  # Assinaturas gerenciadas: injeção, path traversal, payload malformado, user-agent de
  # scanner. Cobrem a classe de ataque genérico que não vale a pena reimplementar (A08 §1 —
  # "comprar, não operar").
  rule {
    name     = "common-rule-set"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project}-${var.env}-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "known-bad-inputs"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project}-${var.env}-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  # Rate-limit por IP de origem. ⚠️ NÃO é o rate-limit POR TENANT que P-55 pede: o tenant só
  # existe DEPOIS de validar o JWT (P-08 — claim verificado, nunca header do cliente) e o WAF
  # não valida assinatura de token; agregar pelo header `Authorization` também não serve (o
  # token roda a cada sessão). Por isso o teto por tenant fica na APLICAÇÃO, com o `tenantId`
  # já derivado do claim. Este aqui é o bulkhead grosso, anterior à app: contém flood/scraping
  # antes de custar CPU de task.
  rule {
    name     = "rate-limit-por-ip"
    priority = 3

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.rate_limit_per_ip
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project}-${var.env}-rate-ip"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.project}-${var.env}-waf"
    sampled_requests_enabled   = true
  }

  tags = local.tags
}
