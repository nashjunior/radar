---
name: pesquisar-fonte
description: >-
  Vai à fonte externa (Swagger oficial do PNCP, legislação — Lei 14.133/2021,
  LGPD 13.709/2018, LAI 12.527/2011, normas ANPD —, mercado/concorrência) para
  resolver uma pendência concreta do Radar de Licitações: um `[A VALIDAR]` em
  `arquitetura/02-ingestao-pncp.md`, um `P-NN` Aberto em `docs/98`
  (ex. contrato PNCP, cadência de polling, teto de custo, LLM direto-vs-nuvem),
  ou uma citação em `docs/02`/`docs/05`/`docs/06`/`docs/09`. Classifica a
  pergunta contra o doc/`P-NN` certo, checa o que já existe no repo antes de
  pesquisar fora (evita repesquisar o decidido), distingue fonte oficial de
  secundária (citação legal só conta com fonte primária confirmada) e aponta o
  `doc:§`/`P-NN` a atualizar. Para levantamento amplo multi-fonte, recomenda
  `/deep-research` em vez de duplicá-lo. Use quando pedirem para pesquisar,
  confirmar ou levantar algo externo ao repo que vá alimentar um doc. NÃO edita
  nenhum arquivo — apenas relata e recomenda; a edição é do `planejar-doc`.
allowed-tools: Read, Grep, Bash(grep:*), Bash(find:*), Bash(cat:*), WebSearch, WebFetch
---

# Pesquisar fonte externa

Ir à fonte externa para alimentar uma pendência **concreta** do Radar de
Licitações — não pesquisa genérica. Esta skill é a ponte entre o mundo de fora
(Swagger do PNCP, legislação, mercado) e o doc/`P-NN` certo; ela **não edita**
nada — entrega o achado pronto para o `planejar-doc` aplicar.

## Passo 1 — Classificar a pergunta

Casar a pergunta contra o mapa tópico → doc(s)/`P-NN`:

| Tópico | Doc(s) alvo | Nota |
|---|---|---|
| Contrato da API do PNCP (endpoints, parâmetros, códigos de modalidade, formato de data) | `arquitetura/02-ingestao-pncp.md` (marcadores `[A VALIDAR — Swagger]` / `[A VALIDAR — formato de data]`) | Fonte oficial: `docs/06` → `pncp.gov.br/api/consulta/swagger-ui` |
| Jurídico/regulatório (Lei 14.133/2021, LGPD 13.709/2018, LAI 12.527/2011, decretos, normas ANPD) | `docs/02-marco-legal.md`, `docs/05-seguranca-e-privacidade.md` | Fonte deve constar em `docs/06` (§ Fontes consultadas) |
| Mercado/negócio (concorrência, preço, tamanho de mercado) | `docs/09-mercado-e-negocio.md` | — |
| Decisão técnica/stack já registrada como `[A VALIDAR]`/Aberto em `docs/98` (ex. `P-66` LLM direto-vs-nuvem, `P-20` teto de custo de IA, `P-29` cadência de polling) | `docs/98-decisoes-e-pendencias.md`, o `P-NN` específico | Ler a linha do `P-NN` inteira antes de pesquisar — o "Aberto" às vezes já tem contexto parcial |

Se a pergunta não casar com nenhuma linha, dizer isso e perguntar ao usuário em
qual doc o achado deveria aterrissar antes de prosseguir — não pesquisar às
cegas sem destino.

## Passo 2 — Checar o que já existe no repo

Antes de sair pra fonte externa, `grep`/`Read`:

- `docs/98` — o `P-NN` (se houver) já tem pesquisa/decisão parcial registrada?
- `docs/06` §"Fontes consultadas" — a fonte já foi citada antes (link pronto)?
- O doc alvo — o `[A VALIDAR]` já tem alguma nota de tentativa anterior (ex.
  `arquitetura/02` já registra que `/proposta` retornou 422 com dois formatos)?

Isso evita repesquisar algo já respondido ou decidido — se já há decisão
registrada, reportar isso em vez de pesquisar de novo.

## Passo 3 — Pesquisar

- **Pergunta pontual** (confirmar 1 endpoint, 1 número de lei, 1 parâmetro) →
  usar `WebFetch`/`WebSearch` diretamente nesta skill.
- **Pergunta ampla** (comparação entre provedores, levantamento de mercado,
  múltiplas fontes cruzadas) → **não duplicar o fan-out** — recomendar ao
  usuário rodar `/deep-research` já com a pergunta refinada pela classificação
  do Passo 1 (citando o doc/`P-NN` de destino).

## Passo 4 — Exigir fonte primária/oficial

- Contrato do PNCP: só conta o Swagger oficial (`pncp.gov.br/api/consulta/swagger-ui`)
  ou teste direto contra a API — não um blog/tutorial de terceiro.
- Citação legal: só conta o texto oficial (planalto.gov.br, in.gov.br, site da
  ANPD) — resumo de terceiro (blog jurídico, notícia) é **fonte secundária**.
- Se só achou fonte secundária, reportar como **"não confirmado"** — nunca
  promover fonte secundária a citação definitiva de doc.

## Passo 5 — Reportar

Para cada achado:

- **O que foi confirmado** + link da fonte + classificação **oficial** ou
  **secundária (não confirmado)**.
- **`doc:§` a atualizar** e o **`P-NN`** correspondente — se já existe, citar o
  número; se a pendência está solta sem `P-NN` (como o formato de `dataFinal`
  em `arquitetura/02:169`), recomendar registrar um novo em `docs/98`.
- Recomendação explícita: **"rode `planejar-doc` citando este achado"** — esta
  skill não edita.

Se nada foi confirmado (só fonte secundária ou busca sem resultado): reportar
isso claramente, sem inferir um valor pra preencher a lacuna.

## Regras

- **Nunca** edita arquivo — apenas relata e recomenda.
- **Nunca** inventa ou infere citação legal/técnica sem fonte — sem fonte
  oficial, o relatório diz "não confirmado".
- **Nunca** decide um `P-NN` sozinha (dono, gate, resolução) — só recomenda
  registrar/atualizar; quem decide é `planejar-doc` + o dono do `P-NN`.
- Sempre distingue fonte primária/oficial de secundária no relatório — é o que
  diferencia esta skill de uma busca genérica.
- Pergunta ampla/multi-fonte → aponta para `/deep-research` em vez de refazer o
  fan-out aqui.
