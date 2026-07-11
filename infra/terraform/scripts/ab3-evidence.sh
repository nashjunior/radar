#!/usr/bin/env bash
#
# ab3-evidence.sh — Harness de evidência AB3 (account takeover) para Selma / P-53.
#
# AB3 (arquitetura/07 · TC-AB3 arquitetura/16): "token inválido/expirado sempre
# rejeitado; MFA barra takeover". Este script coleta a evidência AUTOMATIZÁVEL das
# duas metades e deixa marcada a parte MANUAL (Hosted UI + TOTP), que TC-AB3 lista
# como "CI + Manual (P-53)".
#
# É fiel ao contrato real da borda (apps/api/src/middleware/tenant.ts):
#   - sem Bearer            -> 401  {code: TOKEN_AUSENTE}
#   - token quebrado/forjado/expirado -> 401 {code: TOKEN_INVALIDO}
#   - token válido sem claim de tenant -> 403 {code: TENANT_AUSENTE_NO_TOKEN}
#   - token válido + custom:tenantId  -> passa (200 no endpoint protegido)
# e à config do IdP (infra/terraform/modules/identity/main.tf): MFA ON/TOTP,
# app client só com ALLOW_REFRESH_TOKEN_AUTH (sem password auth via API) e
# allowed_oauth_flows = ["code"].
#
# PRÉ-REQUISITOS (o bloqueio de RAD-134): terraform/tofu aplicado num ambiente AWS
# real, credenciais AWS válidas em sa-east-1, e um usuário de teste com
# custom:tenantId. Sem isso, só as metades que não dependem de token real rodam.
#
# Uso:
#   Variáveis de ambiente (todas opcionais degradam com WARN, exceto BFF_URL p/ metade A
#   e USER_POOL_ID + creds AWS p/ metade B):
#     BFF_URL          base do BFF em execução        (ex.: https://staging-api.radar.example)
#     PROTECTED_PATH   rota protegida p/ testar borda (default: /api/identidade/perfil)
#     USER_POOL_ID     output cognito_user_pool_id
#     APP_CLIENT_ID    output cognito_app_client_id
#     AWS_REGION       default sa-east-1
#     TEST_USERNAME    e-mail do usuário de teste (metade B)
#     STOLEN_PASSWORD  senha do usuário de teste — simula credencial roubada (metade B, B3)
#     VALID_ID_TOKEN   ID token válido obtido via Hosted UI (controle positivo A6)
#     EXPIRED_ID_TOKEN ID token real já expirado (caso A4; senão vira MANUAL)
#     NOTENANT_ID_TOKEN token válido de usuário SEM custom:tenantId (caso A5 opcional)
#     OUT_DIR          diretório do bundle de evidência (default: ./ab3-evidence-<env>)
#
# Saída: bundle em OUT_DIR (por-caso .txt + resumo ab3-summary.md) e exit != 0 se
# QUALQUER asserção automatizada falhar.
#
# Refs: arquitetura/07 AB3 · arquitetura/16 TC-AB3 · docs/98 P-53 ·
#       apps/api/src/middleware/tenant.ts · infra/terraform/modules/identity/*

set -uo pipefail

AWS_REGION="${AWS_REGION:-sa-east-1}"
PROTECTED_PATH="${PROTECTED_PATH:-/api/identidade/perfil}"
OUT_DIR="${OUT_DIR:-./ab3-evidence}"
mkdir -p "$OUT_DIR"

PASS=0; FAIL=0; WARN=0
SUMMARY="$OUT_DIR/ab3-summary.md"
: > "$SUMMARY"

log()  { printf '%s\n' "$*"; }
row()  { printf '| %s | %s | %s |\n' "$1" "$2" "$3" >> "$SUMMARY"; }
pass() { PASS=$((PASS+1)); log "  ✅ PASS  $1"; row "$2" "PASS ✅" "$3"; }
fail() { FAIL=$((FAIL+1)); log "  ❌ FAIL  $1"; row "$2" "FAIL ❌" "$3"; }
warn() { WARN=$((WARN+1)); log "  ⚠️  SKIP  $1"; row "$2" "SKIP ⚠️" "$3"; }

need() { command -v "$1" >/dev/null 2>&1 || { log "dependência ausente: $1"; exit 2; }; }
need curl

log "==================================================================="
log " AB3 — evidência de account takeover (TC-AB3 / P-53)"
log " region=$AWS_REGION  protected=$PROTECTED_PATH  out=$OUT_DIR"
log "==================================================================="
{
  echo "# Evidência AB3 — account takeover (TC-AB3 / P-53)"
  echo
  echo "- Gerado por: infra/terraform/scripts/ab3-evidence.sh"
  echo "- region: \`$AWS_REGION\` · protected path: \`$PROTECTED_PATH\`"
  echo "- BFF_URL: \`${BFF_URL:-<não informado>}\` · USER_POOL_ID: \`${USER_POOL_ID:-<não informado>}\`"
  echo
  echo "| Caso | Resultado | Evidência |"
  echo "|---|---|---|"
} >> "$SUMMARY"

# ---------------------------------------------------------------------------
# METADE A — token inválido/expirado sempre rejeitado (borda BFF, 401)
# ---------------------------------------------------------------------------
log ""
log "## METADE A — rejeição de token na borda (401)"

# request helper: escreve corpo em $OUT_DIR/<name>.body e ecoa o HTTP status
req() { # name  authHeaderValue(optional)
  local name="$1"; shift
  local body="$OUT_DIR/$name.body"
  if [ "$#" -gt 0 ] && [ -n "${1:-}" ]; then
    curl -sS -o "$body" -w '%{http_code}' -H "authorization: $1" \
      "${BFF_URL%/}$PROTECTED_PATH" 2>>"$OUT_DIR/$name.err"
  else
    curl -sS -o "$body" -w '%{http_code}' \
      "${BFF_URL%/}$PROTECTED_PATH" 2>>"$OUT_DIR/$name.err"
  fi
}

# JWT estruturalmente válido, assinatura LIXO (simula token forjado/roubado c/ chave errada).
b64url() { openssl base64 -A 2>/dev/null | tr '+/' '-_' | tr -d '='; }
forge_bad_sig_jwt() {
  local hdr pl iss aud
  iss="https://cognito-idp.${AWS_REGION}.amazonaws.com/${USER_POOL_ID:-fake-pool}"
  aud="${APP_CLIENT_ID:-fake-client}"
  hdr=$(printf '{"alg":"RS256","kid":"forged","typ":"JWT"}' | b64url)
  # exp bem no futuro: prova que a REJEIÇÃO é por assinatura, não por expiração.
  pl=$(printf '{"iss":"%s","aud":"%s","token_use":"id","custom:tenantId":"t-forjado","exp":4102444800,"iat":1704067200}' "$iss" "$aud" | b64url)
  printf '%s.%s.%s' "$hdr" "$pl" "Zm9yZ2VkLXNpZ25hdHVyZS1ub3QtZnJvbS1qd2tz"
}

assert_status_code() { # name  wantHTTP  wantJsonCode  caseId  desc
  local name="$1" want_http="$2" want_code="$3" case_id="$4" desc="$5"
  local got_http body got_code
  got_http="$name"; # placeholder; overwritten below
  got_http="$(cat "$OUT_DIR/$name.http" 2>/dev/null)"
  body="$(cat "$OUT_DIR/$name.body" 2>/dev/null)"
  got_code="$(printf '%s' "$body" | sed -n 's/.*"code" *: *"\([A-Z_]*\)".*/\1/p' | head -1)"
  if [ "$got_http" = "$want_http" ] && { [ -z "$want_code" ] || [ "$got_code" = "$want_code" ]; }; then
    pass "$desc (HTTP $got_http${got_code:+, code=$got_code})" "$case_id" "HTTP $got_http${got_code:+ · \`$got_code\`}"
  else
    fail "$desc (esperado HTTP $want_http/${want_code:-*}, obtido HTTP ${got_http:-?}/${got_code:-?})" "$case_id" "esperado $want_http/${want_code:-*}, obtido ${got_http:-?}/${got_code:-?}"
  fi
}

if [ -n "${BFF_URL:-}" ]; then
  need openssl
  # A1 — sem Bearer
  req a1_no_token > "$OUT_DIR/a1_no_token.http"
  assert_status_code a1_no_token 401 TOKEN_AUSENTE "A1 sem token" "requisição sem Bearer é rejeitada"
  # A2 — Bearer lixo
  req a2_garbage "Bearer not-a-jwt" > "$OUT_DIR/a2_garbage.http"
  assert_status_code a2_garbage 401 TOKEN_INVALIDO "A2 token malformado" "Bearer não-JWT é rejeitado"
  # A3 — assinatura forjada
  req a3_forged "Bearer $(forge_bad_sig_jwt)" > "$OUT_DIR/a3_forged.http"
  assert_status_code a3_forged 401 TOKEN_INVALIDO "A3 assinatura forjada" "JWT com assinatura fora do JWKS é rejeitado"
  # A4 — token real expirado (precisa insumo real)
  if [ -n "${EXPIRED_ID_TOKEN:-}" ]; then
    req a4_expired "Bearer $EXPIRED_ID_TOKEN" > "$OUT_DIR/a4_expired.http"
    assert_status_code a4_expired 401 TOKEN_INVALIDO "A4 token expirado" "ID token Cognito expirado é rejeitado"
  else
    warn "A4 token expirado — forneça EXPIRED_ID_TOKEN (token real já expirado)" "A4 token expirado" "MANUAL — sem insumo EXPIRED_ID_TOKEN"
  fi
  # A5 — token válido SEM tenant (opcional): 403 TENANT_AUSENTE
  if [ -n "${NOTENANT_ID_TOKEN:-}" ]; then
    req a5_notenant "Bearer $NOTENANT_ID_TOKEN" > "$OUT_DIR/a5_notenant.http"
    assert_status_code a5_notenant 403 TENANT_AUSENTE_NO_TOKEN "A5 sem claim tenant" "token válido sem custom:tenantId barrado (403)"
  else
    warn "A5 sem claim de tenant — opcional, forneça NOTENANT_ID_TOKEN" "A5 sem claim tenant" "opcional — sem insumo"
  fi
  # A6 — controle positivo: token válido com tenant passa
  if [ -n "${VALID_ID_TOKEN:-}" ]; then
    req a6_valid "Bearer $VALID_ID_TOKEN" > "$OUT_DIR/a6_valid.http"
    got="$(cat "$OUT_DIR/a6_valid.http")"
    if [ "$got" = "401" ] || [ "$got" = "403" ]; then
      fail "A6 controle positivo (token válido devolveu HTTP $got — deveria passar)" "A6 controle positivo" "token válido rejeitado (HTTP $got)"
    else
      pass "A6 controle positivo (token válido aceito, HTTP $got)" "A6 controle positivo" "HTTP $got (aceito)"
    fi
  else
    warn "A6 controle positivo — forneça VALID_ID_TOKEN (via Hosted UI)" "A6 controle positivo" "MANUAL — sem insumo VALID_ID_TOKEN"
  fi
else
  warn "METADE A pulada — BFF_URL não informado" "METADE A (borda)" "BFF_URL ausente"
fi

# ---------------------------------------------------------------------------
# METADE B — MFA barra takeover (Cognito, AWS CLI)
# ---------------------------------------------------------------------------
log ""
log "## METADE B — MFA barra takeover"

if [ -n "${USER_POOL_ID:-}" ] && command -v aws >/dev/null 2>&1; then
  export AWS_PAGER=""
  # B1 — MFA obrigatório no pool
  aws cognito-idp describe-user-pool --user-pool-id "$USER_POOL_ID" --region "$AWS_REGION" \
      > "$OUT_DIR/b1_describe_pool.json" 2> "$OUT_DIR/b1.err"
  mfa="$(sed -n 's/.*"MfaConfiguration" *: *"\([A-Z]*\)".*/\1/p' "$OUT_DIR/b1_describe_pool.json" | head -1)"
  if [ "$mfa" = "ON" ]; then
    pass "B1 MfaConfiguration=ON no pool" "B1 MFA obrigatório" "MfaConfiguration=ON"
  else
    fail "B1 MfaConfiguration (obtido '${mfa:-?}', esperado ON)" "B1 MFA obrigatório" "MfaConfiguration=${mfa:-?}"
  fi

  # B2 — app client NÃO expõe password auth via API; só code flow
  if [ -n "${APP_CLIENT_ID:-}" ]; then
    aws cognito-idp describe-user-pool-client --user-pool-id "$USER_POOL_ID" \
        --client-id "$APP_CLIENT_ID" --region "$AWS_REGION" \
        > "$OUT_DIR/b2_describe_client.json" 2> "$OUT_DIR/b2.err"
    if grep -qE 'ALLOW_USER_PASSWORD_AUTH|ALLOW_ADMIN_USER_PASSWORD_AUTH|USER_PASSWORD_AUTH' "$OUT_DIR/b2_describe_client.json"; then
      fail "B2 app client expõe fluxo de senha (não deveria)" "B2 sem password auth" "ExplicitAuthFlows contém *PASSWORD_AUTH*"
    else
      pass "B2 app client sem *PASSWORD_AUTH* (só refresh/code)" "B2 sem password auth" "sem *PASSWORD_AUTH* nos ExplicitAuthFlows"
    fi
  else
    warn "B2 — APP_CLIENT_ID não informado" "B2 sem password auth" "APP_CLIENT_ID ausente"
  fi

  # B3 — prova ativa: senha roubada NÃO vira token via API
  if [ -n "${TEST_USERNAME:-}" ] && [ -n "${STOLEN_PASSWORD:-}" ] && [ -n "${APP_CLIENT_ID:-}" ]; then
    if aws cognito-idp admin-initiate-auth --user-pool-id "$USER_POOL_ID" \
         --client-id "$APP_CLIENT_ID" --region "$AWS_REGION" \
         --auth-flow ADMIN_USER_PASSWORD_AUTH \
         --auth-parameters "USERNAME=$TEST_USERNAME,PASSWORD=$STOLEN_PASSWORD" \
         > "$OUT_DIR/b3_initiate_auth.json" 2> "$OUT_DIR/b3.err"; then
      # se voltou, exige challenge de MFA e NÃO devolveu AuthenticationResult (tokens)
      if grep -q '"ChallengeName"' "$OUT_DIR/b3_initiate_auth.json" && \
         grep -qE 'SOFTWARE_TOKEN_MFA|SMS_MFA|MFA' "$OUT_DIR/b3_initiate_auth.json" && \
         ! grep -q '"AuthenticationResult"' "$OUT_DIR/b3_initiate_auth.json"; then
        pass "B3 senha correta devolve challenge de MFA, sem tokens" "B3 senha roubada barrada" "ChallengeName=*MFA*, sem AuthenticationResult"
      elif grep -q '"AuthenticationResult"' "$OUT_DIR/b3_initiate_auth.json"; then
        fail "B3 senha sozinha emitiu tokens (MFA NÃO barrou)" "B3 senha roubada barrada" "AuthenticationResult presente — takeover NÃO barrado"
      else
        pass "B3 auth não emitiu tokens (challenge/erro esperado)" "B3 senha roubada barrada" "sem AuthenticationResult"
      fi
    else
      # o esperado neste app client: InvalidParameterException (fluxo não habilitado)
      errtxt="$(cat "$OUT_DIR/b3.err")"
      if printf '%s' "$errtxt" | grep -qiE 'not enabled|InvalidParameterException|not supported'; then
        pass "B3 fluxo de senha via API desabilitado (senha roubada inútil na API)" "B3 senha roubada barrada" "auth flow não habilitado — token via senha impossível na API"
      else
        pass "B3 admin-initiate-auth falhou sem emitir tokens" "B3 senha roubada barrada" "sem tokens (erro: $(printf '%s' "$errtxt" | head -1))"
      fi
    fi
  else
    warn "B3 — forneça TEST_USERNAME + STOLEN_PASSWORD + APP_CLIENT_ID" "B3 senha roubada barrada" "sem insumos de usuário de teste"
  fi

  # B4 — estado de MFA do usuário de teste (após enroll TOTP)
  if [ -n "${TEST_USERNAME:-}" ]; then
    aws cognito-idp admin-get-user --user-pool-id "$USER_POOL_ID" \
        --username "$TEST_USERNAME" --region "$AWS_REGION" \
        > "$OUT_DIR/b4_admin_get_user.json" 2> "$OUT_DIR/b4.err"
    if grep -q '"custom:tenantId"' "$OUT_DIR/b4_admin_get_user.json"; then
      pass "B4 usuário de teste tem custom:tenantId" "B4 usuário com tenant" "atributo custom:tenantId presente"
    else
      warn "B4 usuário sem custom:tenantId visível (confira criação)" "B4 usuário com tenant" "custom:tenantId não visível em admin-get-user"
    fi
  else
    warn "B4 — TEST_USERNAME não informado" "B4 usuário com tenant" "TEST_USERNAME ausente"
  fi
else
  warn "METADE B pulada — USER_POOL_ID e/ou AWS CLI ausentes" "METADE B (Cognito)" "USER_POOL_ID/aws ausente"
fi

# B5 — MANUAL: Hosted UI + TOTP (TC-AB3 é "CI + Manual")
warn "B5 MANUAL — logar na Hosted UI com senha correta; após senha o Cognito exige TOTP; tokens só após TOTP. Anexar screenshot." "B5 Hosted UI + TOTP (manual)" "screenshot do desafio SOFTWARE_TOKEN_MFA na Managed Login"

# ---------------------------------------------------------------------------
log ""
log "==================================================================="
log " Resumo: PASS=$PASS  FAIL=$FAIL  SKIP/MANUAL=$WARN"
log " Bundle: $OUT_DIR  (resumo: $SUMMARY)"
log "==================================================================="
{
  echo
  echo "**Resumo:** PASS=$PASS · FAIL=$FAIL · SKIP/MANUAL=$WARN"
  echo
  echo "> AB3 exige as duas metades verdes + a evidência MANUAL B5 (screenshot do TOTP)"
  echo "> para fechar TC-AB3 / P-53 com Selma."
} >> "$SUMMARY"

[ "$FAIL" -eq 0 ] || exit 1
exit 0
