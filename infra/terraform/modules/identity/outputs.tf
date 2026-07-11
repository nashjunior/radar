output "user_pool_id" {
  description = "ID do User Pool — env COGNITO_USER_POOL_ID do BFF (middleware/tenant.ts)"
  value       = aws_cognito_user_pool.this.id
}

output "user_pool_arn" {
  description = "ARN do User Pool"
  value       = aws_cognito_user_pool.this.arn
}

output "app_client_id" {
  description = "ID do app client SPA — VITE_COGNITO_* no front / audiência do token"
  value       = aws_cognito_user_pool_client.spa.id
}

output "issuer_url" {
  description = "Issuer OIDC — bate com o issuer esperado pelo BFF (cognito-idp.<region>.amazonaws.com/<poolId>)"
  value       = "https://cognito-idp.${data.aws_region.current.name}.amazonaws.com/${aws_cognito_user_pool.this.id}"
}

output "jwks_uri" {
  description = "Endpoint JWKS que o BFF usa para validar assinatura do JWT (jose)"
  value       = "https://cognito-idp.${data.aws_region.current.name}.amazonaws.com/${aws_cognito_user_pool.this.id}/.well-known/jwks.json"
}

output "hosted_ui_url" {
  description = "Base da Hosted/Managed Login (authority OIDC do SPA / VITE_COGNITO_AUTHORITY)"
  value       = "https://${aws_cognito_user_pool_domain.this.domain}.auth.${data.aws_region.current.name}.amazoncognito.com"
}

output "tenant_claim" {
  description = "Nome do claim de tenant esperado pelo BFF (COGNITO_TENANT_CLAIM)"
  value       = "custom:tenantId"
}
