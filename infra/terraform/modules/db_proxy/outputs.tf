output "proxy_endpoints" {
  description = "Mapa pool→endpoint do RDS Proxy. A app/worker aponta o DATABASE_URL AQUI, nunca no cluster."
  value       = { for k, p in aws_db_proxy.this : k => p.endpoint }
}

output "proxy_arns" {
  description = "Mapa pool→ARN do proxy"
  value       = { for k, p in aws_db_proxy.this : k => p.arn }
}

output "security_group_id" {
  description = "Security Group do proxy — clientes (Lambda/Fargate) egress 5432 p/ cá"
  value       = aws_security_group.proxy.id
}

output "backends_reservados" {
  description = "Soma estimada de backends PG reservados pelos pools (gate P-41: < max_connections)"
  value       = local.backends_reservados
}
