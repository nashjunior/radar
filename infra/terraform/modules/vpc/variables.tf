variable "project" {
  type = string
}

variable "env" {
  type = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.env)
    error_message = "env deve ser dev, staging ou prod."
  }
}

variable "vpc_cidr" {
  description = "CIDR da VPC (ex: 10.0.0.0/16)"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "AZs a provisionar (ex: [us-east-1a, us-east-1b])"
  type        = list(string)
}
