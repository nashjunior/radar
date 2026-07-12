# Módulo `waf` — firewall de aplicação da borda (RAD-199)

Metade IaC de **P-55** (a outra metade — headers/CORS/CSRF/validação de schema — já está no
código, `apps/api/src/security.ts`, RAD-160). Binding hoje = AWS WAFv2, scope `REGIONAL`.

Também carrega a allowlist de IP do webhook do Asaas (**P-107(a)**, RAD-258): compensação
obrigatória do aceite de segurança (RAD-253) porque o Asaas autentica webhook por token
estático, não por HMAC no raw body — ver `apps/api/src/routes/webhooks/pagamento.ts`.

Primitiva **própria**, não parte do módulo `edge`: a mesma ACL pode proteger um balanceador
hoje e um CDN/gateway amanhã. Quem **associa** ACL↔borda é o stack, passando `web_acl_ref`
para o `edge` — módulo não importa módulo (A08 §1).

## O que é genuinamente portável

| Conceito | Contrato | Binding AWS |
|---|---|---|
| Handle da ACL | `web_acl_ref` | WAFv2 Web ACL ARN |
| Teto por IP | `rate_limit_per_ip` | `rate_based_statement.limit` (janela de 5 min) |
| Path do webhook restrito | `asaas_webhook_path` | `byte_match_statement` (campo `uri_path`) |
| Allowlist de IP do webhook | `asaas_webhook_ip_allowlist` | `aws_wafv2_ip_set.addresses` |
| Teto de requisição do webhook | `asaas_webhook_rate_limit` | `rate_based_statement.limit` com `scope_down_statement` no path |
| Teto de corpo do webhook | `asaas_webhook_max_body_bytes` | `size_constraint_statement` (campo `body`) |
| Paths de signup a proteger | `cognito_signup_paths` | `byte_match_statement` (campo `uri_path`) |
| Teto de signup por IP | `cognito_signup_rate_limit_per_ip` | `rate_based_statement.limit`, `aggregate_key_type = IP` |

## O que é provider-bound (custo real de exit)

- **Regras gerenciadas AWS** (`AWSManagedRulesCommonRuleSet`, `KnownBadInputs`) — GCP Cloud
  Armor e Azure Front Door têm conjuntos equivalentes (OWASP CRS), com nomes/versões próprias.
- **`scope = REGIONAL`** — dicotomia REGIONAL/CLOUDFRONT é da AWS.
- **`aws_wafv2_ip_set` + `ip_set_reference_statement`** — mecanismo de allowlist por IP é da
  WAFv2; Cloud Armor (GCP) e Front Door (Azure) implementam o mesmo conceito com recursos
  próprios.

## Allowlist do webhook Asaas (P-107(a))

Regra `asaas-webhook-ip-allowlist`: bloqueia POST fora da lista oficial **só** quando o path
começa com `asaas_webhook_path` (`STARTS_WITH`, default `/webhooks/pagamento`) — `/api/*` e
`/health` não são tocados. Dentro da lista, cai no `default_action` (ALLOW) e segue para a
autenticação por token estático da aplicação; a regra é a camada de **rede**, não substitui a
de aplicação.

O default de `asaas_webhook_ip_allowlist` são os 4 IPs de **produção** publicados em
`docs.asaas.com/docs/ips-oficiais-do-asaas` (lista atualizada em 2024-10-23, dois IPs antigos
desativados). A doc do Asaas registra que o ambiente **Sandbox pode ter IPs adicionais**
`[A VALIDAR]` — se um stack usar conta sandbox do Asaas (dev/staging, a confirmar), sobrescreva
a variável em vez de editar o default do módulo.

## Rate-limit e corpo próprios do webhook (RAD-252, P-107 (5))

Duas regras adicionais, escopadas ao MESMO `asaas_webhook_path` da allowlist acima:

- `asaas-webhook-rate-limit`: `rate_based_statement` com `scope_down_statement` no path —
  teto PRÓPRIO (`asaas_webhook_rate_limit`, default 500/5min), independente do
  `rate-limit-por-ip` geral (regra 3, aplicado a toda a API). Justificativa: o webhook é
  tráfego servidor-a-servidor de poucos IPs conhecidos (a própria allowlist), não navegador —
  o teto pode e deve ser mais apertado, sem competir com o tráfego de usuário da API.
- `asaas-webhook-corpo-pequeno`: `size_constraint_statement` no campo `body`
  (`oversize_handling = MATCH`) — bloqueia corpo acima de `asaas_webhook_max_body_bytes`
  (default 8 KiB). Notificação de webhook é JSON pequeno, sem anexo/upload; corpo grande é
  anomalia de payload, não notificação legítima do Asaas.

Ambas caem no `default_action` (ALLOW) quando dentro do teto — não substituem a autenticação
por token estático da aplicação, só reduzem a superfície antes dela.

## Rate-limit + CAPTCHA no signup do Cognito (RAD-273, P-109 L2)

Regra `cognito-signup-rate-limit-ip` (prioridade 7), escopada via `or_statement`/
`byte_match_statement` aos paths de `var.cognito_signup_paths` (default `/signup`,
`/confirm`, `/confirmUser`, `/resendcode` — o fluxo de criação de conta do Hosted/Managed
Login, per a referência oficial da AWS de endpoints do user pool). Camada L2 do anti-abuso
de trial (**P-109**): não resolve Sybil sozinha (RAD-268 já decidiu que a defesa real é teto
de *valor*, L0/L1), mas encarece o *unitário* do ataque de farm de contas.

- **Ação CAPTCHA, nunca BLOCK** — falso positivo em NAT corporativo/IP compartilhado é caro
  demais para a persona central (fornecedor pequeno, docs/01 §3).
- **Agregação por ASN, não só IP, foi pedida no ticket ("se der") e CONFERIDA — não dá
  hoje.** O `hashicorp/aws 5.100.0` (pin do `.terraform.lock.hcl` dos stacks) só aceita
  `custom_key` de tipo `cookie`/`forwarded_ip`/`header`/`http_method`/`ip`/
  `ja3_fingerprint`/`ja4_fingerprint`/`label_namespace`/`query_argument`/`query_string`/
  `uri_path` (confirmado via `tofu providers schema -json`) — sem `asn`. A AWS WAF tem
  `asn_match_statement` (MATCH por lista de ASN, não agregação de rate-limit) e há um
  [issue aberto e não resolvido](https://github.com/hashicorp/terraform-provider-aws/issues/43492)
  no `terraform-provider-aws` pedindo exatamente isso. Não é lacuna do módulo — é a API da
  AWS ainda não exposta pelo provider. Reabrir quando o provider suportar (bump de versão é
  decisão à parte, fora do escopo deste ticket — ver `PARIDADE.md` sobre risco de bump).
- **Nunca toca `/login` nem `/oauth2/authorize`** — a própria AWS avisa que uma regra com
  ação CAPTCHA nesses paths pode quebrar o registro de MFA TOTP em andamento (P-53); como o
  escopo aqui é só os paths de criação de conta, não há colisão.
- **Associação é do módulo `identity`** (`web_acl_ref`, mesmo padrão do `edge`) — este módulo
  só produz a regra; quem associa ao user pool é o consumidor, no stack.
- **Auto-cadastro por stack (RAD-283/RAD-284):** o `/signup` que esta regra protege só
  existe onde `identity.permitir_auto_cadastro = true` — hoje dev/staging (regra ativa) e
  prod ainda `false`, atrás de um gate de aplicação (ver `modules/identity/README.md`). Em
  prod a regra fica associada e correta, porém inerte, até o flip.

## O limite que importa entender

O rate-limit **por tenant** que P-55 pede **não é implementável aqui**: o `tenantId` vem de
**claim verificado do JWT** (P-08) e o WAF não valida assinatura de token — agregar pelo
header `Authorization` não serve (o token muda a cada sessão). O WAF entrega o bulkhead
**grosso por IP**, antes da aplicação; o teto **por tenant** fica na aplicação, onde o
`tenantId` já foi derivado do claim.
