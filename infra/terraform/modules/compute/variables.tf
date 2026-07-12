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

variable "container_port" {
  description = "Porta HTTP do container (apps/api lê `PORT`). Mesma que a borda usa como alvo."
  type        = number
  default     = 3000
}

variable "database_url_secret_ref" {
  description = "Handle do segredo DATABASE_URL (HOST = endpoint do proxy P-41). AWS: Secrets Manager ARN"
  type        = string
}

variable "field_crypto_key_secret_ref" {
  description = "Handle do segredo FIELD_CRYPTO_KEY (AES-256-GCM, P-59). AWS: Secrets Manager ARN"
  type        = string
}

# Passagem CEGA: o módulo não sabe o que são COGNITO_*/AUTH_MODE/API_CORS_ORIGINS — quem
# compõe é o stack. Sem isto, a task subiria e ABORTARIA no boot: `resolverConfigAuth` é
# fail-closed (P-91) e exige config de Cognito em NODE_ENV=production.
variable "environment" {
  description = "Variáveis de ambiente NÃO-SECRETAS do container (o stack compõe; o módulo não interpreta)"
  type        = map(string)
  default     = {}
}

# Idem para segredo: nome da env => handle do cofre. Injetado por `valueFrom` (o valor NUNCA
# entra na task def, que é legível por quem tem `ecs:DescribeTaskDefinition`) e a policy da
# execution role é escopada nestes ARNs.
variable "extra_secret_refs" {
  description = "Segredos adicionais do container: nome da env => handle do cofre (ex.: ANTHROPIC_API_KEY). AWS: Secrets Manager ARNs"
  type        = map(string)
  default     = {}
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

# Bedrock batch inference (P-92/RAD-231/RAD-236) — o worker submete/monitora o job e faz
# `iam:PassRole` SÓ para esta role (nunca `Resource: "*"`, que abriria escalonamento de
# privilégio via Bedrock). Par com `batch_bucket_ref` (módulo `storage`). Nulo = sem
# batch inference habilitado neste stack — nenhuma policy é criada (nada a permitir).
variable "bedrock_batch_service_role_ref" {
  description = "Handle da role de serviço do Bedrock batch (módulo storage). Nulo = batch inference desabilitado. AWS: IAM role ARN"
  type        = string
  default     = null
}

variable "batch_bucket_ref" {
  description = "Handle do bucket de I/O do batch inference (módulo storage). Nulo = batch inference desabilitado. AWS: S3 bucket ARN"
  type        = string
  default     = null
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

# Terceira métrica (requisições). O seam nasceu NULO em RAD-192 porque não havia borda e
# P-55 (ALB vs. API Gateway) estava aberta. **Fechada em RAD-199: ALB** — o handle agora vem
# do módulo `edge` (o resource label composto que o CloudWatch exige). Nulo segue válido:
# serviço sem borda processa fila e não serve HTTP.
variable "request_scaling_target_ref" {
  description = "Handle do alvo de escala por requisição (módulo `edge`). Provider-bound: AWS exige o resource label app/<lb>/<id>/targetgroup/<tg>/<id>. Nulo = sem política de requisições."
  type        = string
  default     = null
}

variable "requests_per_target_target" {
  description = "Alvo de requisições por task quando a borda existir (P-55)"
  type        = number
  default     = 500
}

variable "target_group_ref" {
  description = "Handle do target group que recebe as tasks (módulo `edge`). Nulo = serviço sem balanceador — processa fila, não serve HTTP. AWS: ALB target group ARN"
  type        = string
  default     = null
}

# Par apertado do egress escopado da borda: SG→SG. Só a borda alcança a porta do container —
# nem "qualquer coisa na rede", nem a internet. Nulo = task sem ingresso nenhum (só sai).
variable "edge_firewall_group_ref" {
  description = "Handle do firewall da borda — única origem de ingresso na porta do container. AWS: Security Group id"
  type        = string
  default     = null
}

# A falha silenciosa que este módulo mais convida: `apply` verde com 0 task sã. Com isto o
# Terraform ESPERA o serviço estabilizar e FALHA ALTO se a task não subir (imagem ausente no
# registro, segredo sem versão, pull negado). Custo: o apply demora o tempo do deploy.
variable "wait_for_steady_state" {
  description = "Falhar o apply se o serviço não estabilizar (em vez de sair 0 com 0 task sã)"
  type        = bool
  default     = true
}

# Fargate default = X86_64. O time constrói em darwin/arm64: imagem arm64 + task X86_64 =
# `image Manifest does not contain descriptor matching platform` — e, de novo, apply 0.
# O CI (Linux x86) publica X86_64; quem construir local usa `--platform linux/amd64`.
variable "cpu_architecture" {
  description = "Arquitetura da imagem do container: X86_64 | ARM64. Precisa casar com o que o CI publica."
  type        = string
  default     = "X86_64"
  validation {
    condition     = contains(["X86_64", "ARM64"], var.cpu_architecture)
    error_message = "cpu_architecture deve ser X86_64 ou ARM64."
  }
}
