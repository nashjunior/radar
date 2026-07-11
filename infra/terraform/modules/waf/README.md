# Módulo `waf` — firewall de aplicação da borda (RAD-199)

Metade IaC de **P-55** (a outra metade — headers/CORS/CSRF/validação de schema — já está no
código, `apps/api/src/security.ts`, RAD-160). Binding hoje = AWS WAFv2, scope `REGIONAL`.

Primitiva **própria**, não parte do módulo `edge`: a mesma ACL pode proteger um balanceador
hoje e um CDN/gateway amanhã. Quem **associa** ACL↔borda é o stack, passando `web_acl_ref`
para o `edge` — módulo não importa módulo (A08 §1).

## O que é genuinamente portável

| Conceito | Contrato | Binding AWS |
|---|---|---|
| Handle da ACL | `web_acl_ref` | WAFv2 Web ACL ARN |
| Teto por IP | `rate_limit_per_ip` | `rate_based_statement.limit` (janela de 5 min) |

## O que é provider-bound (custo real de exit)

- **Regras gerenciadas AWS** (`AWSManagedRulesCommonRuleSet`, `KnownBadInputs`) — GCP Cloud
  Armor e Azure Front Door têm conjuntos equivalentes (OWASP CRS), com nomes/versões próprias.
- **`scope = REGIONAL`** — dicotomia REGIONAL/CLOUDFRONT é da AWS.

## O limite que importa entender

O rate-limit **por tenant** que P-55 pede **não é implementável aqui**: o `tenantId` vem de
**claim verificado do JWT** (P-08) e o WAF não valida assinatura de token — agregar pelo
header `Authorization` não serve (o token muda a cada sessão). O WAF entrega o bulkhead
**grosso por IP**, antes da aplicação; o teto **por tenant** fica na aplicação, onde o
`tenantId` já foi derivado do claim.
