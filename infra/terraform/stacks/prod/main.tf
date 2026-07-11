# Stack prod — infra/terraform (rewrite provider-agnóstico RAD-181/RAD-182, swapado 2026-07-11)
# Mesmas instâncias de módulo e mesmas chaves de pool/function do stack atual
# para garantir paridade de endereços de estado.

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
  network_cidr       = "10.2.0.0/16"
  availability_zones = ["${var.aws_region}a", "${var.aws_region}b", "${var.aws_region}c"]
}

module "database" {
  source             = "../../modules/database"
  project            = "radar"
  env                = "prod"
  network_id         = module.vpc.network_id
  private_subnet_ids = module.vpc.private_subnet_ids
  db_username        = var.db_username
  db_password        = var.db_password
  encryption_key_ref = var.kms_key_arn

  # Piso de 2 ACU (P-67): 0,5 ACU = 1 GB não segura o working set do fan-out e vira seq scan
  # frio sob rajada — o statement_timeout de 10 s do pool `matching` mata a query e o retry
  # fura o frescor. Piso de PARTIDA; confirmar por medição no unblock (A09 EL1/EL3, RAD-162).
  min_capacity_acu = 2
  max_capacity_acu = 16

  # HA: writer + reader em outra AZ. É isto que "Multi-AZ" significa em Aurora — o motivo é
  # failover (~30–60 s vs. reconstrução de minutos), não read-scaling. Custo: o piso de ACU
  # é cobrado por instância (2 x 2 ACU = 4 ACU-h de piso 24/7).
  instance_count = 2
}

module "storage" {
  source             = "../../modules/storage"
  project            = "radar"
  env                = "prod"
  encryption_key_ref = var.kms_key_arn
}

# Topologia de fan-out (RAD-179), na ordem em que a mensagem anda:
#   editais-ingeridos --[MatchingWorker: casa 1 edital com N critérios]--> alertas-a-gravar
#   alertas-a-gravar  --[ConsumidorAlertaBatch: 1 INSERT multi-row]------> alertas-gerados
#
# Cada fila tem visibility >= algumas vezes o p99 do SEU consumidor, e o produto
# visibility x max_receive respeita o orçamento de reentrega (900 s) — ver módulo `queue`.

# Consumidor: MatchingWorker. É o mais pesado do sistema — 1 edital popular casa com N mil
# critérios (A04 S4, A06) e HOJE o produtor faz um SendMessage SERIAL por alerta, o que põe
# o p99 na casa das dezenas de segundos. Com os 30 s de visibility que estavam aqui, um
# edital popular estoura o timeout, é REENTREGUE e re-emite alertas (duplicata) até morrer
# na DLQ. 180 s dá folga ao consumidor de hoje; o conserto de verdade é SendMessageBatch no
# app (RAD-194), que derruba o p99 pra < 10 s e deixa estes 180 s com folga de ~18x.
module "queue_ingestao" {
  source             = "../../modules/queue"
  project            = "radar"
  env                = "prod"
  queue_name         = "editais-ingeridos"
  encryption_key_ref = var.kms_key_arn

  visibility_timeout = 180
  max_receive_count  = 5 # 180 x 5 = 900 s — no limite do orçamento de reentrega
}

# Buffer do batch INSERT (o `filaAlertaQueueUrl` do código). ESTA FILA NÃO EXISTIA NA IaC:
# `ConsumidorAlertaBatch` drena uma fila que nenhum stack provisionava — o fan-out de RAD-179
# não tinha como rodar em AWS nenhuma. Consumidor leve (drena <= 10, um INSERT multi-row).
module "queue_alertas_gravar" {
  source             = "../../modules/queue"
  project            = "radar"
  env                = "prod"
  queue_name         = "alertas-a-gravar"
  encryption_key_ref = var.kms_key_arn

  visibility_timeout = 60
  max_receive_count  = 5
}

# Consumidor: notificação (entrega do alerta). Leve.
module "queue_alertas" {
  source             = "../../modules/queue"
  project            = "radar"
  env                = "prod"
  queue_name         = "alertas-gerados"
  encryption_key_ref = var.kms_key_arn

  visibility_timeout = 60
  max_receive_count  = 5
}

module "secrets" {
  source             = "../../modules/secrets"
  project            = "radar"
  env                = "prod"
  encryption_key_ref = var.kms_key_arn
}

# RDS Proxy em modo transação + bulkheads por workload (P-41/RAD-165).
# Prod usa a decomposição de 5 pools (default do módulo) — isolamento máximo.
module "db_proxy" {
  source                    = "../../modules/db_proxy"
  project                   = "radar"
  env                       = "prod"
  region                    = var.aws_region
  network_id                = module.vpc.network_id
  network_cidr              = module.vpc.network_cidr
  private_subnet_ids        = module.vpc.private_subnet_ids
  cluster_ref               = module.database.cluster_ref
  db_firewall_group_ref     = module.database.firewall_group_ref
  db_max_connections        = module.database.max_connections
  db_credentials_secret_ref = module.secrets.db_credentials_secret_ref
  encryption_key_ref        = var.kms_key_arn
  alarm_topic_ref           = var.ops_alarm_sns_topic_arn
  debug_logging             = false
}

# Seam serverless de P-27 — provisionado e validado, gated off (workers em Fargate no
# MVP-Now, P-96). reserved_concurrency = teto de conexões ao banco (P-41).
module "serverless" {
  source                   = "../../modules/serverless"
  count                    = var.enable_serverless_workers ? 1 : 0
  project                  = "radar"
  env                      = "prod"
  region                   = var.aws_region
  network_id               = module.vpc.network_id
  private_subnet_ids       = module.vpc.private_subnet_ids
  proxy_firewall_group_ref = module.db_proxy.firewall_group_ref
  encryption_key_ref       = var.kms_key_arn
  secret_refs              = [module.secrets.database_url_secret_ref, module.secrets.field_crypto_key_secret_ref]
  database_url_secret_ref  = module.secrets.database_url_secret_ref
  enabled                  = false

  functions = {
    ingestao = {
      handler              = "dist/workers/ingestao.handler"
      reserved_concurrency = 12
      pool                 = "ingestao"
      proxy_endpoint       = module.db_proxy.proxy_endpoints["ingestao"]
      queue_arn            = null
    }
    matching = {
      handler              = "dist/workers/matching.handler"
      reserved_concurrency = 8
      pool                 = "matching"
      proxy_endpoint       = module.db_proxy.proxy_endpoints["matching"]
      queue_arn            = module.queue_ingestao.queue_ref
    }
    notificacao = {
      handler              = "dist/workers/notificacao.handler"
      reserved_concurrency = 4
      pool                 = "triagem"
      proxy_endpoint       = module.db_proxy.proxy_endpoints["triagem"]
      queue_arn            = module.queue_alertas.queue_ref
    }
  }
}

module "identity" {
  source                  = "../../modules/identity"
  project                 = "radar"
  env                     = "prod"
  hosted_ui_domain_prefix = var.cognito_domain_prefix
  callback_urls           = var.cognito_callback_urls
  logout_urls             = var.cognito_logout_urls
  advanced_security_mode  = var.cognito_advanced_security_mode
}
