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

variable "kms_key_arn" {
  description = "ARN da chave KMS para criptografia dos segredos (LGPD 13.709/2018)"
  type        = string
}
