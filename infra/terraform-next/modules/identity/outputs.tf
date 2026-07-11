# Saídas que o BFF e o front consomem diretamente.
# REGRA: NÃO renomear estes outputs sem avisar Flávia (Front) — são contratos back↔front.
# `issuer_url`, `jwks_uri`, `tenant_claim` são OIDC-padrão (portáveis).
# `user_pool_id`, `app_client_id`, `hosted_ui_url` são Cognito-bound (documentados no README).

output "user_pool_id" {
  description = "ID do User Pool — env COGNITO_USER_POOL_ID do BFF (middleware/tenant.ts). Cognito-bound."
  value       = aws_cognito_user_pool.this.id
}

output "user_pool_arn" {
  description = "ARN do User Pool. Cognito-bound."
  value       = aws_cognito_user_pool.this.arn
}

output "app_client_id" {
  description = "ID do app client SPA — VITE_COGNITO_CLIENT_ID / audiência do token. Cognito-bound."
  value       = aws_cognito_user_pool_client.spa.id
}

output "issuer_url" {
  description = "Issuer OIDC — portável (qualquer IdP OIDC tem issuer). Validado pelo BFF (jose)."
  value       = "https://cognito-idp.${data.aws_region.current.name}.amazonaws.com/${aws_cognito_user_pool.this.id}"
}

output "jwks_uri" {
  description = "Endpoint JWKS — portável (OIDC Discovery §3). Usado pelo BFF para validar assinatura JWT."
  value       = "https://cognito-idp.${data.aws_region.current.name}.amazonaws.com/${aws_cognito_user_pool.this.id}/.well-known/jwks.json"
}

output "hosted_ui_url" {
  description = "Base da Hosted/Managed Login — VITE_COGNITO_AUTHORITY do SPA. Cognito-bound."
  value       = "https://${aws_cognito_user_pool_domain.this.domain}.auth.${data.aws_region.current.name}.amazoncognito.com"
}

output "tenant_claim" {
  description = "Nome do claim de tenant no JWT — portável (qualquer IdP com claims customizados). COGNITO_TENANT_CLAIM do BFF."
  value       = "custom:tenantId"
}
