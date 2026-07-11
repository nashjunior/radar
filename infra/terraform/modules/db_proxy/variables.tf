# Contrato do módulo `db_proxy` — pool de conexão gerenciado (A08 §4 "Pool de conexão").
# Binding hoje = RDS Proxy modo transação. O muito que aqui é provider-bound (semântica de
# pool por percentual, anti-pin, wiring SG→SG) está documentado no README.md — é o custo de
# um exit, não escondido atrás de nome neutro.

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

variable "region" {
  description = "Região do provedor (usada na condição de escopo do decrypt do secret). AWS: kms:ViaService"
  type        = string
}

variable "network_id" {
  description = "ID da rede privada onde o proxy roda. AWS: VPC id"
  type        = string
}

variable "network_cidr" {
  description = "CIDR da rede privada para o ingress do proxy. AWS: VPC cidr"
  type        = string
}

variable "private_subnet_ids" {
  description = "Sub-redes privadas do proxy. AWS: subnet ids"
  type        = list(string)
}

variable "cluster_ref" {
  description = "Handle do cluster de banco que o proxy fronteia. AWS: Aurora cluster_identifier"
  type        = string
}

variable "db_firewall_group_ref" {
  description = "Grupo de firewall do banco — o proxy adiciona ingress 5432 dele p/ o cluster (proxy-only, P-41). AWS: Security Group id"
  type        = string
}

variable "db_credentials_secret_ref" {
  description = "Handle do secret {username,password} para auth proxy→banco. AWS: Secrets Manager ARN"
  type        = string
}

variable "encryption_key_ref" {
  description = "Handle da chave que cifra o secret de credenciais (para decrypt). AWS: KMS key ARN"
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
  description = "Mapa pool→config de bulkhead. Um pool gerenciado por entrada (AWS: um RDS Proxy)."
  type = map(object({
    max_connections_percent      = number
    max_idle_connections_percent = optional(number) # null → default = max_connections_percent
    connection_borrow_timeout    = optional(number, 120)
    idle_client_timeout          = optional(number, 1800)
    secret_ref                   = optional(string) # null → usa o secret master compartilhado
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
  # max_idle_connections_percent <= max_connections_percent (restrição do RDS Proxy).
  validation {
    condition = alltrue([
      for _, p in var.pools :
      p.max_idle_connections_percent == null || try(p.max_idle_connections_percent <= p.max_connections_percent, false)
    ])
    error_message = "max_idle_connections_percent de um pool não pode exceder seu max_connections_percent."
  }
}

variable "session_pinned_threshold" {
  description = "Limiar do alarme de conexões fixadas (pin). >0 sustentado é bug a caçar. Provider-bound (métrica CloudWatch)"
  type        = number
  default     = 0
}

variable "alarm_topic_ref" {
  description = "Handle do tópico de alarme (vazio = alarme sem ação, só métrica). AWS: SNS topic ARN"
  type        = string
  default     = ""
}

variable "debug_logging" {
  description = "debug_logging do proxy (só fora de prod — loga SQL)"
  type        = bool
  default     = false
}
