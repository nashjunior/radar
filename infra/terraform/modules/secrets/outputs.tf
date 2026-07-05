output "database_url_secret_arn" {
  description = "ARN do segredo DATABASE_URL — usado pelo módulo compute"
  value       = aws_secretsmanager_secret.database_url.arn
}

output "pncp_api_key_secret_arn" {
  description = "ARN do segredo da chave PNCP"
  value       = aws_secretsmanager_secret.pncp_api_key.arn
}
