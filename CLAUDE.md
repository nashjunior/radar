# CLAUDE.md — Radar de Licitações

Orientações para o Claude Code trabalhar neste repositório.

## O que é

**Radar de Licitações** — plataforma que monitora, analisa e apoia a participação de organizações em licitações públicas no Brasil. É a camada de inteligência entre as fontes públicas (PNCP e portais) e a decisão de "participar ou não".

Quatro módulos formam a esteira do sinal bruto à decisão:

1. **Monitoramento e alerta** — rastreia fontes, normaliza e notifica editais que casam com os critérios do usuário.
2. **Análise e triagem por IA** — lê o edital, extrai requisitos/prazos/valores e apoia o go/no-go.
3. **Gestão da participação** — prazos, checklist e status das fases da licitação.
4. **Inteligência de mercado** — histórico, preços de referência e estatística de disputa.

Módulos 1 e 2 são o núcleo do MVP; 3 e 4 são incrementos. Personas: empresa fornecedora (central), consultoria multi-cliente, órgão público, uso interno.

## Estágio atual: início da implementação

O repositório saiu da concepção pura: além de `docs/` e `arquitetura/`, já há **código de aplicação** num monorepo pnpm+turbo. A esteira está sendo construída por bounded context (docs/13); o primeiro módulo com código é **Ingestão** (`modules/ingestao`). Os documentos continuam sendo a **fonte de intenção** — o código os realiza, não os substitui; ao divergirem, docs/13 é a autoridade estratégica e o código é a verdade de implementação.

Comandos (na raiz, via `turbo`): `pnpm dev` · `pnpm build` · `pnpm typecheck` · `pnpm lint` · `pnpm test`.

## Idioma

**Todo o conteúdo é em português (pt-BR)** — documentos, commits, comentários e respostas. Mantenha o tom técnico e sóbrio dos documentos existentes.

## Estrutura

- **`docs/`** — produto, negócio e jurídico. Índice em [docs/00-README.md](docs/00-README.md). Cobre visão/escopo (01), marco legal (02), fluxos (03–04), segurança/privacidade (05), glossário/fontes (06), MVP/roadmap (07), métricas (08), mercado/negócio (09), módulos IA e matching (10–11), modelo de dados e NFRs (12), DDD e bounded contexts (13).
- **`arquitetura/`** — deliverable do arquiteto: realiza o recorte de MVP de `docs/07`. Índice em [arquitetura/00-README.md](arquitetura/00-README.md). Escopo restrito ao core do MVP (esteira PNCP → matching → alerta → triagem).
- **`docs/98-decisoes-e-pendencias.md`** — registro central das pendências.
- **`modules/`** — um pacote por bounded context (Clean Arch). Hoje: `ingestao`. Cada módulo tem `domain/ application/ infra/`.
- **`shared/kernel/ts`** (`@radar/kernel`) — kernel mínimo compartilhado: IDs branded, `DomainError`. **`shared/design-tokens`** — tokens de design do front.
- **`apps/web`** — front (Vite/React) em camadas domain/application/infra/ui.

## Convenções (siga ao editar)

- **`[A VALIDAR]`** marca uma decisão pendente (produto, jurídico ou arquitetura). Toda pendência tem uma entrada `P-NN` com dono e gate no [docs/98](docs/98-decisoes-e-pendencias.md). Ao citar um `P-NN`, garanta que ele existe lá; ao criar uma pendência nova, registre-a lá.
- **Citações legais são exatas.** Lei 14.133/2021, LGPD (Lei 13.709/2018), LAI (Lei 12.527/2011), PNCP (art. 174). Fontes citadas nos textos precisam ter entrada em [docs/06](docs/06-glossario-e-fontes.md).
- **Segurança e conformidade são transversais, não um módulo.** Nenhum fluxo que toque dados de terceiros ou fontes públicas avança sem responder: *qual a base legal e qual o controle de segurança?* Todo fluxo (docs/03) tem controle (docs/05) e base legal (docs/02).
- **Linguagem ubíqua e cross-references.** Use os termos do glossário (docs/06). Links entre documentos são relativos (inclusive cross-folder `../docs/…` ↔ `../arquitetura/…`) — não os quebre. Ao adicionar/renomear um documento, atualize o índice do README correspondente.

## Stack (decidida — P-27, docs/98)

**TypeScript** como linguagem única; **PostgreSQL** (full-text para o matching no MVP; RLS para multi-tenant no *Next*); **fila gerenciada** de eventos (retry + DLQ); **object storage** S3-compatível para anexos; **Anthropic Claude** na triagem. Organização: **Clean Architecture por bounded context** (camadas domain/application/infra, ports & adapters) num **monorepo pnpm+turbo**; comunicação por **eventos** dentro do monólito, **gRPC** só para chamada síncrona cross-domain. `tenantId` em toda entidade desde o dia 1, mesmo single-tenant no MVP. (Detalhe fino ainda aberto: provedor P-64, região P-28, LLM direto-vs-nuvem P-66, modelo/custo P-20.)

## Convenções de código (Clean Architecture por módulo)

Extraídas do `modules/ingestao` (referência viva). Um módulo = um bounded context, com camadas `domain/ application/ infra/` e barris `index.ts`.

- **Camadas & dependências (apontam para dentro):** `domain` (entities, VOs, errors) importa só `@radar/kernel` e o próprio domain; `application` (use cases, **ports**, dtos, events, mappers) importa domain + kernel; `infra` (adapters) implementa os ports da application. Ports vivem em **`application/ports.ts`**, não no domain. Um módulo nunca importa `infra/` de outro módulo.
- **Shared kernel `@radar/kernel`:** IDs são **branded types** (`EditalId`, `TenantId`, `ClienteFinalId`, `PerfilId`), construídos só na infra; `DomainError` abstrata com `code` estável. Não há `BaseEntity` nem `Result`.
- **Entities:** `private constructor` + factory estática **`criar(props)`**; imutáveis (`readonly`), mutação retorna nova instância (ex.: `Edital.atualizarFase`); ID via branded type; docstring cita o agregado em docs/13 §3.
- **Value Objects:** `private constructor(readonly valor)` + `criar()` que valida e **lança** `DomainError`; `equals()`/`toString()`; imutáveis.
- **Use cases:** `class {Verbo}{Entidade}UseCase`, método **`executar(input, signal: AbortSignal)`**; ports por DI no construtor; **orquestra, sem regra de negócio** (regra em entity/VO); retorna **DTO** e **lança `DomainError`** em falha esperada — throw-based, não `Result<>`.
- **Cross-context = ACL + eventos:** o modelo externo (PNCP) não vaza além do gateway/ports (docs/13 §5); entre contextos, evento de domínio (`EditalIngerido`) com payload mínimo (A03 §3).
- **Imports:** `@radar/kernel` para o kernel; relativos com extensão **`.js`** (ESM NodeNext); `import type` para tipos.

## Skills e agentes disponíveis

Nos **documentos**, há um loop de trabalho: **planejar antes de editar, revisar depois de editar.**

- **`planejar-doc`** (porta da frente) — produz um plano assertivo **antes** de editar (mapeia os docs pertinentes, trata docs/13 como autoridade estratégica e o doc 98 como registro de decisões, entrega passos concretos `doc:§` e aponta o `P-NN` a atualizar). Use ao criar/alterar um doc, propor mudança de modelo/fluxo/decisão ou resolver um `[A VALIDAR]`. **Não edita nem revisa** — apenas planeja.

As duas abaixo são a porta dos fundos e **apenas reportam — nunca modificam**:

- **`auditar-docs`** — audita a consistência interna da documentação (links/âncoras quebrados, citações legais divergentes, termos fora do glossário, fontes sem entrada em 06, `P-NN` citados mas ausentes do 98, índices desatualizados, itens `[A VALIDAR]` em aberto). Use para auditar, checar divergências ou validar cross-references.
- **`revisar-ddd`** — revisa a integridade do modelo estratégico de DDD (bounded contexts e agregados entre docs/13 ↔ docs/12 ↔ arquitetura/03, vazamento de linguagem ubíqua, direção do context map, padrões de integração, invariantes que cruzam documentos). Use para revisar o design de domínio.

No **código**, há um agente de revisão (só reporta):

- **`guardiao-arquitetura`** (agente) — valida a Clean Architecture do código: direção de dependências (para dentro), isolamento entre bounded contexts, entities/VOs imutáveis com factory `criar`, use cases `executar` throw-based (`DomainError`, não `Result`), ports em `application`, branded IDs do `@radar/kernel`, ACL do PNCP e eventos cross-context. Roda sobre o diff de trabalho. Complementa `revisar-ddd`: **código** vs. **modelo-nos-docs** — ao mexer numa fronteira/agregado, cruze os dois.

## Como trabalhar aqui

- Faça mudanças cirúrgicas e fiéis ao estilo dos documentos existentes; preserve numeração, tabelas e o padrão de cross-reference.
- Após editar a documentação, considere rodar a skill `auditar-docs` para checar que nada quebrou.
- Após alterar código de um módulo (`domain/application/infra`), deixe o `guardiao-arquitetura` validar o diff (camadas, isolamento entre contextos, convenções) **antes de finalizar/PR** — **Claude:** o subagente (`.claude/agents/guardiao-arquitetura.md`, auto-delegável); **Codex** (não invoca subagentes): a **skill** homônima (`.claude/skills/guardiao-arquitetura/`), que valida o próprio diff. Corrija as ❌ violações; ao tocar numa fronteira/agregado, cruze também com `revisar-ddd`.
- **Contrato é fronteira back↔front — mudou contrato, avise o front.** Qualquer alteração em `shared/contracts` (proto/gRPC) ou num contrato de API/evento que o front consome **notifica o front (Flávia)** — abra issue/comentário descrevendo a mudança (o cliente/stub gerado dela muda). **Nunca altere contrato silenciosamente**; mudança breaking exige o aviso antes do merge.
- **Economia de token — resposta mínima ao operador.** Sua *comunicação* (mensagens entre passos, resumos, confirmações) é só o necessário: sem preâmbulo, sem narrar ação rotineira ('Agora vou…', 'Deixa eu ver…'), sem recapitular o que já apareceu no histórico. Silêncio por padrão entre tool calls; escreva só ao **achar algo, mudar de direção ou travar** (1 frase); ao terminar, **1–2 frases** de resultado. Isso vale para a **fala**, **não** para os **deliverables** — docs e código continuam tão completos quanto a tarefa exige. Corte token de conversa, não de substância.
- Não commite nem faça push sem o usuário pedir.
