# Stack prod — infra/terraform (rewrite provider-agnóstico RAD-181/RAD-182, swapado 2026-07-11)
# Mesmas instâncias de módulo e mesmas chaves de pool/function do stack atual
# para garantir paridade de endereços de estado.

terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.98, < 6.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = { project = "radar", environment = "prod", managed_by = "terraform" }
  }
}

module "vpc" {
  source             = "../../modules/vpc"
  project            = "radar"
  env                = "prod"
  region             = var.aws_region
  network_cidr       = "10.2.0.0/16"
  availability_zones = ["${var.aws_region}a", "${var.aws_region}b", "${var.aws_region}c"]

  # Um gateway de saída POR AZ (RAD-199). Gateway único seria ~US$ 65/mês mais barato, mas a
  # queda da AZ dele derrubaria a saída das TRÊS: sem PNCP (ingestão para), sem LLM (triagem
  # para), sem Secrets Manager (task nova não sobe). Em prod isso é indisponibilidade total,
  # não degradação. Dev/staging usam um só — lá o trade-off inverte.
  egress_gateway_count = 3
}

module "database" {
  source             = "../../modules/database"
  project            = "radar"
  env                = "prod"
  network_id         = module.vpc.network_id
  network_cidr       = module.vpc.network_cidr
  private_subnet_ids = module.vpc.private_subnet_ids
  db_username        = var.db_username
  db_password        = var.db_password
  encryption_key_ref = var.kms_key_arn

  # Piso de 2 ACU (P-67): 0,5 ACU = 1 GB não segura o working set do fan-out e vira seq scan
  # frio sob rajada — o statement_timeout de 10 s do pool `matching` mata a query e o retry
  # fura o frescor. Piso de PARTIDA; confirmar por medição no unblock (A09 EL1/EL3, RAD-162).
  min_capacity_acu = 2
  max_capacity_acu = 16

  # HA: writer + reader em outra AZ. É isto que "Multi-AZ" significa em Aurora — o motivo é
  # failover (~30–60 s vs. reconstrução de minutos), não read-scaling. Custo: o piso de ACU
  # é cobrado por instância (2 x 2 ACU = 4 ACU-h de piso 24/7).
  instance_count = 2
}

module "storage" {
  source             = "../../modules/storage"
  project            = "radar"
  env                = "prod"
  region             = var.aws_region
  encryption_key_ref = var.kms_key_arn
}

# Topologia de fan-out (RAD-179), na ordem em que a mensagem anda:
#   editais-ingeridos --[MatchingWorker: casa 1 edital com N critérios]--> alertas-a-gravar
#   alertas-a-gravar  --[ConsumidorAlertaBatch: 1 INSERT multi-row]------> alertas-gerados
#
# Cada fila tem visibility >= algumas vezes o p99 do SEU consumidor, e o produto
# visibility x max_receive respeita o orçamento de reentrega (900 s) — ver módulo `queue`.

# Consumidor: MatchingWorker. É o mais pesado do sistema — 1 edital popular casa com N mil
# critérios (A04 S4, A06) e HOJE o produtor faz um SendMessage SERIAL por alerta, o que põe
# o p99 na casa das dezenas de segundos. Com os 30 s de visibility que estavam aqui, um
# edital popular estoura o timeout, é REENTREGUE e re-emite alertas (duplicata) até morrer
# na DLQ. 180 s dá folga ao consumidor de hoje; o conserto de verdade é SendMessageBatch no
# app (RAD-194), que derruba o p99 pra < 10 s e deixa estes 180 s com folga de ~18x.
module "queue_ingestao" {
  source             = "../../modules/queue"
  project            = "radar"
  env                = "prod"
  queue_name         = "editais-ingeridos"
  encryption_key_ref = var.kms_key_arn

  visibility_timeout = 180
  max_receive_count  = 5 # 180 x 5 = 900 s — no limite do orçamento de reentrega
}

# Buffer do batch INSERT (o `filaAlertaQueueUrl` do código). ESTA FILA NÃO EXISTIA NA IaC:
# `ConsumidorAlertaBatch` drena uma fila que nenhum stack provisionava — o fan-out de RAD-179
# não tinha como rodar em AWS nenhuma. Consumidor leve (drena <= 10, um INSERT multi-row).
module "queue_alertas_gravar" {
  source             = "../../modules/queue"
  project            = "radar"
  env                = "prod"
  queue_name         = "alertas-a-gravar"
  encryption_key_ref = var.kms_key_arn

  visibility_timeout = 60
  max_receive_count  = 5
}

# Consumidor: notificação (entrega do alerta). Leve.
module "queue_alertas" {
  source             = "../../modules/queue"
  project            = "radar"
  env                = "prod"
  queue_name         = "alertas-gerados"
  encryption_key_ref = var.kms_key_arn

  visibility_timeout = 60
  max_receive_count  = 5
}

module "secrets" {
  source             = "../../modules/secrets"
  project            = "radar"
  env                = "prod"
  encryption_key_ref = var.kms_key_arn
}

# RDS Proxy em modo transação + bulkheads por workload (P-41/RAD-165).
# Prod usa a decomposição de 5 pools (default do módulo) — isolamento máximo.
module "db_proxy" {
  source                    = "../../modules/db_proxy"
  project                   = "radar"
  env                       = "prod"
  region                    = var.aws_region
  network_id                = module.vpc.network_id
  network_cidr              = module.vpc.network_cidr
  private_subnet_ids        = module.vpc.private_subnet_ids
  cluster_ref               = module.database.cluster_ref
  db_firewall_group_ref     = module.database.firewall_group_ref
  db_max_connections        = module.database.max_connections
  db_credentials_secret_ref = module.secrets.db_credentials_secret_ref
  encryption_key_ref        = var.kms_key_arn
  alarm_topic_ref           = var.ops_alarm_sns_topic_arn
  debug_logging             = false
}

# Seam serverless de P-27 — provisionado e validado, gated off (workers em Fargate no
# MVP-Now, P-96). reserved_concurrency = teto de conexões ao banco (P-41).
module "serverless" {
  source                   = "../../modules/serverless"
  count                    = var.enable_serverless_workers ? 1 : 0
  project                  = "radar"
  env                      = "prod"
  region                   = var.aws_region
  network_id               = module.vpc.network_id
  private_subnet_ids       = module.vpc.private_subnet_ids
  proxy_firewall_group_ref = module.db_proxy.firewall_group_ref
  encryption_key_ref       = var.kms_key_arn
  secret_refs              = [module.secrets.database_url_secret_ref, module.secrets.field_crypto_key_secret_ref]
  database_url_secret_ref  = module.secrets.database_url_secret_ref
  enabled                  = false

  functions = {
    ingestao = {
      handler              = "dist/workers/ingestao.handler"
      reserved_concurrency = 12
      pool                 = "ingestao"
      proxy_endpoint       = module.db_proxy.proxy_endpoints["ingestao"]
      queue_arn            = null
    }
    matching = {
      handler              = "dist/workers/matching.handler"
      reserved_concurrency = 8
      pool                 = "matching"
      proxy_endpoint       = module.db_proxy.proxy_endpoints["matching"]
      queue_arn            = module.queue_ingestao.queue_ref
    }
    notificacao = {
      handler              = "dist/workers/notificacao.handler"
      reserved_concurrency = 4
      pool                 = "triagem"
      proxy_endpoint       = module.db_proxy.proxy_endpoints["triagem"]
      queue_arn            = module.queue_alertas.queue_ref
    }
  }
}

module "identity" {
  source                  = "../../modules/identity"
  project                 = "radar"
  env                     = "prod"
  hosted_ui_domain_prefix = var.cognito_domain_prefix
  callback_urls           = var.cognito_callback_urls
  logout_urls             = var.cognito_logout_urls
  advanced_security_mode  = var.cognito_advanced_security_mode
}

# --- Tier sempre-ligado: registro → borda → serviço (RAD-199) --------------------------

module "registry" {
  source               = "../../modules/registry"
  project              = "radar"
  env                  = "prod"
  repository_name      = "api"
  encryption_key_ref   = var.kms_key_arn
  image_tag_mutability = "IMMUTABLE" # a task def de prod referencia um binário, não um ponteiro
}

module "waf" {
  source            = "../../modules/waf"
  project           = "radar"
  env               = "prod"
  rate_limit_per_ip = 2000
}

module "edge" {
  source            = "../../modules/edge"
  project           = "radar"
  env               = "prod"
  network_id        = module.vpc.network_id
  network_cidr      = module.vpc.network_cidr
  public_subnet_ids = module.vpc.public_subnet_ids
  certificate_ref   = var.tls_certificate_arn # obrigatório em prod (precondition no módulo)
  web_acl_ref       = module.waf.web_acl_ref
}

# O tier sempre-ligado: BFF + triagem-pool na MESMA task (P-96/RAD-59). `min_capacity = 2`
# é piso de HA (duas AZs) e absorvedor do degrau de scale-out (P-67). `max_capacity = 6` é
# bulkhead de conexão: o pool `triagem` do P-41 tem 10 backends no RDS Proxy.
module "compute" {
  source             = "../../modules/compute"
  project            = "radar"
  env                = "prod"
  region             = var.aws_region
  network_id         = module.vpc.network_id
  private_subnet_ids = module.vpc.private_subnet_ids

  container_image_uri = module.registry.repository_uri
  image_tag           = var.api_image_tag

  cpu          = 1024
  memory       = 2048
  min_capacity = 2
  max_capacity = 6

  database_url_secret_ref     = module.secrets.database_url_secret_ref
  field_crypto_key_secret_ref = module.secrets.field_crypto_key_secret_ref
  extra_secret_refs = {
    ANTHROPIC_API_KEY            = module.secrets.llm_api_key_secret_ref
    ASAAS_WEBHOOK_TOKEN          = module.secrets.asaas_webhook_token_secret_ref
    ASAAS_WEBHOOK_TOKEN_ANTERIOR = module.secrets.asaas_webhook_token_anterior_secret_ref
    ASAAS_API_KEY                = module.secrets.asaas_api_key_secret_ref
  }

  pooler_firewall_group_ref = module.db_proxy.firewall_group_ref
  encryption_key_ref        = var.kms_key_arn
  queue_refs = [
    module.queue_ingestao.queue_ref,
    module.queue_alertas_gravar.queue_ref,
    module.queue_alertas.queue_ref,
  ]

  bedrock_batch_service_role_ref = module.storage.batch_service_role_ref
  batch_bucket_ref               = module.storage.batch_bucket_ref

  # Borda: ingresso SG→SG, alvo das tasks e o resource label que destrava a política de escala
  # por requisição (o seam que RAD-192 deixou nulo esperando P-55).
  target_group_ref           = module.edge.target_group_ref
  edge_firewall_group_ref    = module.edge.firewall_group_ref
  request_scaling_target_ref = module.edge.request_scaling_target_ref

  # O target group sozinho não basta: criar serviço com balanceador exige que o TG já esteja
  # ASSOCIADO a um listener, e o grafo não enxerga essa aresta (o serviço só referencia o TG).
  # Sem isto o apply corre o risco de morrer em `InvalidParameterException: The target group
  # does not have an associated load balancer`.
  depends_on = [module.edge]

  # Config não-secreta. `AUTH_MODE=cognito` é o que `resolverConfigAuth` exige em
  # NODE_ENV=production (P-91, fail-closed): sem isto a task ABORTA no boot.
  environment = {
    AUTH_MODE            = "cognito"
    COGNITO_REGION       = var.aws_region
    COGNITO_USER_POOL_ID = module.identity.user_pool_id
    COGNITO_CLIENT_ID    = module.identity.app_client_id
    COGNITO_TENANT_CLAIM = module.identity.tenant_claim
    API_CORS_ORIGINS     = join(",", var.api_cors_origins)
    WORKERS_ENABLED      = "true"
  }
}
