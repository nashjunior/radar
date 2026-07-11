# Stack dev — infra/terraform (rewrite provider-agnóstico RAD-181/RAD-182, swapado 2026-07-11)
# Mesmas instâncias de módulo e mesmas chaves de pool/function do stack atual
# para garantir paridade de endereços de estado. Variáveis de módulo usam
# o vocabulário neutro (network_id, encryption_key_ref, *_secret_ref, etc.).

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
    tags = {
      project     = "radar"
      environment = "dev"
      managed_by  = "terraform"
    }
  }
}

module "vpc" {
  source             = "../../modules/vpc"
  project            = "radar"
  env                = "dev"
  region             = var.aws_region
  network_cidr       = "10.0.0.0/16"
  availability_zones = ["${var.aws_region}a", "${var.aws_region}b"]

  # Um gateway de saída só (RAD-199): fora de prod, a queda da AZ dele custa indisponibilidade
  # de ambiente de teste, não de cliente — e cada gateway extra é ~US$ 32/mês parado.
  egress_gateway_count = 1
}

module "database" {
  source             = "../../modules/database"
  project            = "radar"
  env                = "dev"
  network_id         = module.vpc.network_id
  network_cidr       = module.vpc.network_cidr
  private_subnet_ids = module.vpc.private_subnet_ids
  db_username        = var.db_username
  db_password        = var.db_password
  encryption_key_ref = var.kms_key_arn

  # Custo (dev): auto-pause — o banco cai a 0 ACU (~$0 compute, só storage) quando ocioso e
  # resume em ~15s no 1º acesso. Prod/staging NÃO passam isto → mantêm o piso 0.5 (P-67).
  min_capacity_acu = 0
}

module "storage" {
  source             = "../../modules/storage"
  project            = "radar"
  env                = "dev"
  encryption_key_ref = var.kms_key_arn
}

# Topologia de fan-out (RAD-179) — ver o stack prod para o racional completo de cada valor.
#   editais-ingeridos --[MatchingWorker]--> alertas-a-gravar --[batch INSERT]--> alertas-gerados

module "queue_ingestao" {
  source             = "../../modules/queue"
  project            = "radar"
  env                = "dev"
  queue_name         = "editais-ingeridos"
  encryption_key_ref = var.kms_key_arn

  visibility_timeout = 180
  max_receive_count  = 5
}

# Buffer do batch INSERT (`filaAlertaQueueUrl`) — não existia na IaC (RAD-192).
module "queue_alertas_gravar" {
  source             = "../../modules/queue"
  project            = "radar"
  env                = "dev"
  queue_name         = "alertas-a-gravar"
  encryption_key_ref = var.kms_key_arn

  visibility_timeout = 60
  max_receive_count  = 5
}

module "queue_alertas" {
  source             = "../../modules/queue"
  project            = "radar"
  env                = "dev"
  queue_name         = "alertas-gerados"
  encryption_key_ref = var.kms_key_arn

  visibility_timeout = 60
  max_receive_count  = 5
}

module "secrets" {
  source             = "../../modules/secrets"
  project            = "radar"
  env                = "dev"
  encryption_key_ref = var.kms_key_arn
}

# RDS Proxy em modo transação + bulkheads por workload (P-41/RAD-165).
module "db_proxy" {
  source                    = "../../modules/db_proxy"
  project                   = "radar"
  env                       = "dev"
  region                    = var.aws_region
  network_id                = module.vpc.network_id
  network_cidr              = module.vpc.network_cidr
  private_subnet_ids        = module.vpc.private_subnet_ids
  cluster_ref               = module.database.cluster_ref
  db_firewall_group_ref     = module.database.firewall_group_ref
  db_max_connections        = module.database.max_connections
  db_credentials_secret_ref = module.secrets.db_credentials_secret_ref
  encryption_key_ref        = var.kms_key_arn
  debug_logging             = true

  # Custo (dev): 1 proxy só, em vez dos 5 bulkheads default — RDS Proxy é cobrado POR proxy.
  # Os bulkheads por workload existem pra isolar rajada sob carga em PROD; dev não tem essa
  # carga. Colapso sancionado pelo módulo (db_proxy/variables.tf §pools). Prod mantém os 5.
  pools = {
    # idle_client_timeout curto (5 min) pro proxy não segurar conexão ociosa — senão o Aurora
    # vê conexão viva e NUNCA cai a 0 ACU, anulando o auto-pause do banco (min_capacity_acu=0).
    ingestao = { max_connections_percent = 40, idle_client_timeout = 300 }
  }
}

# Seam serverless de P-27 — gated off (workers em Fargate no MVP-Now, P-96).
module "serverless" {
  source                   = "../../modules/serverless"
  count                    = var.enable_serverless_workers ? 1 : 0
  project                  = "radar"
  env                      = "dev"
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
    # dev colapsa pra 1 proxy (ver módulo db_proxy acima): todos os workers do seam gated-off
    # apontam pro pool único "ingestao". Prod mantém os pools por-workload.
    matching = {
      handler              = "dist/workers/matching.handler"
      reserved_concurrency = 8
      pool                 = "ingestao"
      proxy_endpoint       = module.db_proxy.proxy_endpoints["ingestao"]
      queue_arn            = module.queue_ingestao.queue_ref
    }
    notificacao = {
      handler              = "dist/workers/notificacao.handler"
      reserved_concurrency = 4
      pool                 = "ingestao"
      proxy_endpoint       = module.db_proxy.proxy_endpoints["ingestao"]
      queue_arn            = module.queue_alertas.queue_ref
    }
  }
}

module "identity" {
  source                  = "../../modules/identity"
  project                 = "radar"
  env                     = "dev"
  hosted_ui_domain_prefix = var.cognito_domain_prefix
  callback_urls           = var.cognito_callback_urls
  logout_urls             = var.cognito_logout_urls
  advanced_security_mode  = var.cognito_advanced_security_mode
}


# --- Tier sempre-ligado: registro → borda → serviço (RAD-199) --------------------------

module "registry" {
  source               = "../../modules/registry"
  project              = "radar"
  env                  = "dev"
  repository_name      = "api"
  encryption_key_ref   = var.kms_key_arn
  image_tag_mutability = "MUTABLE" # re-push da mesma tag no ciclo de desenvolvimento
}

module "waf" {
  source            = "../../modules/waf"
  project           = "radar"
  env               = "dev"
  rate_limit_per_ip = 5000
}

module "edge" {
  source            = "../../modules/edge"
  project           = "radar"
  env               = "dev"
  network_id        = module.vpc.network_id
  network_cidr      = module.vpc.network_cidr
  public_subnet_ids = module.vpc.public_subnet_ids
  certificate_ref   = var.tls_certificate_arn # nulo = HTTP puro; só o módulo de prod exige TLS
  web_acl_ref       = module.waf.web_acl_ref
}

# Tier sempre-ligado (BFF + triagem-pool na mesma task, P-96). Ver stack prod para o racional
# de min/max e do wiring da borda.
module "compute" {
  source             = "../../modules/compute"
  project            = "radar"
  env                = "dev"
  region             = var.aws_region
  network_id         = module.vpc.network_id
  private_subnet_ids = module.vpc.private_subnet_ids

  container_image_uri = module.registry.repository_uri
  image_tag           = var.api_image_tag

  cpu          = 512
  memory       = 1024
  min_capacity = 1
  max_capacity = 2

  database_url_secret_ref     = module.secrets.database_url_secret_ref
  field_crypto_key_secret_ref = module.secrets.field_crypto_key_secret_ref
  extra_secret_refs           = { ANTHROPIC_API_KEY = module.secrets.llm_api_key_secret_ref }

  pooler_firewall_group_ref = module.db_proxy.firewall_group_ref
  encryption_key_ref        = var.kms_key_arn
  queue_refs = [
    module.queue_ingestao.queue_ref,
    module.queue_alertas_gravar.queue_ref,
    module.queue_alertas.queue_ref,
  ]

  target_group_ref           = module.edge.target_group_ref
  edge_firewall_group_ref    = module.edge.firewall_group_ref
  request_scaling_target_ref = module.edge.request_scaling_target_ref

  # O target group sozinho não basta: criar serviço com balanceador exige que o TG já esteja
  # ASSOCIADO a um listener, e o grafo não enxerga essa aresta (o serviço só referencia o TG).
  # Sem isto o apply corre o risco de morrer em `InvalidParameterException: The target group
  # does not have an associated load balancer`.
  depends_on = [module.edge]

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
