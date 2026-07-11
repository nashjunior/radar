# Módulo `identity` — provedor de identidade OIDC (RAD-181/RAD-182)

Provedor de identidade com Authorization Code + PKCE via Hosted/Managed Login.
Binding hoje = Amazon Cognito. Outputs que o BFF/front consomem não podem ser renomeados
sem avisar Flávia (Front) — são contratos back↔front.

## O que é genuinamente portável (OIDC-padrão)

| Conceito | Contrato | Binding AWS |
|---|---|---|
| Issuer OIDC | `issuer_url` | URL derivada do pool id |
| JWKS endpoint | `jwks_uri` | URL derivada do pool id |
| Claim de tenant | `tenant_claim` (`"custom:tenantId"`) | Atributo custom do Cognito |
| Callback URLs | `callback_urls` | `callback_urls` no app client |
| Logout URLs | `logout_urls` | `logout_urls` no app client |
| TTLs de token | `*_validity_*` | `*_token_validity` no app client |

## O que é Cognito-bound (custo real de exit → Auth0/Okta/Keycloak)

- **`advanced_security_mode`** (`ENFORCED`/`AUDIT`/`OFF`) — Cognito Advanced Security /
  Adaptive Authentication. Em Auth0 = Attack Protection; em Okta = ThreatInsight; em
  Keycloak = Brute Force Detection. Conceito portável, configuração totalmente diferente.
  Custo extra por MAU no Cognito (ver config-spec).
- **`hosted_ui_domain_prefix`** — subdomínio da Managed Login do Cognito
  (`<prefix>.auth.<region>.amazoncognito.com`). Em Auth0 = tenant slug
  (`<tenant>.auth0.com`); em Okta = org domain; em Keycloak = realm URL.
- **`custom:tenantId`** — atributo custom do Cognito (prefixo `custom:`). Em Auth0 =
  `app_metadata.tenantId`; em Okta = profile attribute; em Keycloak = user attribute.
  O claim no JWT tem o mesmo nome em qualquer IdP, mas o *atributo de usuário* que o
  alimenta tem APIs de provisionamento diferentes.
- **`user_pool_id` / `app_client_id`** — identificadores Cognito; em outros provedores
  são `client_id`/`domain` ou `tenant_id`/`application_id`. O BFF os consome via env
  var (`COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`) — saídas não podem ser renomeadas.
- **`mfa_configuration = "ON"` com `software_token_mfa_configuration`** — TOTP via
  Cognito. Em Auth0/Okta o MFA TOTP é configurado separadamente (Actions/Policies).
- **`refresh_token_rotation`** — disponível desde AWS provider v5.98; em outros provedores
  a rotação é configurada na política do cliente OIDC.
- **`allow_admin_create_user_only = true`** — convite-only (P-98); equivale a
  desabilitar self-registration na configuração do provedor.
