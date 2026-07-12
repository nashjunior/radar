# Módulo: storage
# Object storage para anexos de editais e para o I/O do batch inference do Bedrock (P-92).
# LGPD 13.709/2018 — cifra em repouso e versionamento obrigatórios (P-05/P-44).
# Binding hoje = AWS S3 (+ IAM role de serviço do Bedrock). Contrato usa
# `encryption_key_ref`/`bucket_ref`/`batch_*_ref`.
# Refs: arquitetura/08 §4; docs/12 §4; docs/98 P-92; RAD-181/RAD-182/RAD-231/RAD-236

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

data "aws_caller_identity" "current" {}

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

# --- Batch inference do Bedrock (P-92/RAD-231/RAD-236) --------------------------------
#
# Bucket dedicado ao I/O do `CreateModelInvocationJob` — não os anexos acima: principal
# de acesso (bedrock.amazonaws.com) e padrão de retenção (transiente, não custódia de
# documento) são outros; separar reduz o raio de um IAM mal escopado. Prefixos fixos
# `batch/input/` (o worker grava o JSONL do lote) e `batch/output/` (o Bedrock escreve
# o resultado) — mesma convenção usada nas policies abaixo e no módulo `compute`.

resource "aws_s3_bucket" "batch" {
  bucket = "${var.project}-${var.env}-batch-llm"
  tags   = local.tags
}

resource "aws_s3_bucket_versioning" "batch" {
  bucket = aws_s3_bucket.batch.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "batch" {
  bucket = aws_s3_bucket.batch.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.encryption_key_ref
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "batch" {
  bucket = aws_s3_bucket.batch.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Expurgo do JSONL de trabalho — ver rationale em variables.tf (batch_lifecycle_expiration_days).
resource "aws_s3_bucket_lifecycle_configuration" "batch" {
  bucket = aws_s3_bucket.batch.id

  rule {
    id     = "expira-batch-io"
    status = "Enabled"

    filter {
      prefix = "batch/"
    }

    expiration {
      days = var.batch_lifecycle_expiration_days
    }

    noncurrent_version_expiration {
      noncurrent_days = var.batch_lifecycle_expiration_days
    }
  }
}

# Service role que o Bedrock assume para ler `batch/input/` e escrever `batch/output/`.
# Trust policy com `aws:SourceAccount`/`aws:SourceArn` (anti confused-deputy — padrão
# documentado pela AWS para a service role de batch inference).
resource "aws_iam_role" "bedrock_batch" {
  name = "${var.project}-${var.env}-bedrock-batch-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "bedrock.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
        ArnEquals = {
          "aws:SourceArn" = "arn:aws:bedrock:${var.region}:${data.aws_caller_identity.current.account_id}:model-invocation-job/*"
        }
      }
    }]
  })

  tags = local.tags
}

# S3: só o prefixo de entrada (leitura) e o de saída (escrita) — nada de acesso cruzado
# nem ao bucket de anexos. `s3:ListBucket` fica condicionado ao `s3:prefix`, porque o
# input do job pode ser uma pasta (múltiplos JSONL), não só uma chave.
resource "aws_iam_role_policy" "bedrock_batch_s3" {
  name = "${var.project}-${var.env}-bedrock-batch-s3"
  role = aws_iam_role.bedrock_batch.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadInput"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = ["${aws_s3_bucket.batch.arn}/batch/input/*"]
      },
      {
        Sid      = "WriteOutput"
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = ["${aws_s3_bucket.batch.arn}/batch/output/*"]
      },
      {
        Sid      = "ListPrefixes"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [aws_s3_bucket.batch.arn]
        Condition = {
          StringLike = { "s3:prefix" = ["batch/input/*", "batch/output/*"] }
        }
      },
      {
        Sid      = "Decrypt"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey"]
        Resource = [var.encryption_key_ref]
        Condition = {
          StringEquals = { "kms:ViaService" = "s3.${var.region}.amazonaws.com" }
        }
      },
    ]
  })
}

# `bedrock:InvokeModel` na service role é exigência da AWS para batch inference COM
# inference profile — que é o caso aqui (P-93: submissão sa-east-1 via cross-region
# inference profile). Sem isto o job cai em AccessDenied, apesar do S3/KMS estarem OK.
# Escopado a modelos Anthropic + inference profiles desta conta (nunca "Resource: *").
resource "aws_iam_role_policy" "bedrock_batch_invoke" {
  name = "${var.project}-${var.env}-bedrock-batch-invoke"
  role = aws_iam_role.bedrock_batch.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "CrossRegionInference"
      Effect = "Allow"
      Action = ["bedrock:InvokeModel"]
      Resource = [
        "arn:aws:bedrock:${var.region}:${data.aws_caller_identity.current.account_id}:inference-profile/*",
        "arn:aws:bedrock:*::foundation-model/anthropic.*",
      ]
    }]
  })
}
