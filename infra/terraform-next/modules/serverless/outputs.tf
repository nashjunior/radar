# Saídas neutras. `_ref` = handle opaco do provedor; sem sufixo = valor portável.

output "function_refs" {
  description = "Mapa função→handle da função serverless. AWS: Lambda ARN"
  value       = { for k, f in aws_lambda_function.worker : k => f.arn }
}

output "function_names" {
  description = "Mapa função→nome da função serverless (portável — usado em logging/CI)"
  value       = { for k, f in aws_lambda_function.worker : k => f.function_name }
}

output "worker_role_ref" {
  description = "Handle da role de execução dos workers. AWS: IAM role ARN"
  value       = aws_iam_role.worker.arn
}

output "firewall_group_ref" {
  description = "Grupo de firewall dos workers (egress 5432 → proxy). AWS: Security Group id"
  value       = aws_security_group.worker.id
}

output "total_reserved_concurrency" {
  description = "Soma dos tetos de concorrência (gate P-41: < max_connections com folga)"
  value       = sum([for _, f in var.functions : f.reserved_concurrency])
}
