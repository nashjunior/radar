# Saídas neutras. `_ref` = handle opaco do provedor; sem sufixo = valor portável.

output "database_url_secret_ref" {
  description = "Handle do segredo DATABASE_URL (HOST = endpoint do proxy P-41). AWS: Secrets Manager ARN"
  value       = aws_secretsmanager_secret.database_url.arn
}

output "pncp_api_key_secret_ref" {
  description = "Handle do segredo da chave de acesso ao PNCP. AWS: Secrets Manager ARN"
  value       = aws_secretsmanager_secret.pncp_api_key.arn
}

output "db_credentials_secret_ref" {
  description = "Handle do segredo {username,password} para auth do pool gerenciado (P-41). AWS: Secrets Manager ARN"
  value       = aws_secretsmanager_secret.db_credentials.arn
}

output "llm_api_key_secret_ref" {
  description = "Handle do segredo ANTHROPIC_API_KEY do worker de triagem (P-66). AWS: Secrets Manager ARN"
  value       = aws_secretsmanager_secret.llm_api_key.arn
}

output "field_crypto_key_secret_ref" {
  description = "Handle do segredo FIELD_CRYPTO_KEY (AES-256-GCM, P-59). AWS: Secrets Manager ARN"
  value       = aws_secretsmanager_secret.field_crypto_key.arn
}
