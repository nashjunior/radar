---
name: guardiao-iac
description: >-
  Use ao criar/alterar código de infraestrutura (Terraform/IaC) do Radar de Licitações —
  módulos e stacks em `infra/terraform` (e o rewrite `infra/terraform-next`, RAD-181): valida
  os invariantes REAIS de A08 no `.tf` — modules-by-primitive sem módulo importando módulo
  (composição só no stack), contratos (`variables`/`outputs`) provider-agnósticos com a
  convenção `_ref`, provider-bound documentado (não fingido neutro), paridade swap-safe (não
  mover/renomear recurso, `plan` = no changes), o guardrail PRESERVAR (P-41 bulkheads/timeouts,
  KMS, sub-rede privada proxy-only, DLQ, seam serverless gated-off) e a postura de segurança de
  infra (DB sem IP público, egress allowlist/SSRF, cifra KMS, segredo nunca hardcoded,
  `sa-east-1`, state remoto com lock). É a forma-skill do agente homônimo, para agentes que NÃO
  invocam subagentes do Claude Code (ex.: Codex): rode o checklist sobre o SEU diff (git) ANTES
  de finalizar/PR. As regras são ÚNICAS e vivem no agente `.claude/agents/guardiao-iac.md` —
  esta skill só aponta pra elas. NÃO cobre Clean Architecture do código de app (isso é do
  `guardiao-arquitetura`) nem lint genérico de Terraform (isso é tfsec/checkov). Apenas reporta.
allowed-tools: Read, Grep, Bash(grep:*), Bash(find:*), Bash(cat:*), Bash(ls:*), Bash(git diff:*), Bash(git status:*)
---

# Guardião da IaC / Terraform (forma-skill, p/ Codex)

Você valida a infraestrutura como código do **seu próprio diff** antes de fechar — a versão desta função para agentes que **não invocam subagentes** do Claude Code (ex.: Codex). O subagente homônimo (`.claude/agents/guardiao-iac.md`) faz o mesmo para o Claude.

## Fonte ÚNICA das regras — não duplicar aqui

O checklist canônico (portabilidade/estrutura A08 §4/§6/§10, paridade swap-safe RAD-181, guardrail PRESERVAR P-41, postura de segurança de infra A08 §5/§7 + docs/05, cheiros, fronteira com os irmãos, formato de saída) vive em **`.claude/agents/guardiao-iac.md`**. **Leia esse arquivo e aplique-o ao seu diff.** Quando as convenções mudarem, elas mudam **lá** — esta skill segue sem edição. Não recopie as regras aqui (é a duplicação que gera drift).

Fontes primárias que o próprio agente cita: `arquitetura/08-infraestrutura-e-implantacao.md` §§4-7/§10 · `docs/98` P-64/P-28/P-27/P-41/P-96/P-08 · `docs/05` §4 (fatia de infra) · referência viva `infra/terraform-next/README.md` + `PARIDADE.md` + `modules/database`/`modules/db_proxy`.

## Como aplicar (Codex valida o PRÓPRIO diff)

1. Colete o diff: `git status --short` e `git diff` (ou `git diff <base>...HEAD`); restrinja a `infra/`.
2. **Leia `.claude/agents/guardiao-iac.md`** — o checklist completo.
3. Classifique cada arquivo por módulo/stack e por tipo (`variables.tf`/`outputs.tf` = contrato; `main.tf` = binding; `backend.tf` = estado; `*.tfvars` = valores; `README.md` = exit-cost) e rode o checklist. `grep` para `source =` proibido em módulo, região fora de `sa-east-1`, segredo literal, `publicly_accessible`, `provider "google|azurerm"`; `Read` para inspecionar o recurso.
4. Antes de marcar quebra de paridade, cheque `infra/terraform-next/PARIDADE.md` (autoridade do que preserva estado); antes de marcar regressão PRESERVAR, confira o valor no `infra/terraform` atual.
5. Reporte no formato do agente e **corrija as ❌ antes de finalizar/PR**:
   - ❌ **Violação** — o que quebra + `arquivo:linha` + a regra/`§` (A08/P-NN) + correção
   - ⚠️ **Cheiro** — padrão suspeito não bloqueante (output cru sem `_ref`, lint genérico gritante)
   - ↪️ **É de outro guardião / tfsec** — segurança de código TS (`guardiao-seguranca`) ou lint genérico (tfsec/checkov)
   - ✓ **OK** — aderências notáveis (contexto, não exaustivo)

Diferença para o subagente Claude: **você não é um revisor separado** — valida o seu próprio trabalho, e **não invoca subagentes**. Se precisar de uma segunda opinião de infra, peça ao Artur (Claude) para rodar o subagente no seu PR.
