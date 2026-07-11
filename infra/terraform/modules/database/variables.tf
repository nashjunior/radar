# Contrato do módulo `database` — provider-agnóstico (A08 §4/§6, RAD-181).
# Ver README.md para o que aqui é irredutivelmente provider-bound.

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

variable "network_id" {
  description = "ID da rede privada onde o banco roda. AWS: VPC id"
  type        = string
}

variable "network_cidr" {
  description = "CIDR da rede privada — teto do egress do banco (não alcança nada fora da VPC). AWS: VPC cidr"
  type        = string
}

variable "private_subnet_ids" {
  description = "Sub-redes privadas do banco (sem IP público). AWS: subnet ids"
  type        = list(string)
}

variable "db_name" {
  description = "Nome do banco de dados inicial"
  type        = string
  default     = "radar"
}

variable "db_username" {
  description = "Usuário master do banco (não use root)"
  type        = string
  sensitive   = true
}

variable "db_password" {
  description = "Senha master — vem de secret gerenciado em prod (nunca hardcoded, docs/05 §4)"
  type        = string
  sensitive   = true
}

variable "encryption_key_ref" {
  description = "Handle da chave de cifra em repouso (LGPD 13.709/2018). AWS: KMS key ARN"
  type        = string
}

# PISO de capacidade (P-67 no MVP-Now). P-67 nasceu como "cold start de função vs frescor"
# (arq/09 EL1) — mas o seam serverless está gated off (P-96: workers coabitam o Fargate),
# então NÃO existe cold start de Lambda hoje. A tensão de P-67 reaparece em dois lugares, e
# este é um deles: com piso de 0,5 ACU (1 GB) o buffer cache não segura o working set do
# fan-out (1–5 mil critérios, arq/05); sob rajada de ingestão o Aurora sobe ACU, mas parte
# de cache frio — seq scan lento — e o statement_timeout de 10 s do pool `matching` (P-41)
# começa a matar query, o que vira retry, que vira reentrega, que fura o frescor p95 <= 30 min.
# Piso de PARTIDA em prod = 2 ACU (4 GB); número a confirmar por medição no unblock (A09
# EL1/EL3, RAD-162). O outro lugar onde P-67 reaparece é o min capacity do autoscaling do
# ECS (módulo compute). Custo: o piso é cobrado 24/7 e multiplica por `instance_count`.
variable "min_capacity_acu" {
  description = "Piso de ACU do Aurora Serverless v2 (P-67). Cobrado 24/7 x instance_count. 0 = auto-pause/scale-to-zero quando ocioso (PG 16.6+): compute cai a ~$0 (só storage), resume em ~15s no 1º acesso. Usar 0 só em dev; prod mantém piso p/ latência."
  type        = number
  default     = 0.5
  # A granularidade de 0.5 é checada DE VERDADE (o Aurora rejeita 1.3 com InvalidParameterValue).
  # 0 é permitido (auto-pause) e 0 % 0.5 == 0.
  validation {
    condition     = var.min_capacity_acu >= 0 && var.min_capacity_acu <= 256 && var.min_capacity_acu % 0.5 == 0
    error_message = "min_capacity_acu: 0..256, em incrementos de 0.5 (0 = auto-pause, exige PG 16.6+)."
  }
}

variable "max_capacity_acu" {
  description = "Teto de ACU do Aurora Serverless v2"
  type        = number
  default     = 4
  validation {
    condition     = var.max_capacity_acu >= 1 && var.max_capacity_acu <= 256 && var.max_capacity_acu % 0.5 == 0
    error_message = "max_capacity_acu: 1..256, em incrementos de 0.5."
  }
  # NOTA (medido, não suposto): tentei subir a guarda cruzada `max >= min` pra cá como
  # `validation` cross-var (TF 1.9+/tofu aceitam a sintaxe). Empiricamente ela NÃO dispara no
  # `validate` — é diferida pro plan. Um bloco que promete uma checagem que não faz é pior que
  # bloco nenhum, então a guarda vive na `precondition` de `aws_rds_cluster.this` (main.tf),
  # que dispara no `plan`, antes de a AWS ver qualquer coisa.
}

# HA de prod (reconciliação do comentário "Multi-AZ prod" que este módulo carregava sem
# nunca ter entregado: havia UMA instância só). Em Aurora, "Multi-AZ" NÃO é uma flag — é
# ter >= 2 instâncias, que o Aurora distribui por AZs distintas do subnet group. Com 1
# instância, um failover obriga a AWS a RECONSTRUIR o writer (minutos, sem SLA de tempo);
# com um reader em outra AZ, a promoção é de ~30–60 s. A04 §6 é explícito: "Ingestão +
# matching + alerta NUNCA sacrificar" — daí o reader. O motivo é FAILOVER, não read-scaling
# (nada no MVP lê da réplica; o pool analítico só vai pra réplica quando P-42 for decidido).
variable "instance_count" {
  description = "Instâncias do cluster. 1 = sem HA (failover reconstrói); 2 = writer + reader em outra AZ."
  type        = number
  default     = 1
  validation {
    condition     = var.instance_count >= 1 && var.instance_count <= 3
    error_message = "instance_count: 1..3 (MVP não precisa de mais)."
  }
}

variable "max_connections" {
  description = "max_connections do Postgres (P-41: teto modesto; pools do proxy somam < isto)"
  type        = number
  default     = 200
  validation {
    condition     = var.max_connections >= 100 && var.max_connections <= 5000
    error_message = "max_connections deve estar entre 100 e 5000 (P-41 parte de 200)."
  }
}

variable "statement_timeout_ms" {
  description = "statement_timeout GLOBAL (ms) — backstop; pisos por pool via ALTER ROLE (P-41)"
  type        = number
  default     = 300000
}

variable "lock_timeout_ms" {
  description = "lock_timeout GLOBAL (ms) — 0=espera indefinida; 3 s só nos pools quentes por role (P-41)"
  type        = number
  default     = 0
}
