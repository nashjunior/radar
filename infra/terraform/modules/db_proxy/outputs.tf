# Saídas neutras. `_ref` = handle opaco do provedor; sem sufixo = valor portável.

output "proxy_endpoints" {
  description = "Mapa pool→endpoint do pool gerenciado. A app/worker aponta o DATABASE_URL AQUI, nunca no cluster."
  value       = { for k, p in aws_db_proxy.this : k => p.endpoint }
}

output "proxy_refs" {
  description = "Mapa pool→handle do proxy. AWS: RDS Proxy ARN"
  value       = { for k, p in aws_db_proxy.this : k => p.arn }
}

output "firewall_group_ref" {
  description = "Grupo de firewall do proxy — clientes (Lambda/Fargate) egress 5432 p/ cá. AWS: Security Group id"
  value       = aws_security_group.proxy.id
}

output "backends_reservados" {
  description = "Soma estimada de backends PG reservados pelos pools (gate P-41: < max_connections)"
  value       = local.backends_reservados
}
