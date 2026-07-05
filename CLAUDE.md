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

## Estágio atual: Concepção — documentação-only

**Ainda não há código de aplicação.** O repositório é documentação de concepção. Não há build, testes nem comandos de execução. Não invente stack, endpoints ou comandos: o que existe são documentos, e decisões técnicas ainda são propostas a validar.

## Idioma

**Todo o conteúdo é em português (pt-BR)** — documentos, commits, comentários e respostas. Mantenha o tom técnico e sóbrio dos documentos existentes.

## Estrutura

- **`docs/`** — produto, negócio e jurídico. Índice em [docs/00-README.md](docs/00-README.md). Cobre visão/escopo (01), marco legal (02), fluxos (03–04), segurança/privacidade (05), glossário/fontes (06), MVP/roadmap (07), métricas (08), mercado/negócio (09), módulos IA e matching (10–11), modelo de dados e NFRs (12), DDD e bounded contexts (13).
- **`arquitetura/`** — deliverable do arquiteto: realiza o recorte de MVP de `docs/07`. Índice em [arquitetura/00-README.md](arquitetura/00-README.md). Escopo restrito ao core do MVP (esteira PNCP → matching → alerta → triagem).
- **`docs/98-decisoes-e-pendencias.md`** — registro central das pendências.

## Convenções (siga ao editar)

- **`[A VALIDAR]`** marca uma decisão pendente (produto, jurídico ou arquitetura). Toda pendência tem uma entrada `P-NN` com dono e gate no [docs/98](docs/98-decisoes-e-pendencias.md). Ao citar um `P-NN`, garanta que ele existe lá; ao criar uma pendência nova, registre-a lá.
- **Citações legais são exatas.** Lei 14.133/2021, LGPD (Lei 13.709/2018), LAI (Lei 12.527/2011), PNCP (art. 174). Fontes citadas nos textos precisam ter entrada em [docs/06](docs/06-glossario-e-fontes.md).
- **Segurança e conformidade são transversais, não um módulo.** Nenhum fluxo que toque dados de terceiros ou fontes públicas avança sem responder: *qual a base legal e qual o controle de segurança?* Todo fluxo (docs/03) tem controle (docs/05) e base legal (docs/02).
- **Linguagem ubíqua e cross-references.** Use os termos do glossário (docs/06). Links entre documentos são relativos (inclusive cross-folder `../docs/…` ↔ `../arquitetura/…`) — não os quebre. Ao adicionar/renomear um documento, atualize o índice do README correspondente.

## Stack proposta (tudo `[A VALIDAR]`)

Descrita em `arquitetura/`, ainda **não implementada**: TypeScript como linguagem única, PostgreSQL (full-text para o matching no MVP; RLS para multi-tenant no *Next*), fila gerenciada de eventos (SQS/RabbitMQ/Redis Streams), Anthropic Claude na triagem. Organização: **Clean Architecture por bounded context** (camadas domain/application/infra, ports & adapters) num **monorepo**; comunicação por **eventos** dentro do monólito, **gRPC** só para chamada síncrona cross-domain. `tenantId` em toda entidade desde o dia 1, mesmo single-tenant no MVP.

## Skills disponíveis

Há um loop de trabalho: **planejar antes de editar, revisar depois de editar.**

- **`planejar-doc`** (porta da frente) — produz um plano assertivo **antes** de editar (mapeia os docs pertinentes, trata docs/13 como autoridade estratégica e o doc 98 como registro de decisões, entrega passos concretos `doc:§` e aponta o `P-NN` a atualizar). Use ao criar/alterar um doc, propor mudança de modelo/fluxo/decisão ou resolver um `[A VALIDAR]`. **Não edita nem revisa** — apenas planeja.

As duas abaixo são a porta dos fundos e **apenas reportam — nunca modificam**:

- **`auditar-docs`** — audita a consistência interna da documentação (links/âncoras quebrados, citações legais divergentes, termos fora do glossário, fontes sem entrada em 06, `P-NN` citados mas ausentes do 98, índices desatualizados, itens `[A VALIDAR]` em aberto). Use para auditar, checar divergências ou validar cross-references.
- **`revisar-ddd`** — revisa a integridade do modelo estratégico de DDD (bounded contexts e agregados entre docs/13 ↔ docs/12 ↔ arquitetura/03, vazamento de linguagem ubíqua, direção do context map, padrões de integração, invariantes que cruzam documentos). Use para revisar o design de domínio.

## Como trabalhar aqui

- Faça mudanças cirúrgicas e fiéis ao estilo dos documentos existentes; preserve numeração, tabelas e o padrão de cross-reference.
- Após editar a documentação, considere rodar a skill `auditar-docs` para checar que nada quebrou.
- Não commite nem faça push sem o usuário pedir.
