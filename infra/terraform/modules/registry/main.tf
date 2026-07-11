# Módulo: registry
# Registro de imagens OCI do tier sempre-ligado. Binding hoje = AWS ECR.
# Contrato usa `repository_uri`/`repository_ref` + `encryption_key_ref` (neutros).
# Existe porque `compute.container_image_uri` não tinha PARA ONDE APONTAR: não havia
# repositório de imagem em nenhum stack nem Dockerfile no repo (RAD-199).
# Refs: arquitetura/08 §§4,6 (scan de imagem, P-56); docs/98 P-64; RAD-199

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

resource "aws_ecr_repository" "this" {
  name = "${var.project}-${var.env}/${var.repository_name}"

  # Tag imutável = a mesma tag nunca aponta pra dois binários. É o que faz `image_tag` ser
  # uma referência AUDITÁVEL (a task def fixa a tag; o rollback volta pra imagem, não pra um
  # ponteiro que alguém reescreveu). Dev/staging afrouxam pra permitir re-push da mesma tag.
  image_tag_mutability = var.image_tag_mutability

  # Gate de segurança de A08 §6 (P-56): scan a cada push.
  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = var.encryption_key_ref
  }

  tags = local.tags
}

# Imagem sem tag = camada órfã de push sobrescrito; acumula e é custo puro. Imagem tagueada
# antiga é rollback — por isso o corte é por CONTAGEM, não por idade.
resource "aws_ecr_lifecycle_policy" "this" {
  repository = aws_ecr_repository.this.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expira imagem sem tag após ${var.untagged_retention_days} dias"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = var.untagged_retention_days
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Mantém as ${var.tagged_image_count} imagens tagueadas mais recentes (janela de rollback)"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = var.tagged_image_count
        }
        action = { type = "expire" }
      },
    ]
  })
}
