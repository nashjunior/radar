# Contrato do módulo `edge` — provider-agnóstico (A08 §4/§6, RAD-181).
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

variable "network_id" {
  description = "Rede onde a borda vive. AWS: VPC id"
  type        = string
}

variable "network_cidr" {
  description = "CIDR da rede — teto do egress da borda (ela só alcança a porta do container, dentro da rede)"
  type        = string
}

variable "public_subnet_ids" {
  description = "Sub-redes públicas da borda (é o ÚNICO recurso com face pública; o compute segue privado). AWS: subnet ids"
  type        = list(string)
}

variable "target_port" {
  description = "Porta HTTP do container servido pela borda"
  type        = number
  default     = 3000
}

variable "health_check_path" {
  description = "Rota de saúde do container (apps/api: `/health`, sem auth nem tenant)"
  type        = string
  default     = "/health"
}

variable "certificate_ref" {
  description = "Handle do certificado TLS da borda. Nulo = sem HTTPS (só dev; prod tem precondition). AWS: ACM certificate ARN"
  type        = string
  default     = null
}

variable "tls_policy" {
  description = "Política de cifras da terminação TLS. Provider-bound: nome de policy do ALB."
  type        = string
  default     = "ELBSecurityPolicy-TLS13-1-2-2021-06"
}

variable "web_acl_ref" {
  description = "Handle da ACL do firewall L7 (módulo `waf`, P-55). Nulo = borda sem WAF. AWS: WAFv2 Web ACL ARN"
  type        = string
  default     = null
}

variable "allowed_ingress_cidrs" {
  description = "De onde a borda aceita conexão. `0.0.0.0/0` = internet (é uma API pública); em dev dá pra apertar no IP do time."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "idle_timeout_seconds" {
  description = "Tempo que a borda segura conexão ociosa. Teto de qualquer requisição longa (relatório/export)."
  type        = number
  default     = 60
}
