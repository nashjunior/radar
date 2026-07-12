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
- **`permitir_auto_cadastro`** (bool, default `false`) — inverte
  `admin_create_user_config.allow_admin_create_user_only`. Liga/desliga self-registration
  no Hosted UI; ver nota abaixo para o estado por stack e o gate de prod.
- **`web_acl_ref` / `aws_wafv2_web_acl_association`** — associação de WAF ao user pool
  (RAD-273, P-109 L2) é recurso nativo do Cognito+WAFv2; Auth0/Okta têm proteção
  anti-bot própria (Attack Protection/ThreatInsight), não uma associação de firewall externo
  equivalente. Restrição documentada da própria AWS: não é possível associar um web ACL que
  use os managed rule groups `AWSManagedRulesATPRuleSet` (Account Takeover Prevention) ou
  `AWSManagedRulesACFPRuleSet` (Account Creation Fraud Prevention) a um user pool — por isso
  as regras de RAD-273 são `rate_based_statement` custom (módulo `waf`), não esses rule
  groups gerenciados.

### Auto-cadastro: parametrizado por stack (RAD-283/RAD-284)

Ruling do Artur (RAD-283, 2026-07-12): o trial **é** self-service (docs/09 §6.1, P-107,
P-109) — `allow_admin_create_user_only = true` fixo era resíduo do scaffolding do RAD-182
(c9466f8), nunca uma decisão. Mas o flip não podia ser só de infra: `custom:tenantId` é
imutável e fora de `write_attributes` (anti-escalonamento, AB1/P-51) — um `SignUp` público
cria a conta **sem** tenant e **sem conserto pós-criação** (atributo custom imutável só é
populado durante `SignUp`/`AdminCreateUser`/mapping de IdP federado, nunca depois — doc
oficial AWS, *user-pool-settings-attributes*, seção *Custom attributes*). O middleware
`apps/api/src/middleware/tenant.ts` exige a claim: sem ela, `403 TENANT_AUSENTE_NO_TOKEN`
em toda requisição.

Por isso o flag virou a variável `permitir_auto_cadastro` (default `false` = postura
segura), setada por stack:

- **dev / staging: `true`** — é onde o rate-limit/CAPTCHA do RAD-273 deixa de ser inerte.
- **prod: `true`** (RAD-288, 2026-07-12) — gate cumprido: `ProvisionarOrganizacaoUseCase` +
  borda resolvendo tenant/papel por `sub` verificado via `PermissaoRepository` (**RAD-285**,
  Bento), tela de onboarding pós-login (**RAD-286**, Flávia) e o bulkhead do coorte trial
  (P-109 L1, **RAD-271**) — todos `done`. **Ressalva:** este projeto ainda não tem nenhuma
  infraestrutura real aplicada em AWS (`tofu init -reconfigure`/`plan` falham com
  `InvalidClientTokenId` neste ambiente, mesmo bloqueio de RAD-241/RAD-130/RAD-236/RAD-252) —
  o item "onboarding testado ponta a ponta em dev/staging" da pré-condição original (RAD-288)
  **não pôde ser verificado ao vivo** por não existir ambiente vivo; a evidência disponível é
  a suíte automatizada (identidade 225 testes, cobrança 136, api 230, front 39) e os
  guardiões (`guardiao-arquitetura`/`guardiao-seguranca`/`guardiao-iac`) limpos. O flip só
  produz efeito real quando alguém com credenciais válidas da conta do Radar rodar
  `tofu apply` (dev/staging primeiro, depois prod) — nesse momento o teste ao vivo finalmente
  se torna possível e deve ser feito antes/junto do apply de prod.

**Guardrail que não muda:** `custom:tenantId` continua imutável e fora de
`write_attributes`. Não há caminho — nem por este flag, nem por nenhum outro — para o
cliente gravar o próprio tenant; isso é escalonamento cross-tenant direto (AB1/P-51).
