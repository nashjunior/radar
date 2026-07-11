# Runbook — apply do tier sempre-ligado (RAD-199)

Escrito e validado (`tofu fmt` + `validate` verdes nos 3 stacks); **`apply` bloqueado** até o
unblock de conta AWS (RAD-134, mesma frente do Cognito e do pool de RAD-180).

O ponto desta issue foi matar a falha silenciosa do ECS: **o `apply` sai 0 mesmo quando a task
morre no boot** (o serviço só fica com 0 task sã). Por isso o serviço agora usa
`wait_for_steady_state = true` — o apply **falha alto** em vez de mentir. A consequência é que
a ORDEM abaixo não é opcional: rodar tudo de uma vez falha, porque o registro de imagem nasce
vazio.

## Ordem do primeiro apply

```bash
cd infra/terraform/stacks/<env>

# 1. Registro + rede + cofre primeiro (o serviço ainda não existe).
tofu apply -target=module.registry -target=module.vpc -target=module.secrets

# 2. Preencher os segredos que a task injeta. Sem versão com valor real, o ECS falha em
#    `ResourceInitializationError: unable to pull secrets` (a IaC cria a versão PLACEHOLDER
#    só para o segredo existir; o valor é responsabilidade de quem opera).
aws secretsmanager put-secret-value --secret-id /radar/<env>/field-crypto-key \
  --secret-string "$(openssl rand -base64 32)"        # AES-256-GCM (P-59)
aws secretsmanager put-secret-value --secret-id /radar/<env>/anthropic-api-key \
  --secret-string "<chave>"                            # some quando P-66/Bedrock (IAM) entrar
aws secretsmanager put-secret-value --secret-id /radar/<env>/database-url \
  --secret-string "<connection string apontando p/ o endpoint do PROXY, nunca o cluster (P-41)>"

# 3. Publicar a imagem. `linux/amd64` casa com `cpu_architecture = X86_64` da task def —
#    build em Mac (arm64) sem `--platform` gera task que NUNCA sobe.
REPO=$(tofu output -raw api_image_repository_uri)
aws ecr get-login-password | docker login --username AWS --password-stdin "${REPO%%/*}"
docker buildx build --platform linux/amd64 -f apps/api/Dockerfile -t "$REPO:$(git rev-parse --short HEAD)" --push .

# 4. Agora o resto (borda, WAF, serviço, autoscaling).
tofu apply -var="api_image_tag=$(git rev-parse --short HEAD)"
```

Em **prod** ainda é preciso `-var="tls_certificate_arn=..."`: a `precondition` do módulo `edge`
derruba o plan sem certificado — prod em HTTP puro não passa (A08 §5).

## Evidência a coletar no unblock

| O quê | Como | Por quê |
|---|---|---|
| Task sã | `aws ecs describe-services --query 'services[0].runningCount'` | prova que imagem+segredo+egress fecharam |
| Egress | `tofu output egress_public_ips` | origem fixa que PNCP/LLM enxergam (P-58) |
| Borda | `curl -i https://$(tofu output -raw api_public_hostname)/health` | 200 = target group sã atrás do ALB |
| WAF | `aws wafv2 get-web-acl` + `sampled-requests` | P-55: ACL associada e contando |
| Escala por requisição | `aws application-autoscaling describe-scaling-policies` | a 3ª política (RAD-192) só existe com borda |

## O que este runbook NÃO cobre

- **Rate-limit por tenant** (P-55): fica na aplicação — o `tenantId` só existe depois de
  validar o JWT, e o WAF não valida token. Follow-up de código.
- **Access log do balanceador**: entra com a frente de observabilidade/SIEM (P-62).
- **Push automático no CI**: o job `image-scan` constrói e descarta. Publicar no ECR exige
  credencial AWS — mesma frente de RAD-134.
