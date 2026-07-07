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
  vpc_cidr           = "10.2.0.0/16"
  availability_zones = ["${var.aws_region}a", "${var.aws_region}b", "${var.aws_region}c"]
}

module "database" {
  source      = "../../modules/database"
  project     = "radar"
  env         = "prod"
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
  env         = "prod"
  kms_key_arn = var.kms_key_arn
}

module "queue_ingestao" {
  source      = "../../modules/queue"
  project     = "radar"
  env         = "prod"
  queue_name  = "editais-ingeridos"
  kms_key_arn = var.kms_key_arn
}

module "queue_alertas" {
  source      = "../../modules/queue"
  project     = "radar"
  env         = "prod"
  queue_name  = "alertas-gerados"
  kms_key_arn = var.kms_key_arn
}

module "secrets" {
  source      = "../../modules/secrets"
  project     = "radar"
  env         = "prod"
  kms_key_arn = var.kms_key_arn
}

module "identity" {
  source                  = "../../modules/identity"
  project                 = "radar"
  env                     = "prod"
  hosted_ui_domain_prefix = var.cognito_domain_prefix
  callback_urls           = var.cognito_callback_urls
  logout_urls             = var.cognito_logout_urls
  advanced_security_mode  = var.cognito_advanced_security_mode
  # TTLs e advanced_security assumem os defaults seguros do módulo (id/access 15min,
  # refresh 7d com rotação+revogação, Advanced Security ENFORCED). P-53 / RAD-130.
}
