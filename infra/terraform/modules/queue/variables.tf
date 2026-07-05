variable "project" { type = string }
variable "env" { type = string }
variable "queue_name" { type = string }
variable "kms_key_arn" { type = string }
variable "visibility_timeout" { type = number; default = 30 }
variable "max_receive_count" { type = number; default = 5 }
