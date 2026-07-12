# Módulo `secrets` — cofre de segredos (RAD-181/RAD-182)

Segredos da aplicação; runtime lê em tempo de execução, nada no pipeline. Binding
hoje = AWS Secrets Manager. LGPD 13.709/2018.

## O que é genuinamente portável

| Conceito | Contrato | Binding AWS |
|---|---|---|
| Handle do segredo | `*_secret_ref` | Secrets Manager ARN |
| Cifra em repouso | `encryption_key_ref` | KMS key ARN (`kms_key_id`) |

## O que é provider-bound (custo real de exit → GCP/Azure)

- **`aws_secretsmanager_secret_version`** — AWS separa secret (metadados) de version
  (valor); em GCP Secret Manager o valor é uma `secret_version`; em Azure Key Vault
  é um `key_vault_secret`. Mesmo conceito, recurso diferente.
- **`recovery_window_in_days`** — AWS tem janela de recuperação de 7–30 dias antes de
  destruição; GCP e Azure têm soft-delete configurável por dias também (portável no
  conceito, diferente nos parâmetros).
- **`lifecycle { ignore_changes = [secret_string] }`** — mecanismo de IaC para não
  sobrescrever rotação manual. Equivale a `prevent_destroy` no conceito; a semântica
  de "IaC seta só o PLACEHOLDER, runtime seta o real" é universal mas o atributo
  Terraform é específico.
- **`kms_key_id` em Secrets Manager** — AWS usa KMS por secret; GCP Secret Manager
  usa CMEK por secret version; Azure Key Vault tem cifra por cofre.

## Rotação — decidida como operacional/manual (RAD-260)

Nenhum segredo deste módulo tem `aws_secretsmanager_secret_rotation`, e isso **é a postura
decidida**, não um gap pendente. Secrets Manager suporta rotação nativa (P-08), mas para um
segredo não-RDS ela exige um **Lambda de rotação próprio** — primitiva nova, fora do catálogo
de módulos de A08. Decisão de arquitetura (Artur, 2026-07-11, RAD-260): **não construir esse
Lambda no MVP**; rotação é **operacional/manual por runbook** (abaixo). Três razões, na ordem:

1. **O par Asaas é assimétrico e só a metade errada é automatizável.** O `authToken` do webhook
   é escolhido por nós e reemissível por API (`PUT /v3/webhooks/{id}`, 32–255 chars) — mas é o
   segredo de **menor** blast radius: o webhook é *gatilho, não autoridade* (P-107 (5)), o
   entitlement só é concedido por callback autenticado ao Asaas. A `asaas_api_key` — que
   **move dinheiro** — **não tem** reemissão programática: o gerenciamento de chaves por API
   existe só para **subcontas** pela conta-pai (com whitelist de IP e habilitação manual de 2h
   no painel); a chave da conta principal só sai/entra pelo painel. Um Lambda cobriria o
   segredo barato e deixaria o caro no runbook de qualquer jeito. Fecha o `[A VALIDAR]` sobre
   a API do Asaas (fontes em [docs/06](../../../../docs/06-glossario-e-fontes.md#fontes-consultadas)).
2. **O custo real da rotação não é o Lambda, é a dupla-chave no verificador.** A troca não é
   atômica (o valor muda no Asaas e na task em momentos distintos) e hoje o ACL compara contra
   **um** token (`tokenWebhookAsaasValido`, `modules/cobranca`). Toda notificação em voo com o
   token antigo tomaria 401 — e **15 falhas consecutivas interrompem a fila do Asaas**, que
   passa a reter eventos sem entregar e **descarta os mais antigos após 14 dias**. Rotação sem
   dupla-chave é auto-DoS na borda de pagamento; com ela, o runbook manual já basta.
3. **Uma chave não paga uma primitiva.** O Lambda se pagaria com N chaves — o que só acontece
   se o Radar adotar **subcontas Asaas** (white label / cobrança por cliente-final, P-25), que
   é exatamente o cenário em que a API de gerenciamento de chaves passa a existir.

**Gatilhos de reabertura:** adoção de subcontas Asaas (P-25); Asaas publicar reemissão da chave
da conta principal por API; ou exigência de compliance com cadência forçada.

### Runbook de rotação (manual, sem interromper a fila do webhook)

Pré-requisito **duro** para os dois: verificação **dupla-chave** no ACL (aceitar token vigente
**e** anterior durante a janela, ambos em tempo constante) — enquanto não existir, rotacionar o
webhook token derruba a fila. Cadência: **90 dias** (webhook token) / **180 dias** (API key),
e **imediata** em suspeita de vazamento ou desligamento de quem teve acesso.

- **`asaas_webhook_token`** — a dupla-chave (RAD-261) já tem IaC dedicada: o segredo
  `asaas_webhook_token_anterior` (`ASAAS_WEBHOOK_TOKEN_ANTERIOR` na task, RAD-262), sempre
  presente e normalmente **vazio** — `tokenWebhookAsaasValido` trata segredo vazio como
  "pula", nunca como match. Passo a passo: (1) publique o valor **atual** de
  `asaas_webhook_token` como nova *version* de `asaas_webhook_token_anterior` (`aws
  secretsmanager put-secret-value`, fora do Terraform — mesmo `ignore_changes` dos demais);
  (2) gere o novo valor e publique-o como nova *version* de `asaas_webhook_token` — a partir
  daqui a app aceita os dois; (3) `PUT /v3/webhooks/{id}` com o novo `authToken`; (4) confirme
  entrega (logs da borda: 200 no `POST /webhooks/pagamento`); (5) só então esvazie
  `asaas_webhook_token_anterior` (nova *version* com `secret_string = ""`) para fechar a
  janela. Se a fila já estiver interrompida, reative com `interrupted: false` no mesmo `PUT`
  **depois** de corrigir o token — nunca antes.
- **`asaas_api_key`** — reemita no painel do Asaas (Integrações → Chaves de API), publique a nova
  version do segredo e **só então** revogue a antiga no painel (a app lê o valor no boot; a
  ordem inversa derruba as chamadas de saída, inclusive a confirmação de pagamento).

O `lifecycle { ignore_changes = [secret_string] }` existe justamente para isso: a IaC seta o
PLACEHOLDER, a rotação (manual) seta o valor real — e o `terraform plan` não a desfaz.
