# Contrato do módulo `compute` — provider-agnóstico (A08 §4/§6, RAD-181).
# Ver README.md para o que aqui é irredutivelmente provider-bound (ECS/task-def).

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
  description = "Região do provedor (usado em referências de log). AWS: região AWS"
  type        = string
}

variable "cpu" {
  description = "Unidades de CPU para o container (256 = 0.25 vCPU). Provider-bound: ECS CPU units."
  type        = number
  default     = 256
}

variable "memory" {
  description = "Memória do container em MiB. Provider-bound: ECS memory."
  type        = number
  default     = 512
}

variable "container_image_uri" {
  description = "URI da imagem OCI do container (ex.: 123456789.dkr.ecr.sa-east-1.amazonaws.com/radar:tag). AWS: ECR URI."
  type        = string
}

variable "image_tag" {
  description = "Tag da imagem OCI"
  type        = string
  default     = "latest"
}

variable "database_url_secret_ref" {
  description = "Handle do segredo DATABASE_URL (HOST = endpoint do proxy P-41). AWS: Secrets Manager ARN"
  type        = string
}

variable "field_crypto_key_secret_ref" {
  description = "Handle do segredo FIELD_CRYPTO_KEY (AES-256-GCM, P-59). AWS: Secrets Manager ARN"
  type        = string
}

# --- Rede do serviço (awsvpc) ---------------------------------------------------------

variable "network_id" {
  description = "Rede privada onde as tasks rodam. AWS: VPC id"
  type        = string
}

variable "private_subnet_ids" {
  description = "Sub-redes privadas das tasks (sem IP público, A08 §5). AWS: subnet ids"
  type        = list(string)
}

# SG→SG (não CIDR): a task fala 5432 SÓ com o pooler, nunca com "qualquer coisa na rede" —
# e o banco continua inalcançável direto (P-41). Espelha `serverless`, que já recebe o mesmo
# handle do stack. Composição no stack, não módulo importando módulo (A08 §1).
variable "pooler_firewall_group_ref" {
  description = "Handle do firewall do pooler — único destino 5432 da task (P-41). AWS: RDS Proxy security group id"
  type        = string
}

variable "encryption_key_ref" {
  description = "Handle da chave de cifra (LGPD 13.709/2018). Task precisa dela p/ ler fila CMK e segredo. AWS: KMS key ARN"
  type        = string
}

# ARNs das filas que o tier consome/produz (RAD-179). A policy da task role é ESCOPADA nelas
# — sem `Resource: "*"` em SQS.
variable "queue_refs" {
  description = "Handles das filas que a task consome/produz. AWS: SQS queue ARNs"
  type        = list(string)
  default     = []
}

# --- Autoscaling (A09 EL3: "lag de autoscale") ----------------------------------------
#
# O tier sempre-ligado (API/BFF + triagem-pool — MESMA task no MVP-Now, P-96/RAD-59) tinha
# cpu/memory FIXOS e nenhuma política de escala. Target tracking resolve por métrica, não
# por degrau agendado, que é o certo pra carga dirigida por publicação do PNCP (bursty e
# não-agendável). `min_capacity` é o outro lugar onde P-67 (cold start x frescor) reaparece
# no MVP-Now: task fria = degrau de scale-out (pull da imagem + boot do Node) na frente do
# alerta. Piso >= 2 em prod também é HA: 2 tasks em AZs distintas.

variable "min_capacity" {
  description = "Piso de tasks do serviço (P-67: absorve o degrau de scale-out; >=2 em prod = HA)"
  type        = number
  default     = 1
  validation {
    condition     = var.min_capacity >= 1
    error_message = "min_capacity >= 1 — o tier é SEMPRE-LIGADO (A08 §1); scale-to-zero aqui fura o frescor."
  }
}

variable "max_capacity" {
  description = "Teto de tasks do serviço — bulkhead de custo/conexão (o pool `triagem` do P-41 tem 10 backends)"
  type        = number
  default     = 2
}

# 60% deixa margem pro degrau: escalar só a 80% chega tarde num burst (a task nova leva
# ~1–2 min pra ficar sã), e é exatamente o EL3 ("o pico chega antes de o pool subir").
variable "cpu_target_percent" {
  description = "Alvo de utilização de CPU do target tracking (%)"
  type        = number
  default     = 60
}

variable "memory_target_percent" {
  description = "Alvo de utilização de memória do target tracking (%)"
  type        = number
  default     = 70
}

# Assimétrico de propósito: sobe rápido (frescor é o SLO), desce devagar (evita flapping
# entre ciclos de polling de 5 min — P-29 — que reacenderiam o degrau que acabamos de pagar).
variable "scale_out_cooldown_seconds" {
  description = "Cooldown de scale-out (s) — agressivo: o frescor p95 <= 30 min é o SLO"
  type        = number
  default     = 60
}

variable "scale_in_cooldown_seconds" {
  description = "Cooldown de scale-in (s) — conservador: evita flapping no ciclo de polling (P-29)"
  type        = number
  default     = 300
}

# SEAM da terceira métrica (requisições). ALBRequestCountPerTarget exige um target group de
# ALB, e o Radar AINDA NÃO TEM BORDA: não há ALB/API Gateway em lugar nenhum da IaC e a
# decisão ALB-vs-API-GW é P-55 (aberta; A08 §5 desenha "API Gateway / WAF"). Não inventamos
# essa decisão aqui. Quando a borda existir, o stack passa o resource label e a política de
# requisições entra sem tocar em CPU/memória. Nulo => a política não é criada.
variable "request_scaling_target_ref" {
  description = "Handle do alvo de escala por requisição. Provider-bound: AWS exige o resource label app/<lb>/<id>/targetgroup/<tg>/<id>. Nulo = sem política de requisições (borda indefinida, P-55)."
  type        = string
  default     = null
}

variable "requests_per_target_target" {
  description = "Alvo de requisições por task quando a borda existir (P-55)"
  type        = number
  default     = 500
}

variable "target_group_ref" {
  description = "Handle do target group que recebe as tasks. Nulo = serviço sem balanceador (sem borda ainda, P-55). AWS: ALB target group ARN"
  type        = string
  default     = null
}
