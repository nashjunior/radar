# Módulo `identity` — config-spec do Amazon Cognito (P-53)

Provedor de identidade do MVP: **Amazon Cognito User Pool** em `sa-east-1` (P-28),
decidido em **P-08**. Este módulo realiza a **operação de identidade** — sessão/tokens,
MFA, recuperação, anti-brute-force, rotação/revogação — que é o escopo de **P-53**
(Pré-lançamento), sobre o mesmo IdP já escolhido. Não reabre a escolha do provedor.

Refs: `docs/05 §4` · `docs/98` P-08/P-53/P-91/P-98 · `arquitetura/08 §§3,5,11` ·
`arquitetura/07` AB3 · `arquitetura/16` TC-AB3 · `apps/api/src/middleware/tenant.ts`.

Este documento é a **config-spec de revisão** (evidência para Selma/P-53) enquanto a
aplicação operacional (`terraform apply` + AB3 num ambiente AWS real) segue bloqueada
por falta de credenciais/tooling neste ambiente — ver seção **Pendente**.

## Invariante de tenant (P-08/P-51) — o eixo de segurança

A borda valida o **JWT OIDC** contra o JWKS do pool; o BFF deriva o `tenantId` do claim
**`custom:tenantId`**, **nunca** de header controlado pelo cliente (o `x-tenant-id` era
placeholder de dev, aposentado em P-91/RAD-43). Dois controles do IaC ancoram isso:

- O atributo `custom:tenantId` é **`mutable = false`** — definido só na criação/admin.
- O app client **não** inclui `custom:tenantId` em `write_attributes` (só `email`,
  `profile`). O usuário **não reescreve o próprio tenant** → fecha o escalonamento AB1.

## Config resolvida (valores para revisão)

| Requisito P-53 / RAD-130 | Setting Terraform | Valor | Racional |
|---|---|---|---|
| Hosted/Managed Login | `aws_cognito_user_pool_domain` | `radar-<env>` | credencial/MFA/signup na Managed Login, não no app (P-98) |
| App client SPA, sem segredo | `generate_secret` | `false` | segredo não vive no browser (P-91/P-98) |
| Authorization Code + PKCE | `allowed_oauth_flows` | `["code"]` | sem implicit; PKCE no SPA |
| Só refresh explícito | `explicit_auth_flows` | `["ALLOW_REFRESH_TOKEN_AUTH"]` | sem password/SRP expostos ao cliente |
| MFA obrigatório, sem SMS | `mfa_configuration` + `software_token_mfa_configuration` | `ON` + TOTP | anti SIM-swap; sem custo/entregabilidade de SMS |
| Recuperação ≠ canal MFA | `account_recovery_setting` | `verified_email` | recovery por e-mail ≠ TOTP (restrição Cognito) |
| Sem autocadastro público | `admin_create_user_config.allow_admin_create_user_only` | `true` | MVP convite-only |
| Senha forte | `password_policy` | 12+, maiúsc/minúsc/número/símbolo, temp 7d | baseline MVP |
| Anti-enumeração | `prevent_user_existence_errors` | `ENABLED` | não revela se usuário existe |
| Anti brute-force / risk | `user_pool_add_ons.advanced_security_mode` | `ENFORCED` (default) | adaptive auth nativo; custo por MAU |
| Remembered devices | `device_configuration` | **omitido** (tracking OFF) | MFA desafiado a cada sessão |
| TTL ID token | `id_token_validity` | **15 min** | janela curta; a borda valida o ID token |
| TTL access token | `access_token_validity` | **15 min** | janela curta |
| Janela refresh | `refresh_token_validity` | **7 dias** | limitada, com rotação + revogação |
| Rotação de refresh | `refresh_token_rotation` | `ENABLED`, grace `0s` | cada uso emite novo refresh e invalida o anterior |
| Revogação | `enable_token_revocation` | `true` | endpoint `/oauth2/revoke` via domínio Hosted UI |
| Proteção de deleção (prod) | `deletion_protection` | `ACTIVE` em prod | evita destruição acidental do pool |

Requer **provider AWS `>= 5.98, < 6.0`** — `refresh_token_rotation` entrou no
`hashicorp/aws` v5.98.0.

## Contrato com o backend (BFF) e o front

Os outputs alimentam a configuração — **nenhum valor é hardcoded** no código:

| Output do stack | Consumidor | Env |
|---|---|---|
| `cognito_user_pool_id` | BFF | `COGNITO_USER_POOL_ID` |
| `cognito_app_client_id` | BFF + front | `COGNITO_CLIENT_ID` / `VITE_COGNITO_CLIENT_ID` |
| `cognito_issuer_url` | BFF | issuer OIDC (bate com `middleware/tenant.ts`) |
| `cognito_jwks_uri` | BFF | validação de assinatura (jose) |
| `cognito_hosted_ui_url` | front | `VITE_COGNITO_AUTHORITY` |
| `cognito_tenant_claim` | BFF | `COGNITO_TENANT_CLAIM` = `custom:tenantId` |

Verificado contra `apps/api/src/middleware/tenant.ts`: mesmo claim (`custom:tenantId`),
mesmo formato de issuer (`https://cognito-idp.sa-east-1.amazonaws.com/<poolId>`),
mesma região (`sa-east-1`) e mesmos nomes de env.

## Defaults por ambiente

- **dev** — `callback/logout` default `http://localhost:5173/...` (harness/local).
- **staging** — `domain_prefix` default `radar-staging`; `callback/logout` exigidos.
- **prod** — sem defaults falsos: `domain_prefix`, `callback_urls`, `logout_urls`
  são **obrigatórios** (valores reais). Advanced Security e TTLs herdam os defaults
  seguros do módulo.

## Validado

- **Arquitetura/viabilidade (Artur):** IaC coerente com o contrato do BFF
  (`middleware/tenant.ts`) — claim, issuer, região e nomes de env batem.
- **Segurança (subagente `guardiao-seguranca`, 2026-07-07):** **sem violações ❌.**
  Tenant ancorado em `custom:tenantId` imutável (`mutable = false`) e fora de
  `write_attributes` — duplamente defendido contra escalonamento AB1/P-51; sem client
  secret no SPA e sem `ALLOW_USER_PASSWORD_AUTH`; sem segredo hardcoded nem `x-tenant-id`
  como autoridade; MFA/recuperação/revogação/rotação/anti-enumeração/advanced security
  presentes; nenhum default inseguro nas 3 stacks (prod sem callback/logout falso;
  Advanced Security `ENFORCED` em todas; TTLs não sobrescritos).

### ⚠️ Follow-ups de hardening pré-lançamento (não bloqueiam o merge)

1. **E-mail de prod em `COGNITO_DEFAULT` (~50/dia).** O canal de recuperação de conta
   (`verified_email`) usa esse envio. Para o MVP **convite-only** (poucos usuários) o teto
   basta; para volume de produção, migrar `email_configuration` para **SES** (mesma conta
   do transacional, `arquitetura/14`). É debt já anotado no código, não regressão deste diff.
2. **Audit log de domínio (`docs/05 §4`).** Invariante Pré-dev ainda **não implementado** no
   código da aplicação. Fora do escopo deste IaC (é infra de IdP, não o `AUDIT_LOG`
   append-only de domínio); registrado por tocar dado de identidade de usuário.

## Verificação estática (RAD-134, 2026-07-07)

Provisionei `opentofu 1.12.3` local só para validação offline (sem creds/backend):

- **`tofu validate`** do stack `staging` (que consome `module.identity`):
  **`Success! The configuration is valid.`** — o IaC compila e type-checa.
- **`tofu fmt`**: `modules/identity/main.tf` **formatado** (alinhamento de `=`; sem
  mudança semântica). `modules/database`/`modules/vpc` ainda têm diffs de fmt — fora
  do escopo desta issue, ficam para os donos desses módulos.

`plan`/`apply` seguem bloqueados (precisam de conta+creds do Radar) — ver Pendente.

## Ferramental de operação (pronto para o unblock)

Assim que houver conta+creds do Radar, dois artefatos tornam o fechamento push-button:

- **`../../scripts/apply-cognito-runbook.md`** — sequência bootstrap→init→validate→
  plan→apply→usuário de teste→AB3→gate, com os pré-requisitos do bloqueio explícitos.
- **`../../scripts/ab3-evidence.sh`** — harness AB3 fiel a `middleware/tenant.ts` +
  este módulo. **Metade A** (rejeição de token na borda: `TOKEN_AUSENTE`/
  `TOKEN_INVALIDO`/`TENANT_AUSENTE_NO_TOKEN`) validada **6/6** contra um mock do
  contrato; **Metade B** (MFA: `MfaConfiguration=ON`, app client sem `*PASSWORD_AUTH*`,
  senha roubada não vira token via API) roda com creds+outputs; **B5** (screenshot TOTP
  na Hosted UI) é a parte manual de TC-AB3. Emite `ab3-summary.md` para a Selma.

## Pendente (bloqueio real — não fechável neste ambiente)

Selma pediu, além do IaC/config acima, **evidência operacional**: `terraform apply`
num ambiente AWS, usuário de teste com `custom:tenantId`, e o **AB3/TC-AB3** (token
inválido/expirado sempre rejeitado; takeover barrado por MFA). Isso exige:

1. **Tooling** — `terraform`/`opentofu` no runner alvo (provisionei tofu local só p/
   `validate`; `apply` precisa do binário no ambiente de execução).
2. **Credenciais AWS do Radar** válidas para `sa-east-1` (as locais retornam
   `InvalidClientTokenId`; os únicos perfis presentes são `cs-*`/`chargescape-*`, de
   **outra empresa — proibido usar** por fronteira de tenant/empresa).
3. **State remoto** — bucket `radar-tf-state-<env>` + tabela `radar-tf-lock` precisam
   pré-existir (passo 0 do runbook).
4. `init/validate/plan/apply` em staging → outputs → usuário de teste → AB3.

**Unblock owner/ação:** DevOps/Segurança provê **conta+credenciais AWS do Radar** e o
binário no runner; então executar `apply-cognito-runbook.md`. Antes de PR/merge, cruzar
o diff com `guardiao-arquitetura` e `guardiao-seguranca` (guarda-corpo do repo).
