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

# SG do banco SEM ingress inline — o único caminho ao cluster é o RDS Proxy, que adiciona
# a regra de ingress 5432 do SEU SG (P-41: "nunca pro RDS direto"). Regras standalone (não
# inline) para o módulo db_proxy poder anexar ingress sem conflito de rule-set. Um bastion
# de migração/break-glass adiciona sua própria regra temporária à parte.
resource "aws_security_group" "db" {
  name        = "${var.project}-${var.env}-db-sg"
  description = "Acesso ao banco — somente via RDS Proxy (P-41)"
  vpc_id      = var.vpc_id

  tags = local.tags
}

resource "aws_vpc_security_group_egress_rule" "db_all" {
  security_group_id = aws_security_group.db.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
  description       = "Egress do banco (respostas / replicação gerenciada)"
}

# Parameter group instância — pisos do pool (P-41, arq/05 §6).
# Valores GLOBAIS de partida; os statement_timeout/lock_timeout POR POOL (30/10/5/60/300 s
# e 3 s) são aplicados por role no bootstrap (`ALTER ROLE <pool> SET statement_timeout=...`)
# — em modo transação não se fixa via SET de sessão, então o piso global fica aqui e o
# refinamento por workload nas roles. Autovacuum agressivo de EDITAL/ALERTA é por-tabela
# (migração), não global. Refs: docs/98 P-41/RAD-165, arquitetura/05 §6, arquitetura/08 §3.
resource "aws_db_parameter_group" "this" {
  name        = "${var.project}-${var.env}-pg16-pool"
  family      = "aurora-postgresql16"
  description = "Pisos de pool/timeout/work_mem — P-41 (RAD-165)"

  # Teto modesto de propósito: concorrência ATIVA útil num OLTP ≈ (vCPU×2)+I/O.
  # Os pools do proxy somam < 200 com folga p/ admin/superuser. Estático → reboot.
  parameter {
    name         = "max_connections"
    value        = tostring(var.max_connections)
    apply_method = "pending-reboot"
  }

  # work_mem por nó de sort/hash × conexão; 16 MB (16384 kB) limita o total e evita
  # temp file no fan-out de 1–5 mil critérios. Analítico sobe local (SET LOCAL) até 128 MB.
  parameter {
    name  = "work_mem"
    value = "16384"
  }

  # index build / ATTACH / vacuum — 512 MB (524288 kB).
  parameter {
    name  = "maintenance_work_mem"
    value = "524288"
  }

  # Mata transação vazada e protege o pool (DB5, "sem vazar conexão"). 30 s.
  parameter {
    name  = "idle_in_transaction_session_timeout"
    value = "30000"
  }

  # Backstop global contra query infinita (5 min = teto do pool de jobs). Os pisos
  # POR POOL (5/10/30 s nos quentes) são tightening por role — nunca afrouxam este teto.
  parameter {
    name  = "statement_timeout"
    value = tostring(var.statement_timeout_ms)
  }

  # 0 = espera indefinida GLOBAL (jobs/index build precisam esperar lock). Os pools
  # quentes (interativo+ingestão) recebem lock_timeout=3 s por role (upsert falha rápido
  # e re-tenta idempotente, DB1) — não aqui, senão quebra DETACH/index build.
  parameter {
    name  = "lock_timeout"
    value = tostring(var.lock_timeout_ms)
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
  cluster_identifier      = aws_rds_cluster.this.id
  instance_class          = "db.serverless"
  engine                  = aws_rds_cluster.this.engine
  engine_version          = aws_rds_cluster.this.engine_version
  publicly_accessible     = false
  db_parameter_group_name = aws_db_parameter_group.this.name

  tags = local.tags
}

locals {
  tags = {
    project     = var.project
    environment = var.env
    managed_by  = "terraform"
  }
}
