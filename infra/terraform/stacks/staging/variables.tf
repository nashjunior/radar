variable "aws_region" { type = string; default = "sa-east-1" }
variable "db_username" { type = string; sensitive = true }
variable "db_password" { type = string; sensitive = true }
variable "kms_key_arn" { type = string }
