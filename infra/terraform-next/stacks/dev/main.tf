# Stack dev — infra/terraform-next (RAD-181/RAD-182)
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
  network_cidr       = "10.0.0.0/16"
  availability_zones = ["${var.aws_region}a", "${var.aws_region}b"]
}

module "database" {
  source             = "../../modules/database"
  project            = "radar"
  env                = "dev"
  network_id         = module.vpc.network_id
  private_subnet_ids = module.vpc.private_subnet_ids
  db_username        = var.db_username
  db_password        = var.db_password
  encryption_key_ref = var.kms_key_arn
}

module "storage" {
  source             = "../../modules/storage"
  project            = "radar"
  env                = "dev"
  encryption_key_ref = var.kms_key_arn
}

module "queue_ingestao" {
  source             = "../../modules/queue"
  project            = "radar"
  env                = "dev"
  queue_name         = "editais-ingeridos"
  encryption_key_ref = var.kms_key_arn
}

module "queue_alertas" {
  source             = "../../modules/queue"
  project            = "radar"
  env                = "dev"
  queue_name         = "alertas-gerados"
  encryption_key_ref = var.kms_key_arn
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
}

# Seam serverless de P-27 — gated off (workers em Fargate no MVP-Now, P-96).
module "serverless" {
  source                   = "../../modules/serverless"
  count                    = var.enable_serverless_workers ? 1 : 0
  project                  = "radar"
  env                      = "dev"
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
  env                     = "dev"
  hosted_ui_domain_prefix = var.cognito_domain_prefix
  callback_urls           = var.cognito_callback_urls
  logout_urls             = var.cognito_logout_urls
  advanced_security_mode  = var.cognito_advanced_security_mode
}
