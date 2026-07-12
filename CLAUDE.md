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

## Stack (decidida — ver [docs/98](docs/98-decisoes-e-pendencias.md) P-27)

Resumo de 1 linha: TypeScript único + Postgres + fila gerenciada + object storage S3 + Claude, monólito modular por bounded context, eventos internos/gRPC só cross-domain síncrono. Detalhe completo (incl. *seam* Go/Python) e pendências finas (provedor P-64, região P-28, LLM direto-vs-nuvem P-66, custo P-20) estão em P-27 — não duplicar aqui.

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

O Claude Code já expõe automaticamente nome + descrição de cada skill/agente disponível — não duplicado aqui. Só o essencial que não está em nenhum `SKILL.md`/`agents/*.md` individual, o **loop entre eles**:

- **Documentos:** planejar antes de editar (`planejar-doc`, porta da frente) → editar → revisar depois (`auditar-docs`, `revisar-ddd`, porta dos fundos). As duas de revisão só reportam, nunca modificam.
- **Código:** `guardiao-arquitetura` (camadas/DDD), `guardiao-seguranca` (docs/05, segurança/LGPD) e `guardiao-observabilidade` (docs/08 §4.1 SLOs + arquitetura/04 §8 — log estruturado/correlação ponta-a-ponta, métrica por SLO, breaker+alarme em borda externa; **gated na RAD-300**: ⚠️ débito enquanto a convenção não fecha, ❌ depois) são agentes-irmãos que revisam o **mesmo diff** por ângulos diferentes — cruze os que se aplicam ao mexer em fronteira, dado de cliente, autenticação ou log/telemetria/caminho de SLO. Para o diff de **infra** (`infra/**` Terraform/IaC — outro artefato, não código de app), o guardião é o `guardiao-iac` (portabilidade A08 §4/§6, paridade swap-safe do rewrite RAD-181, guardrail PRESERVAR P-41, segurança de infra); ele **não** reimplementa lint genérico (tfsec/checkov). `criar-modulo` é a única skill que **escreve** arquivos (scaffolding).
- **Cruzando código e docs:** `avisar-contrato-front` e `pesquisar-fonte` completam o conjunto — ambas só relatam/rascunham, nunca agem sozinhas (nunca abrem issue, nunca editam doc).

## Como trabalhar aqui

- **Inferir vs. verificar (economia de contexto).** Não busque/leia o que já responde com confiança — input evitado é o corte de contexto mais barato (nem paga cache). Exceção dura: **citação legal, contrato do PNCP, classe de dado crítico (docs/05 §9) e derivação de `tenantId`** — aí **sempre verifique na fonte**, nunca confie no que o modelo "acha que sabe". Reversível/barato → infira primeiro; exato/irreversível → verifique sempre. Quanto mais fraco o modelo, mais para o lado de verificar (a própria confiança não é sinal confiável).
- Faça mudanças cirúrgicas e fiéis ao estilo dos documentos existentes; preserve numeração, tabelas e o padrão de cross-reference.
- Após editar a documentação, considere rodar a skill `auditar-docs` para checar que nada quebrou.
- Após alterar código de um módulo (`domain/application/infra`), deixe o `guardiao-arquitetura` validar o diff (camadas, isolamento entre contextos, convenções) **antes de finalizar/PR** — **Claude:** o subagente (`.claude/agents/guardiao-arquitetura.md`, auto-delegável); **Codex** (não invoca subagentes): a **skill** homônima (`.claude/skills/guardiao-arquitetura/`), que valida o próprio diff. Corrija as ❌ violações; ao tocar numa fronteira/agregado, cruze também com `revisar-ddd`. Ao tocar dado pessoal, dado de cliente, prompt de LLM, autenticação/tenant ou segredo, rode também o par irmão `guardiao-seguranca` (mesma dupla subagente/skill). Ao emitir/alterar log, cruzar borda de contexto (API→fila→worker), chamar fonte externa/LLM ou tocar um caminho de SLO (docs/08 §4.1), rode também `guardiao-observabilidade` (mesma dupla; hoje sobretudo anti-regressão da redação de `logging.ts` + sinaliza débito até a RAD-300 firmar a convenção — schema do log, campo de correlação, nomes de métrica).
- Após alterar IaC (`infra/**` Terraform), deixe o `guardiao-iac` validar o diff **antes de finalizar/PR** — mesma dupla (subagente `.claude/agents/guardiao-iac.md` auto-delegável p/ Claude; skill homônima p/ Codex). Valida portabilidade (A08 §4/§6), paridade swap-safe do rewrite (RAD-181, `plan` = no changes antes do swap) e o guardrail PRESERVAR (P-41 bulkheads/timeouts, KMS, sub-rede privada, DLQ). Corrija as ❌; lint genérico fica com tfsec/checkov (A08 §6, CI).
- **Contrato é fronteira back↔front — mudou contrato, avise o front.** Qualquer alteração em `shared/contracts` (proto/gRPC) ou num contrato de API/evento que o front consome **notifica o front (Flávia)** — abra issue/comentário descrevendo a mudança (o cliente/stub gerado dela muda). **Nunca altere contrato silenciosamente**; mudança breaking exige o aviso antes do merge.
- **Economia de token — resposta mínima ao operador.** Sua *comunicação* (mensagens entre passos, resumos, confirmações) é só o necessário: sem preâmbulo, sem narrar ação rotineira ('Agora vou…', 'Deixa eu ver…'), sem recapitular o que já apareceu no histórico. Silêncio por padrão entre tool calls; escreva só ao **achar algo, mudar de direção ou travar** (1 frase); ao terminar, **1–2 frases** de resultado. Isso vale para a **fala**, **não** para os **deliverables** — docs e código continuam tão completos quanto a tarefa exige. Corte token de conversa, não de substância.
- Não commite nem faça push sem o usuário pedir.
