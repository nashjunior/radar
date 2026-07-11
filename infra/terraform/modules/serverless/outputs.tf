output "function_arns" {
  description = "Mapa função→ARN da Lambda worker"
  value       = { for k, f in aws_lambda_function.worker : k => f.arn }
}

output "function_names" {
  description = "Mapa função→nome da Lambda worker"
  value       = { for k, f in aws_lambda_function.worker : k => f.function_name }
}

output "worker_role_arn" {
  description = "ARN da role de execução dos workers"
  value       = aws_iam_role.worker.arn
}

output "security_group_id" {
  description = "SG dos workers (egress 5432 → proxy)"
  value       = aws_security_group.worker.id
}

output "total_reserved_concurrency" {
  description = "Soma dos tetos de concorrência (gate P-41: < max_connections com folga)"
  value       = sum([for _, f in var.functions : f.reserved_concurrency])
}
