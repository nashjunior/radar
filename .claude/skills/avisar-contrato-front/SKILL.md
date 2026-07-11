---
name: avisar-contrato-front
description: >-
  Detecta mudança em contrato consumido pelo front do Radar de Licitações e
  rascunha o aviso — nunca abre a issue sozinha (ação visível a terceiros exige
  confirmação). Observa `apps/web/application/ports.ts`, `apps/web/infra/api/*
  -http-gateway.ts` (URL/verbo/shape de cada gateway HTTP) e os
  `application/dtos.ts`/`events.ts` do módulo backend correspondente (hoje:
  `triagem`, `matching`), além de `shared/contracts/**/*.proto` quando deixar de
  estar inerte (P-70). Classifica cada mudança em breaking (campo
  removido/renomeado, tipo mudou, URL/verbo mudou, campo virou obrigatório) vs.
  aditiva (campo/método/endpoint novo) vs. sem mudança de forma. Use antes de
  finalizar um diff que tocou o contrato do front, ou quando pedirem para
  checar/avisar sobre mudança de contrato back↔front (regra do CLAUDE.md: "mudou
  contrato, avise o front"). Apenas reporta e rascunha — nunca modifica código,
  nunca chama API/CLI do Paperclip.
allowed-tools: Read, Grep, Bash(grep:*), Bash(git diff:*), Bash(git status:*), Bash(find:*), Bash(cat:*)
---

# Avisar contrato back↔front

O CLAUDE.md manda: **"Contrato é fronteira back↔front — mudou contrato, avise o
front."** Nenhum contrato "de verdade" via `shared/contracts` existe ainda
(gRPC/proto, P-70, hoje inerte — sem `.proto`); o contrato real hoje é o par
`apps/web/application/ports.ts` + `apps/web/infra/api/*-http-gateway.ts` (fetch
para `/api/<contexto>/...`) casado com o `application/dtos.ts`/`events.ts` do
módulo backend correspondente. Esta skill audita esse par e **rascunha** o aviso
— nunca cria a issue sozinha.

## Escopo observado

Manter este mapa atualizado conforme novos gateways surgirem em
`apps/web/infra/api/`:

| Lado front | Lado backend (módulo) |
|---|---|
| `apps/web/infra/api/triagem-http-gateway.ts` | `modules/triagem/src/application/{dtos.ts,events.ts}` |
| `apps/web/infra/api/matching-http-gateway.ts` | `modules/matching/src/application/{dtos.ts,events.ts}` |

Mais `apps/web/application/ports.ts` (interfaces que o front declara esperar do
backend — inputs/outputs, ex. `MatchingApiGateway`, `CriterioResposta`) e, quando
deixar de estar inerte, `shared/contracts/**/*.proto` (+ `buf.yaml`/`buf.gen.yaml`).

Se `find shared/contracts -name '*.proto'` não retornar nada, ignorar essa parte
do escopo silenciosamente (P-70 ainda não ativado).

Ao encontrar um gateway novo em `apps/web/infra/api/*-http-gateway.ts` sem entrada
no mapa acima, inferir o módulo backend pelo nome (ex. `X-http-gateway.ts` →
`modules/X`) e incluí-lo na auditoria desta rodada.

## Passo 1 — Coletar o diff

Rodar `git status --short` e `git diff` (ou `git diff <base>...HEAD` se uma base
foi passada como argumento) restrito aos caminhos do escopo acima. Se nenhum
arquivo do escopo mudou, ir direto para "nenhuma mudança detectada" (Passo 4).

## Passo 2 — Classificar cada mudança

Para cada arquivo do escopo com diff, ler o trecho e classificar:

- ⚠️ **Breaking** — campo removido ou renomeado num DTO/tipo exportado; tipo de
  um campo mudou; URL ou verbo HTTP do `fetch` mudou; campo que era opcional
  virou obrigatório sem default; método de uma interface de port removido ou
  com assinatura mudada; evento removendo campo do payload.
- 🆕 **Aditivo** — campo novo opcional num DTO; método novo na interface de port;
  endpoint novo (`fetch` novo apontando pra rota nova); evento novo.
- **Sem mudança de forma** — refactor interno (rename de variável local, extração
  de função, comentário) que não altera o shape observável do contrato. Não
  reportar.

## Passo 3 — Montar o rascunho (se houver breaking ou aditivo)

Redigir um rascunho pronto para virar issue Paperclip (prefixo `RAD`, mencionar
Flávia — dona do front) com:

- **Título**: `Contrato mudou: <arquivo/endpoint> — <breaking|aditivo>`.
- **O que mudou**: resumo do diff (campo/método/URL antes → depois).
- **Impacto no front**: o que precisa reagir (regenerar stub, ajustar
  `*-http-gateway.ts`, tratar campo novo, etc.) — se for breaking, deixe claro que
  quebra em runtime sem o ajuste.
- **Referência**: caminho:linha do diff que motivou o aviso.

**Apresentar o rascunho ao usuário e perguntar se deve virar issue** — esta skill
nunca chama a API/CLI do Paperclip por conta própria (abrir issue é ação visível
a terceiros, exige confirmação explícita a cada vez).

## Passo 4 — Reportar

Se não houve nada breaking/aditivo no escopo: "Nenhuma mudança de contrato
detectada." Caso contrário, listar os rascunhos do Passo 3 em ordem (breaking
primeiro).

## Regras

- **Nunca** modifica código — apenas lê e relata.
- **Nunca** abre issue, comenta ou chama qualquer API/CLI do Paperclip sozinha —
  só rascunha e pergunta.
- **Não inventa** mudança — se o diff não alterar shape observável (só refactor
  interno), não reportar como breaking/aditivo.
- Se `shared/contracts` seguir inerte (sem `.proto`), não tratar isso como lacuna
  — é o estado esperado até P-70 ser ativado.
