variable "project" {
  description = "Nome do projeto (prefixo de recursos)"
  type        = string
}

variable "env" {
  description = "Ambiente: dev | staging | prod"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.env)
    error_message = "env deve ser dev, staging ou prod."
  }
}

variable "aws_region" {
  description = "Região AWS (usada na condição kms:ViaService)"
  type        = string
}

variable "vpc_id" {
  description = "ID da VPC onde o proxy roda"
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR da VPC para o ingress do proxy"
  type        = string
}

variable "subnet_ids" {
  description = "Subnets privadas para o proxy"
  type        = list(string)
}

variable "db_cluster_id" {
  description = "Identifier do cluster Aurora que o proxy fronteia"
  type        = string
}

variable "db_security_group_id" {
  description = "SG do banco — o proxy adiciona ingress 5432 dele p/ o cluster (proxy-only, P-41)"
  type        = string
}

variable "db_credentials_secret_arn" {
  description = "ARN do secret {username,password} para auth proxy→banco"
  type        = string
}

variable "kms_key_arn" {
  description = "ARN da KMS que cifra o secret de credenciais (para kms:Decrypt)"
  type        = string
}

variable "db_max_connections" {
  description = "max_connections do Postgres — base do cálculo de backends por pool (P-41)"
  type        = number
  default     = 200
}

# Bulkheads por workload (P-41, arq/05 §6). Um proxy por chave; cada max_connections_percent
# é a fatia do max_connections=200. Default = a decomposição de 5 pools da decisão.
# Backends de partida: Ingestão 15 / Matching 10 / Triagem-API 10 / Analítico 5 / Jobs 5
# → percentuais 8/5/5/3/3 (≈ 48/200; folga enorme p/ admin). Stacks podem colapsar
# (ex.: dev/staging = ingestao + critical) por custo — o proxy é cobrado por proxy.
variable "pools" {
  description = "Mapa pool→config de bulkhead. Um RDS Proxy por entrada."
  type = map(object({
    max_connections_percent      = number
    max_idle_connections_percent = optional(number) # null → default = max_connections_percent
    connection_borrow_timeout    = optional(number, 120)
    idle_client_timeout          = optional(number, 1800)
    secret_arn                   = optional(string) # null → usa o secret master compartilhado
  }))
  default = {
    ingestao  = { max_connections_percent = 8 }
    matching  = { max_connections_percent = 5 }
    triagem   = { max_connections_percent = 5 }
    analitico = { max_connections_percent = 3 }
    jobs      = { max_connections_percent = 3 }
  }
  validation {
    condition = alltrue([
      for _, p in var.pools : p.max_connections_percent >= 1 && p.max_connections_percent <= 100
    ])
    error_message = "max_connections_percent de cada pool deve estar entre 1 e 100."
  }
  # Gate P-41: a soma dos pools fica < 100% com folga para admin/superuser.
  validation {
    condition     = sum([for _, p in var.pools : p.max_connections_percent]) <= 80
    error_message = "Soma dos max_connections_percent dos pools deve ser <= 80% (folga admin, P-41)."
  }
  # AWS: max_idle_connections_percent <= max_connections_percent.
  validation {
    condition = alltrue([
      for _, p in var.pools :
      p.max_idle_connections_percent == null || try(p.max_idle_connections_percent <= p.max_connections_percent, false)
    ])
    error_message = "max_idle_connections_percent de um pool não pode exceder seu max_connections_percent."
  }
}

variable "session_pinned_threshold" {
  description = "Limiar do alarme de conexões fixadas (pin). >0 sustentado é bug a caçar."
  type        = number
  default     = 0
}

variable "alarm_sns_topic_arn" {
  description = "SNS de destino dos alarmes (vazio = alarme sem ação, só métrica)"
  type        = string
  default     = ""
}

variable "debug_logging" {
  description = "debug_logging do proxy (só fora de prod — loga SQL)"
  type        = bool
  default     = false
}
