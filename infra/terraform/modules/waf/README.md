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

## O limite que importa entender

O rate-limit **por tenant** que P-55 pede **não é implementável aqui**: o `tenantId` vem de
**claim verificado do JWT** (P-08) e o WAF não valida assinatura de token — agregar pelo
header `Authorization` não serve (o token muda a cada sessão). O WAF entrega o bulkhead
**grosso por IP**, antes da aplicação; o teto **por tenant** fica na aplicação, onde o
`tenantId` já foi derivado do claim.
