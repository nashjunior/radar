variable "project" { type = string }
variable "env" { type = string }
variable "kms_key_arn" {
  description = "ARN KMS para criptografia (LGPD 13.709/2018)"
  type        = string
}
