# Contrato do módulo `observability` — provider-agnóstico (A08 §4/§6).
# Ver README.md para o que aqui é irredutivelmente provider-bound.
# Consome o namespace/dimensão publicados pelo assinante evento→EMF (arquitetura/18 §5,
# RAD-302) — este módulo não emite métrica, só a interpreta.

variable "project" {
  description = "Nome do projeto (prefixo de recursos)"
  type        = string
}

variable "env" {
  description = "Ambiente: dev | staging | prod — também o valor da dimensão `ambiente` (arquitetura/18 §5)"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.env)
    error_message = "env deve ser dev, staging ou prod."
  }
}

variable "region" {
  description = "Região do provedor — exigida pelos widgets do dashboard. AWS: região AWS"
  type        = string
}

variable "alarm_topic_ref" {
  description = "Handle do tópico de alarme (vazio = alarme sem ação, só métrica/dashboard). AWS: SNS topic ARN"
  type        = string
  default     = ""
}

# --- Limiares duros (docs/08 §4.1) — os únicos que este momento provisiona -------------
# Limiares de WARNING (antes do estouro do budget mensal) ficam [A VALIDAR] em P-111:
# dependem de baseline com tráfego real (arquitetura/18 §8). Não inventar aqui.

variable "frescor_alerta_ms_threshold" {
  description = "SLO 'Frescor do alerta padrão': p95 publicação PNCP → alerta.gerado, em ms. docs/08 §4.1 = 30 min."
  type        = number
  default     = 1800000
}

variable "entrega_imediata_ms_threshold" {
  description = "SLO 'Entrega imediata': p95 alerta.gerado → notificacao.enviada (dim imediato=true), em ms. docs/08 §4.1 = 5 min."
  type        = number
  default     = 300000
}

variable "triagem_ms_threshold" {
  description = "SLO 'Triagem solicitada': p95 triagem.solicitada → triagem.concluida, em ms. docs/08 §4.1 = 3 min."
  type        = number
  default     = 180000
}

variable "disponibilidade_percentual_minimo" {
  description = "SLO 'Caminho crítico ingestão → alerta': disponibilidade mensal mínima. docs/08 §4.1 = 99,5%."
  type        = number
  default     = 99.5
}

variable "prazo_critico_perdido_threshold" {
  description = "SLO 'Alerta de prazo crítico': error budget = 0 — qualquer perdido (>=1) estoura. docs/08 §4.1."
  type        = number
  default     = 1
}
