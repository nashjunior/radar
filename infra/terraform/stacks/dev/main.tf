terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
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
  vpc_cidr           = "10.0.0.0/16"
  availability_zones = ["${var.aws_region}a", "${var.aws_region}b"]
}

module "database" {
  source      = "../../modules/database"
  project     = "radar"
  env         = "dev"
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
  env         = "dev"
  kms_key_arn = var.kms_key_arn
}

module "queue_ingestao" {
  source      = "../../modules/queue"
  project     = "radar"
  env         = "dev"
  queue_name  = "editais-ingeridos"
  kms_key_arn = var.kms_key_arn
}

module "queue_alertas" {
  source      = "../../modules/queue"
  project     = "radar"
  env         = "dev"
  queue_name  = "alertas-gerados"
  kms_key_arn = var.kms_key_arn
}

module "secrets" {
  source      = "../../modules/secrets"
  project     = "radar"
  env         = "dev"
  kms_key_arn = var.kms_key_arn
}
