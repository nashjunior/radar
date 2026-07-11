---
name: criar-modulo
description: >-
  Gera a casca (scaffolding) de um bounded context novo do Radar de Licitações —
  pastas domain/application/infra, package.json, tsconfig.json, vitest.config.ts e
  barrels index.ts — replicando exatamente a estrutura de um módulo já existente
  (referência viva: `modules/ingestao`). Confere o contexto contra a tabela de
  `docs/13-dominios-e-bounded-contexts.md` §3 antes de gerar; se o contexto não
  constar lá, para e recomenda `planejar-doc`/`revisar-ddd` primeiro — esta skill
  NUNCA decide modelo de domínio (entities/VOs/use cases reais), só a casca
  estrutural com um único stub de entity vazio nomeado pelo agregado raiz. É a
  ÚNICA skill do projeto que escreve arquivos (as demais só reportam). Use quando
  pedirem para criar/iniciar um módulo novo, "montar o esqueleto" de um contexto,
  ou dar o primeiro passo de código de um bounded context ainda sem `modules/<x>`.
  Ao terminar, valide com `guardiao-arquitetura` antes de preencher regra de negócio.
allowed-tools: Read, Grep, Bash(grep:*), Bash(find:*), Bash(ls:*), Bash(cat:*), Write, Agent, Task
---

# Criar módulo (scaffolding de bounded context)

Gerar a **casca estrutural** de um bounded context novo do Radar de Licitações,
replicando fielmente a convenção viva dos módulos já implementados — sem nunca
decidir modelo de domínio (isso é do par `planejar-doc` → `revisar-ddd`).

**Argumento esperado:** nome ou slug do bounded context (ex.: `identidade`,
`Governança & Conformidade`, `gestao-participacao`). Se vier vazio, peça ao
usuário qual dos contextos ainda sem módulo (ver Passo 1) deve ser criado.

## Passo 1 — Resolver o contexto contra docs/13 §3

`docs/13-dominios-e-bounded-contexts.md` §3 é a tabela canônica dos 8 bounded
contexts (colunas: Contexto | Responsabilidade | Linguagem ubíqua | Agregado raiz |
Módulo · fase). Ler essa tabela (`grep`/`Read`) e casar o argumento contra a
coluna "Contexto" (aceite variação de acento/hífen/abreviação razoável).

- **Não encontrado na tabela** → **parar**. Responder que o contexto não está
  registrado em docs/13 §3 e recomendar rodar `planejar-doc` (e depois
  `revisar-ddd`) para primeiro decidir/registrar o bounded context — esta skill
  não inventa contexto novo.
- **Encontrado** → extrair `agregado raiz` e `módulo · fase` da linha. O slug do
  módulo (`modules/<slug>`) é o nome já usado nos módulos vivos quando o contexto
  corresponder (ex. "Análise & Triagem" → `triagem`, "Notificação" → `notificacao`);
  para um contexto sem módulo ainda, derive um slug curto e óbvio em pt-BR
  kebab-case a partir do nome do contexto e **confirme com o usuário** antes de
  criar (ex.: "Gestão da Participação" → `participacao` ou `gestao-participacao`?).

## Passo 2 — Checar colisão

`ls modules/` (ou `find modules -maxdepth 1 -type d`). Se `modules/<slug>` já
existir, **parar** — não sobrescrever módulo existente. Reportar o caminho já
ocupado e pedir outro slug se for o caso.

## Passo 3 — Ler a referência viva

Ler `modules/ingestao` (módulo mais completo: 4 use cases, VOs, adapters, testes
nas 3 camadas) como gabarito **estrutural**:

- `package.json` — nome `@radar/<slug>`, `exports` (`.` e `./infra`), scripts
  (`build`, `typecheck`, `dev`, `test`, `lint`), dependency `@radar/kernel`,
  devDependencies `typescript`/`vitest`.
- `tsconfig.json` — `extends: "../../tsconfig.base.json"`, `outDir`/`rootDir`.
- `vitest.config.ts`.
- Barrels: `src/index.ts`, `src/application/index.ts`, `src/infra/index.ts`.

Não copiar regra de negócio nenhuma — só a **forma** desses arquivos (chaves,
scripts, convenção de export), adaptando o nome do pacote.

## Passo 4 — Gerar a casca

Criar, sob `modules/<slug>/`:

- `package.json`, `tsconfig.json`, `vitest.config.ts` — no formato do Passo 3,
  com `"name": "@radar/<slug>"`.
- `src/index.ts` — barrel vazio, reexportando `./domain/index.js` (se houver) e
  `./application/index.js`.
- `src/domain/{entities,value-objects,errors}/` — **um único stub de entity**,
  nomeado pelo agregado raiz da linha de docs/13 §3 (ex. `Caso`, `Notificacao`):
  `private constructor` + `criar(props)` que só lança `// TODO` (sem props reais),
  com docstring citando `docs/13 §3 — <nome do contexto>` e um comentário
  `// TODO: modelo real via planejar-doc → revisar-ddd (ver docs/13 §3)`. Não
  inventar VOs nem props — a entity nasce deliberadamente vazia.
- `src/application/{ports.ts, dtos.ts, events.ts}` — cada um só com um comentário
  de cabeçalho (`// Ports/DTOs/eventos de <Contexto> — a definir via planejar-doc`).
  `src/application/use-cases/` — pasta vazia (sem arquivo, ou um `.gitkeep`).
  `src/application/index.ts` — barrel reexportando os três arquivos acima.
- `src/infra/adapters/` — pasta vazia. `src/infra/index.ts` — barrel vazio (ou
  comentário indicando que os adapters ainda não existem).
- `src/__tests__/{domain,application,infra}/` — pastas vazias (`.gitkeep`).

Regra dura: **nenhum arquivo gerado contém regra de negócio real** — só forma
(package/tsconfig/barrels) e um único stub de entity deliberadamente vazio.

## Passo 5 — Validar com `guardiao-arquitetura`

Delegar ao agente `guardiao-arquitetura` (Agent tool) a validação dos arquivos
recém-criados em `modules/<slug>` — confirma que a casca já nasce sem violação de
camada, isolamento de contexto ou convenção (branded IDs, ports em `application`,
etc.), mesmo estando praticamente vazia.

## Passo 6 — Reportar

Listar os arquivos criados (caminho relativo) e o próximo passo explícito:
"Modelo de domínio ainda não definido — rode `planejar-doc` citando
`docs/13 §3` (<nome do contexto>) para desenhar entity/VOs/use cases reais antes
de preencher `modules/<slug>`."

## Regras

- **Nunca** inventa modelo de domínio (props de entity, VOs, use cases, ports com
  métodos reais) — a casca nasce com um único stub de entity vazio.
- **Nunca** sobrescreve um módulo já existente.
- **Nunca** cria um bounded context que não está em `docs/13` §3 — primeiro
  `planejar-doc`/`revisar-ddd`.
- Sempre roda `guardiao-arquitetura` sobre o resultado antes de reportar concluído.
- Fiel à convenção viva (`modules/ingestao`), não a padrões genéricos de fora do
  projeto — este é throw-based, `criar()`/`executar()` em pt-BR, ports em
  `application/ports.ts`, branded IDs do `@radar/kernel` (ver CLAUDE.md, seção
  "Convenções de código").
