# Contrato do módulo `queue` — provider-agnóstico (A08 §4/§6, RAD-181).
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

variable "queue_name" {
  description = "Nome lógico da fila (ex.: editais-ingeridos)"
  type        = string
}

variable "encryption_key_ref" {
  description = "Handle da chave de cifra em repouso (LGPD 13.709/2018). AWS: KMS key ARN"
  type        = string
}

variable "visibility_timeout" {
  description = "Timeout de visibilidade (s) — deve exceder o p99 de processamento do consumidor"
  type        = number
  default     = 30
  validation {
    condition     = var.visibility_timeout >= 1 && var.visibility_timeout <= 43200
    error_message = "visibility_timeout: 1..43200 s (teto do SQS = 12 h)."
  }
}

variable "max_receive_count" {
  description = "Tentativas antes de mover a mensagem para a DLQ"
  type        = number
  default     = 5
  validation {
    condition     = var.max_receive_count >= 1 && var.max_receive_count <= 1000
    error_message = "max_receive_count: 1..1000."
  }
}

# Long polling: sem isto o SQS faz short polling (WaitTimeSeconds=0) — receive vazio
# retorna na hora, o poller queima chamada/CPU à toa e a mensagem pode demorar um ciclo
# extra pra aparecer. 20 s é o teto do SQS e o default certo p/ um poller long-running.
variable "receive_wait_time_seconds" {
  description = "Long polling (s) — 0 = short polling. 20 = teto do SQS."
  type        = number
  default     = 20
  validation {
    condition     = var.receive_wait_time_seconds >= 0 && var.receive_wait_time_seconds <= 20
    error_message = "receive_wait_time_seconds: 0..20 s (teto do SQS)."
  }
}

# Perder mensagem em `editais-ingeridos` = perder edital = furar a cobertura PNCP >= 99%
# (docs/08 §3). 1 dia não sobrevive a um incidente de fim de semana; 4 dias sim.
variable "message_retention_seconds" {
  description = "Retenção da fila principal (s). DLQ tem retenção própria de 14 dias."
  type        = number
  default     = 345600 # 4 dias
  validation {
    condition     = var.message_retention_seconds >= 60 && var.message_retention_seconds <= 1209600
    error_message = "message_retention_seconds: 60..1209600 s (teto do SQS = 14 dias)."
  }
}

# INVARIANTE DE FRESCOR (docs/08 §3, docs/12 §3, P-14: p95 publicação->alerta <= 30 min).
# O pior caso de reentrega de uma mensagem é `visibility_timeout * max_receive_count`:
# a mensagem fica invisível o timeout inteiro a cada tentativa antes de cair na DLQ.
# Se esse produto estourar o orçamento, um retry legítimo já nasce fora do SLO — e a IaC
# não pode deixar isso passar silenciosamente. Default = 900 s = metade do budget de 30 min,
# deixando a outra metade p/ ingestão (polling 5 min, P-29), fan-out e entrega.
variable "redelivery_budget_seconds" {
  description = "Teto de visibility_timeout * max_receive_count — deriva do frescor p95 <= 30 min (P-14)"
  type        = number
  default     = 900
  # O portão não pode ser anulável pelo próprio botão que o aplica: sem este teto, um stack
  # afrouxaria o orçamento até o infinito e a precondition nunca dispararia. 900 s = metade
  # do budget de frescor; afrouxar acima disso exige mudar o SLO (P-14), não um .tf.
  validation {
    condition     = var.redelivery_budget_seconds > 0 && var.redelivery_budget_seconds <= 900
    error_message = "redelivery_budget_seconds: 1..900 s. O teto vem do frescor p95 <= 30 min (P-14) — pra afrouxar, mude o SLO, não a fila."
  }
}
