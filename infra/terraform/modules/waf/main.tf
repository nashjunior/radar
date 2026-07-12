# Módulo: waf
# Firewall de aplicação (L7) da borda pública. Binding hoje = AWS WAFv2 (scope REGIONAL).
# Primitiva PRÓPRIA, não parte da borda: a mesma ACL pode ser associada a um balanceador
# hoje e a um CDN/gateway amanhã — quem associa é o stack (composição), via `web_acl_ref`.
# Fecha a metade "WAF + rate-limit" de P-55; a outra metade (headers/CORS/CSRF/schema) já
# está no código (`apps/api/src/security.ts`, RAD-160). Também carrega a allowlist de IP do
# webhook do Asaas (P-107(a)), compensação de borda por não haver HMAC no raw body.
# Refs: arquitetura/08 §5; docs/98 P-55, P-107(a); RAD-199, RAD-253, RAD-258

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

  # Allowlist de IP escopada SÓ ao path do webhook do Asaas — nunca `/api/*` nem `/health`.
  # Compensação obrigatória do aceite de segurança P-107(a) (RAD-253/RAD-258): o Asaas
  # autentica webhook por token estático, não por HMAC no raw body, então o invariante
  # "webhook autenticado" só fecha com uma camada de borda além da validação em
  # `apps/api/src/routes/webhooks/pagamento.ts`. Bloqueia POST fora da lista oficial; dentro
  # do path, cai no default ALLOW e segue para a app (token estático + fail-closed).
  rule {
    name     = "asaas-webhook-ip-allowlist"
    priority = 4

    action {
      block {}
    }

    statement {
      and_statement {
        statement {
          byte_match_statement {
            field_to_match {
              uri_path {}
            }
            positional_constraint = "STARTS_WITH"
            search_string         = var.asaas_webhook_path
            text_transformation {
              priority = 0
              type     = "NONE"
            }
          }
        }

        statement {
          not_statement {
            statement {
              ip_set_reference_statement {
                arn = aws_wafv2_ip_set.asaas_webhook.arn
              }
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project}-${var.env}-asaas-webhook-allowlist"
      sampled_requests_enabled   = true
    }
  }

  # Rate-limit PRÓPRIO do webhook (RAD-252, P-107 (5)) — escopado ao path via
  # `scope_down_statement`, INDEPENDENTE do `rate-limit-por-ip` geral (regra 3, API inteira):
  # é tráfego servidor-a-servidor de poucos IPs (a allowlist da regra acima), não navegador —
  # teto próprio, mais apertado que o bulkhead genérico.
  rule {
    name     = "asaas-webhook-rate-limit"
    priority = 5

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.asaas_webhook_rate_limit
        aggregate_key_type = "IP"

        scope_down_statement {
          byte_match_statement {
            field_to_match {
              uri_path {}
            }
            positional_constraint = "STARTS_WITH"
            search_string         = var.asaas_webhook_path
            text_transformation {
              priority = 0
              type     = "NONE"
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project}-${var.env}-asaas-webhook-rate"
      sampled_requests_enabled   = true
    }
  }

  # Corpo pequeno (RAD-252, P-107 (5)) — notificação de webhook é JSON server-to-server, sem
  # anexo/upload; corpo acima do teto é anomalia de payload, não notificação legítima do
  # Asaas. `oversize_handling = MATCH`: corpo maior que a janela de inspeção da WAFv2 conta
  # como excesso também (é, por definição, maior que o teto configurado abaixo dela).
  rule {
    name     = "asaas-webhook-corpo-pequeno"
    priority = 6

    action {
      block {}
    }

    statement {
      and_statement {
        statement {
          byte_match_statement {
            field_to_match {
              uri_path {}
            }
            positional_constraint = "STARTS_WITH"
            search_string         = var.asaas_webhook_path
            text_transformation {
              priority = 0
              type     = "NONE"
            }
          }
        }

        statement {
          size_constraint_statement {
            comparison_operator = "GT"
            size                = var.asaas_webhook_max_body_bytes

            field_to_match {
              body {
                oversize_handling = "MATCH"
              }
            }

            text_transformation {
              priority = 0
              type     = "NONE"
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project}-${var.env}-asaas-webhook-body-size"
      sampled_requests_enabled   = true
    }
  }

  # RAD-273 (P-109 L2): fricção no fluxo de CRIAÇÃO DE CONTA do Cognito — encarece o
  # unitário do ataque Sybil (farm de contas trial pra consumir triagem por IA grátis,
  # P-109). Escopo deliberadamente restrito a signup/confirmação (`var.cognito_signup_paths`
  # — `/signup`, `/confirm`, `/confirmUser`, `/resendcode`), NUNCA `/login` ou
  # `/oauth2/authorize`: um rule com ação CAPTCHA nesses paths quebra o registro de TOTP MFA
  # em andamento (aviso da própria AWS — "Configuring your AWS WAF web ACL for managed login
  # TOTP MFA"); como este rate-limit nunca toca esses paths, não colide com MFA (P-53). Ação
  # CAPTCHA, não BLOCK — falso positivo em NAT corporativo/IP compartilhado é caro (persona
  # central = fornecedor pequeno, docs/01 §3). A associação ao user pool é do módulo
  # `identity` (mesmo `web_acl_ref`, padrão do `edge` — módulo não importa módulo, A08 §1).
  rule {
    name     = "cognito-signup-rate-limit-ip"
    priority = 7

    action {
      captcha {}
    }

    statement {
      rate_based_statement {
        limit              = var.cognito_signup_rate_limit_per_ip
        aggregate_key_type = "IP"

        scope_down_statement {
          or_statement {
            dynamic "statement" {
              for_each = var.cognito_signup_paths
              content {
                byte_match_statement {
                  field_to_match {
                    uri_path {}
                  }
                  positional_constraint = "STARTS_WITH"
                  search_string         = statement.value
                  text_transformation {
                    priority = 0
                    type     = "NONE"
                  }
                }
              }
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project}-${var.env}-cognito-signup-rate-ip"
      sampled_requests_enabled   = true
    }
  }

  # Agregação por ASN — o ticket pedia "se der" (P-109 L2): CONFERIDO e NÃO DÁ hoje. O
  # schema do provider pinado (`hashicorp/aws 5.100.0`, mesmo do `.terraform.lock.hcl` dos
  # stacks) só aceita `custom_key` de tipo cookie/forwarded_ip/header/http_method/ip/
  # ja3_fingerprint/ja4_fingerprint/label_namespace/query_argument/query_string/uri_path —
  # sem `asn` (confirmado via `tofu providers schema -json`). A AWS tem `asn_match_statement`
  # (statement de MATCH, pra permitir/negar por lista de ASN — não agregação de rate-limit) e
  # há um issue aberto e não resolvido no `terraform-provider-aws` pedindo exatamente
  # agregação de `rate_based_statement` por ASN (github.com/hashicorp/terraform-provider-aws
  # issue #43492) — não é lacuna deste módulo, é o provider ainda não expor a API da AWS.
  # Reabrir quando o provider suportar (bump de versão é decisão à parte, fora do escopo
  # cirúrgico deste ticket — ver PARIDADE.md sobre risco de bump de provider).

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.project}-${var.env}-waf"
    sampled_requests_enabled   = true
  }

  tags = local.tags
}

# IPs oficiais do Asaas para o `ip_set_reference_statement` acima. Recurso separado (não
# inline) porque `ip_set_reference_statement` exige o ARN de um `aws_wafv2_ip_set` — não
# aceita lista de CIDR direto na regra.
resource "aws_wafv2_ip_set" "asaas_webhook" {
  name               = "${var.project}-${var.env}-asaas-webhook-ips"
  scope              = "REGIONAL"
  ip_address_version = "IPV4"
  addresses          = var.asaas_webhook_ip_allowlist

  tags = local.tags
}
