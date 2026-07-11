# Módulo: storage
# Object storage para anexos de editais.
# LGPD 13.709/2018 — cifra em repouso e versionamento obrigatórios (P-05/P-44).
# Binding hoje = AWS S3. Contrato usa `encryption_key_ref`/`bucket_ref`.
# Refs: arquitetura/08 §4; docs/12 §4; RAD-181/RAD-182

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
      kms_master_key_id = var.encryption_key_ref
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
