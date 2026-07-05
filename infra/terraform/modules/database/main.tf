# Módulo: database
# PostgreSQL gerenciado (RDS Aurora Serverless v2 ou equivalente portável).
# Topologia: single-AZ no dev/staging, Multi-AZ no prod.
# Refs: arquitetura/08 §4, docs/98 P-28/P-64

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.project}-${var.env}-db-subnet-group"
  subnet_ids = var.subnet_ids

  tags = local.tags
}

resource "aws_security_group" "db" {
  name        = "${var.project}-${var.env}-db-sg"
  description = "Acesso ao banco de dados — somente da VPC interna"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.tags
}

resource "aws_rds_cluster" "this" {
  cluster_identifier     = "${var.project}-${var.env}"
  engine                 = "aurora-postgresql"
  engine_mode            = "provisioned"
  engine_version         = "16.4"
  database_name          = var.db_name
  master_username        = var.db_username
  master_password        = var.db_password
  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.db.id]

  serverlessv2_scaling_configuration {
    min_capacity = var.env == "prod" ? 0.5 : 0.5
    max_capacity = var.env == "prod" ? 16 : 4
  }

  backup_retention_period = var.env == "prod" ? 7 : 1
  deletion_protection     = var.env == "prod"

  # LGPD 13.709/2018 — dados em repouso cifrados obrigatoriamente
  storage_encrypted = true
  kms_key_id        = var.kms_key_arn

  tags = local.tags
}

resource "aws_rds_cluster_instance" "writer" {
  cluster_identifier   = aws_rds_cluster.this.id
  instance_class       = "db.serverless"
  engine               = aws_rds_cluster.this.engine
  engine_version       = aws_rds_cluster.this.engine_version
  publicly_accessible  = false

  tags = local.tags
}

locals {
  tags = {
    project     = var.project
    environment = var.env
    managed_by  = "terraform"
  }
}
