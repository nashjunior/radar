# Módulo: storage
# Object storage S3-compatível para anexos de editais.
# LGPD 13.709/2018 — criptografia em repouso e versioning obrigatórios.
# Refs: arquitetura/08 §4, docs/12 §4

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

resource "aws_s3_bucket" "anexos" {
  bucket = "${var.project}-${var.env}-anexos"
  tags   = local.tags
}

resource "aws_s3_bucket_versioning" "anexos" {
  bucket = aws_s3_bucket.anexos.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "anexos" {
  bucket = aws_s3_bucket.anexos.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.kms_key_arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "anexos" {
  bucket = aws_s3_bucket.anexos.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

locals {
  tags = {
    project     = var.project
    environment = var.env
    managed_by  = "terraform"
  }
}
