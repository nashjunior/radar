# Módulo: db_proxy
# Pool de conexão gerenciado (A08 §4). Binding hoje: RDS Proxy em MODO TRANSAÇÃO na frente
# do Aurora PostgreSQL (P-41/RAD-165). Um proxy POR WORKLOAD = o bulkhead físico: a rajada
# da ingestão não engole o caminho crítico do alerta (DB3, "pool dedicado"). Cada proxy tem
# seu próprio pool; `max_connections_percent` fatia o max_connections=200 do banco de modo
# que a SOMA dos pools fique < 200 com folga de admin.
#
# Modo transação (multiplexação por transação) é o comportamento NATIVO do RDS Proxy para
# PostgreSQL — não há toggle. A pegadinha é o PIN (ver README). Vigie
# `DatabaseConnectionsCurrentlySessionPinned` (alarme abaixo).
#
# CONTRATO neutro (variables/outputs) · IMPLEMENTAÇÃO provider-bound (este main.tf).
# Refs: arquitetura/05 §6, arquitetura/08 §§3,4, docs/98 P-41/P-27.

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

  # Soma dos backends reais reservados pelos pools (percentual × max_connections),
  # exposta em output para o gate "soma < max_connections com folga admin" (P-41).
  backends_reservados = sum([
    for _, p in var.pools : ceil(p.max_connections_percent / 100 * var.db_max_connections)
  ])
}

# IAM: o proxy lê as credenciais {username,password} do Secrets Manager (auth=SECRETS)
# e decifra o segredo com a chave de cifra do ambiente. Nada de senha em variável de proxy.
data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "proxy" {
  name               = "${var.project}-${var.env}-rdsproxy-role"
  assume_role_policy = data.aws_iam_policy_document.assume.json
  tags               = local.tags
}

data "aws_iam_policy_document" "secret_access" {
  statement {
    sid     = "ReadDbCredentials"
    actions = ["secretsmanager:GetSecretValue"]
    # Secret compartilhado + qualquer secret por-pool (auth como role do pool, P-41).
    resources = distinct(concat(
      [var.db_credentials_secret_ref],
      [for _, p in var.pools : p.secret_ref if p.secret_ref != null],
    ))
  }
  statement {
    sid       = "DecryptSecret"
    actions   = ["kms:Decrypt"]
    resources = [var.encryption_key_ref]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${var.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "proxy" {
  name   = "${var.project}-${var.env}-rdsproxy-secret"
  role   = aws_iam_role.proxy.id
  policy = data.aws_iam_policy_document.secret_access.json
}

# SG do proxy: clientes da VPC (workers/seam serverless/Fargate) → 5432 do proxy.
resource "aws_security_group" "proxy" {
  name        = "${var.project}-${var.env}-rdsproxy-sg"
  description = "Acesso ao RDS Proxy — somente da VPC interna"
  vpc_id      = var.network_id

  ingress {
    description = "Postgres via proxy — clientes internos da VPC"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [var.network_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.tags
}

# ENFORCE "nunca pro RDS direto" (P-41) na camada de rede: o banco só aceita 5432 DO SG do
# proxy. O SG do banco (módulo database) não tem mais ingress amplo por CIDR — este é o
# único caminho para o cluster. Break-glass/migração via bastion = regra temporária à parte.
resource "aws_vpc_security_group_ingress_rule" "db_from_proxy" {
  security_group_id            = var.db_firewall_group_ref
  referenced_security_group_id = aws_security_group.proxy.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "RDS Proxy → banco (P-41: só o proxy alcança o cluster)"

  tags = local.tags
}

# Um proxy por pool (for_each) — o isolamento é físico.
resource "aws_db_proxy" "this" {
  for_each = var.pools

  name           = "${var.project}-${var.env}-${each.key}"
  engine_family  = "POSTGRESQL"
  role_arn       = aws_iam_role.proxy.arn
  vpc_subnet_ids = var.private_subnet_ids

  # TLS obrigatório cliente→proxy (LGPD 13.709/2018 — dado em trânsito cifrado).
  require_tls = true

  # Fecha conexão de cliente ociosa e devolve o backend ao pool (protege DB5).
  idle_client_timeout = each.value.idle_client_timeout

  vpc_security_group_ids = [aws_security_group.proxy.id]

  # Auth proxy→banco. Default = secret master compartilhado. Se o pool declarar seu
  # próprio secret (role do pool), o proxy autentica COMO essa role → herda os
  # statement_timeout/lock_timeout por role (ALTER ROLE) sem pinar. Ver README/runbook.
  auth {
    auth_scheme = "SECRETS"
    secret_arn  = coalesce(each.value.secret_ref, var.db_credentials_secret_ref)
    iam_auth    = "DISABLED"
  }

  debug_logging = var.debug_logging

  tags = merge(local.tags, { pool = each.key })
}

# Pool de conexão por proxy — a fatia do max_connections=200 e o comportamento de borrow.
resource "aws_db_proxy_default_target_group" "this" {
  for_each = var.pools

  db_proxy_name = aws_db_proxy.this[each.key].name

  connection_pool_config {
    max_connections_percent = each.value.max_connections_percent
    # AWS exige max_idle <= max_connections_percent; default = o próprio percent do pool
    # (mantém os backends do bulkhead quentes). Nunca 50 fixo (estouraria pools de 3–8 %).
    max_idle_connections_percent = coalesce(each.value.max_idle_connections_percent, each.value.max_connections_percent)
    connection_borrow_timeout    = each.value.connection_borrow_timeout
    # session_pinning_filters é MySQL-only; em PostgreSQL o anti-pin é disciplina de
    # driver (sem SET de sessão / advisory de sessão / prepared nomeado) — ver README.
  }
}

# Alvo: o cluster Aurora. O proxy roteia p/ o writer (e readers, quando houver).
resource "aws_db_proxy_target" "this" {
  for_each = var.pools

  db_proxy_name         = aws_db_proxy.this[each.key].name
  target_group_name     = aws_db_proxy_default_target_group.this[each.key].name
  db_cluster_identifier = var.cluster_ref
}

# Pegadinha do modo transação: se qualquer sessão fixar (pin) a conexão, a
# multiplexação degrada e o pool satura. Alarme por proxy — qualquer pin sustentado
# é bug de driver a caçar (P-41).
resource "aws_cloudwatch_metric_alarm" "session_pinned" {
  for_each = var.pools

  alarm_name          = "${var.project}-${var.env}-${each.key}-session-pinned"
  namespace           = "AWS/RDS"
  metric_name         = "DatabaseConnectionsCurrentlySessionPinned"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.session_pinned_threshold
  treat_missing_data  = "notBreaching"
  alarm_description   = "RDS Proxy ${each.key}: conexões fixadas (pin) — modo transação degradado (P-41)"

  dimensions = {
    ProxyName = aws_db_proxy.this[each.key].name
  }

  alarm_actions = var.alarm_topic_ref == "" ? [] : [var.alarm_topic_ref]
  ok_actions    = var.alarm_topic_ref == "" ? [] : [var.alarm_topic_ref]

  tags = merge(local.tags, { pool = each.key })
}
