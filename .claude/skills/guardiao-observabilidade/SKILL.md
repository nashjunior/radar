---
name: guardiao-observabilidade
description: >-
  Use ao criar/alterar código que emite log, cruza borda de contexto (API → fila
  → worker), chama fonte externa/LLM, ou toca um caminho coberto por um SLO
  (ingestão, matching, alerta, triagem, custo de IA): valida a postura de
  observabilidade REAL do Radar contra `docs/08 §4.1` (SLOs + error budget) e
  `arquitetura/04 §8` (alarmes sobre as métricas/SLOs) — log estruturado com
  correlation/trace id propagado ponta-a-ponta, métrica emitida onde um SLO exige,
  circuit breaker + alarme em borda externa nova, e o SLO duro "0 alertas de prazo
  crítico perdidos" com sinal medível; e não deixa regredir a redação de dado
  sensível de `apps/api/src/logging.ts`. A convenção concreta (schema do log, campo
  de correlação, nomes de métrica) é fixada pela RAD-300: enquanto não fixada,
  sinaliza como ⚠️ débito; depois, como ❌. É a forma-skill do agente homônimo,
  para agentes que NÃO invocam subagentes do Claude Code (ex.: Codex): rode o
  checklist sobre o SEU diff (git) ANTES de finalizar/PR. As regras são ÚNICAS e
  vivem no agente `.claude/agents/guardiao-observabilidade.md` — esta skill só
  aponta pra elas. NÃO reimplementa a redação (isso é do `guardiao-seguranca`),
  NÃO valida o `.tf` do alarme (isso é do `guardiao-iac`), NÃO decide camada (isso
  é do `guardiao-arquitetura`). Apenas reporta.
allowed-tools: Read, Grep, Bash(grep:*), Bash(find:*), Bash(cat:*), Bash(ls:*), Bash(git diff:*), Bash(git status:*)
---

# Guardião da observabilidade (forma-skill, p/ Codex)

Você valida a observabilidade do **seu próprio diff** antes de fechar código — a
versão desta função para agentes que **não invocam subagentes** do Claude Code
(ex.: Codex). O subagente homônimo (`.claude/agents/guardiao-observabilidade.md`)
faz o mesmo para o Claude.

## Fonte ÚNICA das regras — não duplicar aqui

O checklist canônico (log estruturado + correlação ponta-a-ponta, redação
preservada, métrica por SLO, breaker/alarme em borda externa, sinal do SLO de
prazo crítico, o gate ⚠️→❌ dependente da RAD-300, fronteira com os irmãos,
formato de saída) vive em **`.claude/agents/guardiao-observabilidade.md`**. **Leia
esse arquivo e aplique-o ao seu diff.** Quando as convenções mudarem — em especial
quando a **RAD-300** fixar o schema do log e os nomes de métrica —, elas mudam
**lá** e o gate ⚠️→❌ é promovido **lá**; esta skill segue sem edição. Não recopie
as regras aqui (é a duplicação que gera drift).

Fontes primárias que o próprio agente cita: `docs/08-metricas.md §4.1` (SLOs) ·
`arquitetura/04-teste-de-estresse-e-falhas.md §§4,8` (métricas de falha + alarmes)
· `docs/05 §4` (fatia de observabilidade que cruza com segurança) · `docs/98`
P-34/P-35/P-36/P-37 · referências vivas `apps/api/src/logging.ts` e
`modules/ingestao/src/infra/adapters/circuit-breaker.ts` · **RAD-300** (Paperclip).

## Como aplicar (Codex valida o PRÓPRIO diff)

1. Colete o diff: `git status --short` e `git diff` (ou `git diff <base>...HEAD`).
2. **Leia `.claude/agents/guardiao-observabilidade.md`** — o checklist completo e
   a régua ⚠️-vs-❌ (calibrada por a RAD-300 já ter fixado a convenção ou não).
3. Classifique cada arquivo por o que toca (logger/formato de log, envelope de
   fila, worker, adapter de fonte externa/LLM, caminho de SLO) e rode o checklist.
   `grep` para `console.` cru vs. logger, propagação de id no envelope, emissão de
   métrica; `Read` para inspecionar o trecho.
4. **Antes de marcar ❌ nas regras 1/3/5, confirme que a RAD-300 já fixou a
   convenção** (o agente estará atualizado com o schema/nomes reais). Se ainda não
   fechou → é ⚠️ débito, não ❌. **❌ hoje** só para regressão (redação quebrada,
   breaker/alarme removido).
5. Reporte no formato do agente e **corrija as ❌ antes de finalizar/PR**:
   - ❌ **Violação** — regressão de redação/breaker (hoje); regras 1/3/5 (pós-RAD-300) + `arquivo:linha` + `docs/08 §4.1`/`arquitetura/04 §8`
   - ⚠️ **Débito conhecido** — caminho novo sem log correlacionado/métrica/breaker enquanto a convenção não fechou
   - ↪️ **É de outro guardião** — `guardiao-seguranca` (conteúdo sensível em log/métrica) · `guardiao-iac` (`.tf` do alarme) · `guardiao-arquitetura` (telemetria vazando de camada)
   - ✓ **OK** — aderências notáveis (redação preservada, breaker presente, id propagado)

Diferença para o subagente Claude: **você não é um revisor separado** — valida o
seu próprio trabalho, e **não invoca subagentes**. Se precisar de uma segunda
opinião de observabilidade, peça ao Artur (Claude) para rodar o subagente no seu PR.
