# Contrato do módulo `vpc` — provider-agnóstico (A08 §4/§6, RAD-181).
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

variable "network_cidr" {
  description = "CIDR do bloco de endereços da rede privada (ex.: 10.0.0.0/16). AWS: VPC CIDR"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "Zonas de disponibilidade a provisionar (ex.: [sa-east-1a, sa-east-1b])"
  type        = list(string)
}

variable "region" {
  description = "Região do provedor — usada no nome do serviço do endpoint de object storage. AWS: região AWS"
  type        = string
}

# --- Saída da sub-rede privada (RAD-199) ----------------------------------------------
#
# Até RAD-199 as sub-redes privadas não tinham route table associada: caíam na main route
# table (local-only) e portanto NÃO TINHAM SAÍDA. Task de Fargate nessa rede não puxa imagem
# do ECR, não lê segredo no Secrets Manager e não fala com o PNCP — e o `apply` sai 0 mesmo
# assim (o serviço só fica com 0 task sã). O RDS Proxy (P-41) tem o mesmo problema: busca a
# credencial no Secrets Manager.
#
# NAT é OBRIGATÓRIO, não uma das duas opções: o tier sempre-ligado é quem faz o polling do
# PNCP (`pncp.gov.br`) e a chamada ao LLM (A08 §7) — destinos PÚBLICOS, sem PrivateLink. VPC
# endpoint só cobre serviço AWS; sozinho, deixaria a ingestão sem fonte. Endpoints de interface
# (ecr.api/ecr.dkr/secretsmanager/logs/sqs/kms) seguem possíveis COMO OTIMIZAÇÃO em cima do NAT
# (~US$ 7/mês cada por AZ, tiram tráfego AWS do NAT) — não fecham a saída pública e por isso
# não substituem a allowlist de egress (P-58, hoje garantida no código pelo `SsrfGuard`).
#
# O endpoint de object storage (Gateway) é a exceção que vale sempre: é GRÁTIS e as camadas de
# imagem do ECR vivem lá — sem ele todo `docker pull` de task fria passa pelo NAT a US$ 0,045/GB.
variable "egress_gateway_count" {
  description = "Gateways de saída da sub-rede privada. 0 = sem saída (task não sobe). 1 = um só (dev/staging: mais barato, ponto único de falha). >= nº de AZs = um por AZ (prod: falha de AZ não derruba a saída das outras). AWS: NAT Gateway + EIP."
  type        = number
  default     = 1
  validation {
    condition     = var.egress_gateway_count >= 0
    error_message = "egress_gateway_count >= 0."
  }
}
