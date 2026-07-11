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
    tags = { project = "radar", environment = "staging", managed_by = "terraform" }
  }
}

module "vpc" {
  source             = "../../modules/vpc"
  project            = "radar"
  env                = "staging"
  vpc_cidr           = "10.1.0.0/16"
  availability_zones = ["${var.aws_region}a", "${var.aws_region}b"]
}

module "database" {
  source      = "../../modules/database"
  project     = "radar"
  env         = "staging"
  vpc_id      = module.vpc.vpc_id
  vpc_cidr    = module.vpc.vpc_cidr
  subnet_ids  = module.vpc.private_subnet_ids
  db_username = var.db_username
  db_password = var.db_password
  kms_key_arn = var.kms_key_arn
}

module "storage" {
  source      = "../../modules/storage"
  project     = "radar"
  env         = "staging"
  kms_key_arn = var.kms_key_arn
}

module "queue_ingestao" {
  source      = "../../modules/queue"
  project     = "radar"
  env         = "staging"
  queue_name  = "editais-ingeridos"
  kms_key_arn = var.kms_key_arn
}

module "queue_alertas" {
  source      = "../../modules/queue"
  project     = "radar"
  env         = "staging"
  queue_name  = "alertas-gerados"
  kms_key_arn = var.kms_key_arn
}

module "secrets" {
  source      = "../../modules/secrets"
  project     = "radar"
  env         = "staging"
  kms_key_arn = var.kms_key_arn
}

# RDS Proxy em modo transação + bulkheads por workload (P-41/RAD-165).
# Usa a decomposição de 5 pools default do módulo (custo colapsável por env — ver README).
module "db_proxy" {
  source                    = "../../modules/db_proxy"
  project                   = "radar"
  env                       = "staging"
  aws_region                = var.aws_region
  vpc_id                    = module.vpc.vpc_id
  vpc_cidr                  = module.vpc.vpc_cidr
  subnet_ids                = module.vpc.private_subnet_ids
  db_cluster_id             = module.database.cluster_id
  db_security_group_id      = module.database.security_group_id
  db_max_connections        = module.database.max_connections
  db_credentials_secret_arn = module.secrets.db_credentials_secret_arn
  kms_key_arn               = var.kms_key_arn
  debug_logging             = true
}

# Seam serverless de P-27 — provisionado e validado, gated off (workers em Fargate no
# MVP-Now, P-96). reserved_concurrency = teto de conexões ao banco (P-41).
module "serverless" {
  source                  = "../../modules/serverless"
  count                   = var.enable_serverless_workers ? 1 : 0
  project                 = "radar"
  env                     = "staging"
  aws_region              = var.aws_region
  vpc_id                  = module.vpc.vpc_id
  subnet_ids              = module.vpc.private_subnet_ids
  proxy_security_group_id = module.db_proxy.security_group_id
  kms_key_arn             = var.kms_key_arn
  secret_arns             = [module.secrets.database_url_secret_arn, module.secrets.field_crypto_key_secret_arn]
  database_url_secret_arn = module.secrets.database_url_secret_arn
  enabled                 = false

  functions = {
    ingestao = {
      handler              = "dist/workers/ingestao.handler"
      reserved_concurrency = 12
      pool                 = "ingestao"
      proxy_endpoint       = module.db_proxy.proxy_endpoints["ingestao"]
      queue_arn            = null # agendada (EventBridge) — polling do PNCP
    }
    matching = {
      handler              = "dist/workers/matching.handler"
      reserved_concurrency = 8
      pool                 = "matching"
      proxy_endpoint       = module.db_proxy.proxy_endpoints["matching"]
      queue_arn            = module.queue_ingestao.queue_arn
    }
    notificacao = {
      handler              = "dist/workers/notificacao.handler"
      reserved_concurrency = 4
      pool                 = "triagem" # fora do pool matching p/ não somar 12 sobre 10 backends
      proxy_endpoint       = module.db_proxy.proxy_endpoints["triagem"]
      queue_arn            = module.queue_alertas.queue_arn
    }
  }
}

module "identity" {
  source                  = "../../modules/identity"
  project                 = "radar"
  env                     = "staging"
  hosted_ui_domain_prefix = var.cognito_domain_prefix
  callback_urls           = var.cognito_callback_urls
  logout_urls             = var.cognito_logout_urls
  advanced_security_mode  = var.cognito_advanced_security_mode
}
