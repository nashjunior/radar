# Saídas neutras. `_ref` = handle opaco do provedor; sem sufixo = valor portável.

output "network_id" {
  description = "ID da rede privada. AWS: VPC id"
  value       = aws_vpc.this.id
}

output "network_cidr" {
  description = "CIDR da rede privada (portável)"
  value       = aws_vpc.this.cidr_block
}

output "public_subnet_ids" {
  description = "Sub-redes públicas (gateway/WAF). AWS: subnet ids"
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "Sub-redes privadas (compute/DB). AWS: subnet ids"
  value       = aws_subnet.private[*].id
}
