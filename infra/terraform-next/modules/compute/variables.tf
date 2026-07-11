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
