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
  description = "Secret do FIELD_CRYPTO_KEY isolado do ambiente dev"
  value       = module.secrets.field_crypto_key_secret_arn
}
