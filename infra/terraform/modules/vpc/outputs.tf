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

# Gate de RAD-199: quem roda na sub-rede privada (compute, RDS Proxy) só funciona com saída.
# `false` => task não puxa imagem nem lê segredo, e o apply SAI 0 mesmo assim.
output "private_egress_enabled" {
  description = "Se a sub-rede privada tem rota de saída (portável)"
  value       = local.nat_count > 0
}

output "egress_gateway_ips" {
  description = "IPs públicos de saída — o que o PNCP/LLM vê como origem (fixo, allowlistável). AWS: EIPs do NAT"
  value       = aws_eip.nat[*].public_ip
}
