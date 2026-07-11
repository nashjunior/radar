# Módulo `edge` — borda HTTP pública (RAD-199)

O ingresso do tier sempre-ligado. Binding hoje = **AWS ALB**.

## P-55 (ALB vs. API Gateway) — decidida: ALB

1. O serviço roda em **sub-rede privada**. API Gateway com integração privada exige **VPC
   Link**, que exige um balanceador (ALB/NLB) atrás dele **de qualquer jeito** — o gateway
   seria custo **somado**, não alternativa.
2. O **WAF que P-55 pede não anexa em HTTP API (v2)**. Sobraria REST API (mais caro por
   requisição) + VPC Link + NLB: três peças para chegar onde o ALB chega sozinho.
3. O que o API Gateway tem de único — *authorizer* JWT nativo, *usage plan* por API key — o
   Radar **não usa**: o JWT é validado na aplicação (`jose`, P-08/P-91) e o rate-limit por
   tenant depende do claim já verificado (ver módulo `waf`).
4. O módulo `compute` **já esperava um ALB**: a política de escala por requisição é
   `ALBRequestCountPerTarget`, cujo *resource label* sai daqui.

**Reabre** se entrar monetização por API key, throttling por plano contratado, ou exposição
da API a terceiros — nada disso está no MVP-Now.

## O que é genuinamente portável

| Conceito | Contrato | Binding AWS |
|---|---|---|
| Firewall da borda | `firewall_group_ref` | Security Group id |
| Alvo das tasks | `target_group_ref` | ALB target group ARN |
| Hostname público | `public_hostname` | ALB DNS name |
| Certificado TLS | `certificate_ref` | ACM certificate ARN |
| ACL do WAF | `web_acl_ref` | WAFv2 Web ACL ARN |

## O que é provider-bound (custo real de exit)

- **`request_scaling_target_ref`** — o formato `app/<lb>/<id>/targetgroup/<tg>/<id>` é
  exigência do CloudWatch/Application Auto Scaling. Em GCP/Azure a métrica equivalente
  (RPS por backend) é referenciada de outro jeito.
- **`tls_policy`** — nome de policy do ELB.
- **`drop_invalid_header_fields`** — atributo do ALB (defesa de request smuggling).

## Postura de segurança

- Borda é o **único** recurso com face pública; o compute segue em sub-rede privada, sem IP
  público (guardrail PRESERVAR).
- Egress da borda **escopado** na porta do container e no CIDR da rede — não `0.0.0.0/0`.
  O lado SG→SG (apertado) fica no `compute`, no ingresso: só a borda alcança a porta 3000.
- **prod exige TLS** — `precondition` no balanceador barra `plan` sem certificado.
- **WAF** (P-55) associado quando o stack passa `web_acl_ref`.

## Pendências que ficam abertas aqui

- **Access logs do balanceador** (bucket + política) — entra junto com o SIEM/observabilidade
  (P-62), não aqui.
- **DNS/certificado**: `certificate_ref` chega pronto de fora (ACM + domínio ainda não
  existem — mesma frente de conta AWS de RAD-134).
