variable "project" { type = string }
variable "env" { type = string }
variable "aws_region" { type = string }
variable "cpu" {
  type    = number
  default = 256
}

variable "memory" {
  type    = number
  default = 512
}

variable "ecr_image_uri" { type = string }

variable "image_tag" {
  type    = string
  default = "latest"
}
variable "database_url_secret_arn" {
  description = "ARN do secret no Secrets Manager com DATABASE_URL"
  type        = string
}

variable "field_crypto_key_secret_arn" {
  description = "ARN do secret no Secrets Manager com FIELD_CRYPTO_KEY por ambiente"
  type        = string
}
