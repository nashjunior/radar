# Runbook — aplicar Cognito (RAD-130/RAD-134) e coletar evidência AB3 (P-53)

Sequência **push-button** para quem tiver o ambiente AWS do Radar. O IaC e a
config-spec já estão prontos e revisados (`modules/identity` + `stacks/*`); falta
só a **operação** (`apply` + AB3), bloqueada neste ambiente por não haver conta/creds
do Radar nem binário terraform/tofu — ver "Bloqueio" abaixo.

Refs: `modules/identity/README.md` (config-spec) · `arquitetura/08 §§3,5,11` ·
`arquitetura/07` AB3 · `arquitetura/16` TC-AB3 · `docs/98` P-08/P-53/P-91 ·
`apps/api/src/middleware/tenant.ts` · `scripts/ab3-evidence.sh`.

## Bloqueio observado (RAD-134 / Caio)

| Pré-requisito | Estado neste ambiente | Quem desbloqueia |
|---|---|---|
| binário `terraform`/`tofu` | **ausente** (provisionei `tofu 1.12.3` local só p/ `validate`) | DevOps instala no runner alvo |
| credenciais AWS do Radar (`sa-east-1`) | **inválidas**: `aws sts get-caller-identity` → `InvalidClientTokenId` | DevOps/Segurança provê role/creds do Radar |
| perfis AWS locais existentes | só `cs-*` / `chargescape-*` — **outra empresa; NÃO usar** (fronteira de tenant/empresa) | — |
| Docker daemon | parado (não é necessário p/ Cognito) | — |
| backend de state remoto | bucket `radar-tf-state-<env>` + tabela `radar-tf-lock` precisam **pré-existir** | bootstrap (passo 0) |

> **Nunca** aplicar IaC do Radar com credenciais `cs-*`/`chargescape-*`: é uma conta
> de outra empresa. O apply exige uma conta AWS do **Radar** com permissão de Cognito
> + IAM + S3/DynamoDB (state).

## Passo 0 — bootstrap do state remoto (uma vez por conta)

`backend.tf` de cada stack aponta p/ S3 + DynamoDB. Eles têm de existir **antes** do
`init`:

```bash
aws s3api create-bucket --bucket radar-tf-state-staging \
  --region sa-east-1 --create-bucket-configuration LocationConstraint=sa-east-1
aws s3api put-bucket-versioning --bucket radar-tf-state-staging \
  --versioning-configuration Status=Enabled
aws dynamodb create-table --table-name radar-tf-lock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST --region sa-east-1
# prod: repetir com radar-tf-state-prod
```

## Passo 1 — init / validate / plan / apply (staging primeiro)

```bash
cd infra/terraform/stacks/staging
# tfvars com valores REAIS (callback/logout de verdade, não localhost):
cat > staging.auto.tfvars <<'EOF'
db_username           = "…"          # sensitive
db_password           = "…"          # sensitive
kms_key_arn           = "arn:aws:kms:sa-east-1:<acct>:key/<id>"
cognito_domain_prefix = "radar-staging"
cognito_callback_urls = ["https://staging.radar.<dominio>/auth/callback"]
cognito_logout_urls   = ["https://staging.radar.<dominio>/auth/logout"]
EOF

terraform init            # (ou: tofu init) — baixa provider + conecta no backend S3
terraform validate        # já verde offline: "Success! The configuration is valid."
terraform plan  -out=cognito.plan
terraform apply cognito.plan

# coletar outputs -> alimentam BFF/front (ver README do módulo):
terraform output -json | tee ../../scripts/cognito-outputs-staging.json
```

Repetir em `stacks/prod` com `prod.auto.tfvars` (callback/logout de produção;
`domain_prefix`, `callback_urls`, `logout_urls` são **obrigatórios**, sem default falso).

## Passo 2 — usuário de teste com `custom:tenantId`

```bash
POOL=$(terraform output -raw cognito_user_pool_id)
aws cognito-idp admin-create-user --user-pool-id "$POOL" \
  --username teste-ab3@radar.local \
  --user-attributes Name=email,Value=teste-ab3@radar.local \
                    Name=email_verified,Value=true \
                    Name=custom:tenantId,Value=t-ab3 \
  --message-action SUPPRESS --region sa-east-1
aws cognito-idp admin-set-user-password --user-pool-id "$POOL" \
  --username teste-ab3@radar.local --password '<Senha-Forte-12+>' --permanent \
  --region sa-east-1
# enrolar TOTP p/ o usuário (associate-software-token + verify-software-token) via
# Hosted UI no 1º login — necessário p/ a evidência B5.
```

`custom:tenantId` é `mutable=false`: só entra aqui, na criação. O usuário nunca reescreve.

## Passo 3 — rodar AB3 (`scripts/ab3-evidence.sh`)

Metade A precisa do BFF em execução apontando p/ o pool novo (envs do README do módulo);
Metade B precisa de creds AWS + os outputs.

```bash
export BFF_URL="https://staging-api.radar.<dominio>"
export USER_POOL_ID=$(terraform output -raw cognito_user_pool_id)
export APP_CLIENT_ID=$(terraform output -raw cognito_app_client_id)
export TEST_USERNAME="teste-ab3@radar.local"
export STOLEN_PASSWORD='<a mesma senha — simula credencial roubada>'
# tokens reais via Hosted UI (login do usuário de teste):
export VALID_ID_TOKEN="<id_token do redirect Authorization Code>"
export EXPIRED_ID_TOKEN="<id_token real após expirar (>15min)>"
export OUT_DIR="./ab3-evidence-staging"

bash infra/terraform/scripts/ab3-evidence.sh   # exit 0 = todas as asserções verdes
```

O harness cobre (fiel a `tenant.ts` + `modules/identity`):

- **A (borda, 401/403):** sem token → `TOKEN_AUSENTE`; malformado/forjado/expirado →
  `TOKEN_INVALIDO`; válido sem tenant → `TENANT_AUSENTE_NO_TOKEN` (403); válido com
  tenant → 200 (controle). *(Engine validado 6/6 contra mock do contrato.)*
- **B (MFA):** `MfaConfiguration=ON`; app client **sem** `*PASSWORD_AUTH*` (senha não
  vira token via API); `admin-initiate-auth` com senha roubada não emite tokens;
  usuário tem `custom:tenantId`.
- **B5 MANUAL:** screenshot do desafio TOTP na Hosted UI após a senha — TC-AB3 é
  "CI + Manual". Anexar ao bundle e entregar à **Selma**.

## Passo 4 — gate antes de PR/merge

1. `terraform fmt -check -recursive` limpo (o módulo `identity` já foi formatado).
2. Rodar o subagente **`guardiao-arquitetura`** no diff (guarda-corpo do repo) — e
   `guardiao-seguranca` já rodou verde na config-spec (README §Validado).
3. Anexar `ab3-summary.md` + screenshot B5 na issue p/ a Selma fechar TC-AB3/P-53.
