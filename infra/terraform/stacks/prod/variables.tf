variable "aws_region" {
  description = "Região AWS — residência de dados (P-28, LGPD 13.709/2018)"
  type        = string
  default     = "sa-east-1"
}

variable "db_username" {
  type      = string
  sensitive = true
}

variable "db_password" {
  type      = string
  sensitive = true
}

variable "kms_key_arn" {
  description = "ARN da chave KMS para criptografia (LGPD 13.709/2018)"
  type        = string
}
