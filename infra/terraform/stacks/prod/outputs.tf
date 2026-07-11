# Outputs consumidos por CI/BFF/front — NOMES mantidos para não quebrar scripts.

output "cognito_user_pool_id" {
  description = "COGNITO_USER_POOL_ID do BFF"
  value       = module.identity.user_pool_id
}

output "cognito_app_client_id" {
  description = "COGNITO_CLIENT_ID do BFF e VITE_COGNITO_CLIENT_ID do front"
  value       = module.identity.app_client_id
}

output "cognito_issuer_url" {
  description = "Issuer OIDC do User Pool"
  value       = module.identity.issuer_url
}

output "cognito_jwks_uri" {
  description = "JWKS URI usado pela BFF para validar assinatura do JWT"
  value       = module.identity.jwks_uri
}

output "cognito_hosted_ui_url" {
  description = "VITE_COGNITO_AUTHORITY do front"
  value       = module.identity.hosted_ui_url
}

output "cognito_tenant_claim" {
  description = "COGNITO_TENANT_CLAIM esperado pela BFF"
  value       = module.identity.tenant_claim
}

output "field_crypto_key_secret_arn" {
  description = "Secret do FIELD_CRYPTO_KEY isolado do ambiente prod (nome mantido para paridade de CI)"
  value       = module.secrets.field_crypto_key_secret_ref
}

output "db_proxy_endpoints" {
  description = "Endpoints do RDS Proxy por pool — HOST do DATABASE_URL de cada workload (P-41)"
  value       = module.db_proxy.proxy_endpoints
}

output "db_pool_backends_reservados" {
  description = "Backends PG estimados reservados pelos pools do proxy (gate P-41: < max_connections)"
  value       = module.db_proxy.backends_reservados
}

output "serverless_worker_functions" {
  description = "Nomes das Lambdas worker (vazio enquanto o seam P-27 está gated off)"
  value       = try(module.serverless[0].function_names, {})
}
