---
name: guardiao-seguranca
description: >-
  Use ao criar/alterar código que toque dado pessoal, dado de cliente
  (critério, alerta, triagem, perfil de habilitação), prompt de LLM,
  autenticação/autorização de tenant, ou segredo/credencial: valida os
  controles REAIS de `docs/05-seguranca-e-privacidade.md` no CÓDIGO — classe
  crítica (estratégia comercial do cliente) nunca vai a LLM/log, tenant sempre
  derivado de claim JWT verificado (nunca header cru), autorização por objeto,
  segredos nunca hardcoded, edital tratado como dado não confiável, e
  sinaliza a ausência de audit log (invariante Pré-dev de docs/05 §4 ainda não
  implementado). É a forma-skill do agente homônimo, para agentes que NÃO
  invocam subagentes do Claude Code (ex.: Codex): rode o checklist sobre o SEU
  diff (git) ANTES de finalizar/PR. As regras são ÚNICAS e vivem no agente
  `.claude/agents/guardiao-seguranca.md` — esta skill só aponta pra elas. NÃO
  cobre Clean Architecture/camadas (isso é do `guardiao-arquitetura`, irmão) e
  NÃO decide modelo de domínio (isso é da `revisar-ddd`). Apenas reporta.
allowed-tools: Read, Grep, Bash(grep:*), Bash(find:*), Bash(cat:*), Bash(ls:*), Bash(git diff:*), Bash(git status:*)
---

Leia e siga o checklist canônico em
`.claude/agents/guardiao-seguranca.md` — é a fonte única das regras deste
guardião (classificação de dados de docs/05 §9, borda de autenticação/tenant,
autorização por objeto, segredos, edital como dado não confiável, lacuna de
audit log). Rode-o sobre `git status --short` + `git diff` do seu próprio
diff de trabalho, antes de finalizar/PR. Não modifique nada — apenas reporte
❌/⚠️/↪️/✓ no mesmo formato descrito lá.
