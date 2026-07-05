---
name: guardiao-arquitetura
description: >-
  Use ao criar/alterar código nos módulos do Radar de Licitações (domain/application/infra),
  use cases, entities, VOs, ports ou adapters: valida a Clean Architecture do CÓDIGO
  (direção de dependências para dentro, isolamento entre bounded contexts, entities/VOs
  imutáveis com factory `criar`, use cases `executar(input, signal)` throw-based, ports em
  `application`, branded IDs do `@radar/kernel`, ACL do PNCP e eventos cross-context).
  É a forma-skill do agente homônimo, para agentes que NÃO invocam subagentes do Claude Code
  (ex.: Codex): rode o checklist sobre o SEU diff (git) ANTES de finalizar/PR. As regras são
  ÚNICAS e vivem no agente `.claude/agents/guardiao-arquitetura.md` — esta skill só aponta
  pra elas. NÃO decide modelo de domínio (isso é da `revisar-ddd`). Apenas reporta.
allowed-tools: Read, Grep, Bash(grep:*), Bash(find:*), Bash(cat:*), Bash(ls:*), Bash(git diff:*), Bash(git status:*)
---

# Guardião da arquitetura de código (forma-skill, p/ Codex)

Você valida a Clean Architecture do **seu próprio diff** antes de fechar código — a versão desta função para agentes que **não invocam subagentes** do Claude Code (ex.: Codex). O subagente homônimo (`.claude/agents/guardiao-arquitetura.md`) faz o mesmo para o Claude.

## Fonte ÚNICA das regras — não duplicar aqui

O checklist canônico (regras por camada, ports & adapters, entities/VOs, use cases, erros, ACL + eventos, escopo `tenantId`, cheiros, fronteira com `revisar-ddd`, formato de saída) vive em **`.claude/agents/guardiao-arquitetura.md`**. **Leia esse arquivo e aplique-o ao seu diff.** Quando as convenções mudarem, elas mudam **lá** — esta skill segue sem edição. Não recopie as regras aqui (era a duplicação que gerava drift).

Fontes primárias que o próprio agente cita: `AGENTS.md`/`CLAUDE.md` §Convenções de código · `arquitetura/10-padroes-e-estrutura-de-codigo.md` · `docs/13` (bounded contexts/agregados) · `docs/12 §2` (escopo `tenantId`).

## Como aplicar (Codex valida o PRÓPRIO diff)

1. Colete o diff: `git status --short` e `git diff` (ou `git diff <base>...HEAD`); restrinja ao módulo tocado.
2. **Leia `.claude/agents/guardiao-arquitetura.md`** — o checklist completo por camada.
3. Classifique cada arquivo por módulo e camada (`domain`/`application`/`infra`) e rode o checklist. `grep` para imports proibidos, `Read` para inspecionar o trecho.
4. Antes de marcar violação de fronteira/agregado, confira `docs/13` (autoridade) e o doc 98.
5. Reporte no formato do agente e **corrija as ❌ antes de finalizar/PR**:
   - ❌ **Violação** — o que quebra + `arquivo:linha` + correção (cite a regra/camada)
   - ⚠️ **Cheiro** — padrão suspeito não bloqueante
   - ↪️ **Modelo (é da `revisar-ddd`)** — mudança de agregado/fronteira que precisa da revisão de DDD
   - ✓ **OK** — aderências notáveis (contexto, não exaustivo)

Diferença para o subagente Claude: **você não é um revisor separado** — valida o seu próprio trabalho, e **não invoca subagentes**. Se precisar de uma segunda opinião de arquitetura, peça ao Artur (Claude) para rodar o subagente no seu PR.
