---
name: auditar-docs
description: >-
  Audita a consistência interna da documentação do Radar de Licitações (docs/ e
  arquitetura/). Encontra divergências entre documentos: links e âncoras quebrados
  (incluindo cross-folder `../docs/…`), citações legais divergentes (Lei 14.133/2021,
  LGPD 13.709/2018, LAI 12.527/2011, PNCP), módulos/personas descritos de forma
  inconsistente, termos usados fora do glossário, fontes citadas sem entrada em 06,
  fluxos sem controle de segurança ou base legal, índice do README desatualizado,
  e pendências `P-NN` citadas mas ausentes do registro do doc 98. Também inventaria
  os itens `[A VALIDAR]` em aberto. Use quando pedirem para auditar, revisar
  consistência ou checar divergências na documentação (produto ou arquitetura),
  validar cross-references, ou levantar pendências. Apenas reporta — nunca modifica.
allowed-tools: Read, Grep, Bash(grep:*), Bash(find:*), Bash(cat:*), Bash(ls:*), Agent, Task
---

# Auditar consistência da documentação

Auditar divergências **dentro** da documentação de concepção do Radar de Licitações,
e entre a documentação e suas fontes legais. Este projeto é **documentação-only**
(estágio Concepção, sem código de aplicação, não é repositório git): a auditoria é
**doc-vs-doc** e **doc-vs-fonte-legal**, não doc-vs-código.

A documentação de **produto, negócio e legal** vive em `docs/`:

| Doc | Assunto |
|-----|---------|
| `00-README.md` | Índice + princípio transversal (todo fluxo tem controle e base legal) |
| `01-visao-e-escopo.md` | Problema, 4 personas, os **4 módulos**, "por que agora", riscos |
| `02-marco-legal.md` | Lei 14.133/2021, PNCP, LGPD, LAI; e a face LGPD do próprio usuário (§9) |
| `03-fluxos.md` | Fluxos de usuário e de sistema (ingestão, alerta, triagem, participação) |
| `04-fluxos-conforme-lei.md` | Fluxos mapeados às fases legais da licitação |
| `05-seguranca-e-privacidade.md` | Segurança e LGPD by design, controles por camada, classificação de dados (§9) |
| `06-glossario-e-fontes.md` | Termos do domínio + fontes legais/técnicas citadas |
| `07`–`12` | MVP/roadmap, métricas, mercado/negócio, Módulo 2 (IA), Módulo 1 (matching), dados+NFRs |
| `98-decisoes-e-pendencias.md` | Registro central dos `[A VALIDAR]` como `P-NN`, com dono e gate |

A **arquitetura técnica** do core do MVP vive em `arquitetura/` e referencia `docs/`
por caminho relativo (`../docs/…`):

| Doc de arquitetura | Assunto |
|--------------------|---------|
| `arquitetura/00-README.md` | Escopo, princípios, índice; ligação com `docs/` |
| `arquitetura/01-visao-arquitetural.md` | Drivers, C4 (contexto/contêineres), stack |
| `arquitetura/02-ingestao-pncp.md` | API de Consulta do PNCP, sincronização, pipeline |
| `arquitetura/03-desenho-da-solucao.md` | Fluxo e2e, eventos, modelo físico, NFRs |

**Foco adicional** (se passado como argumento, ex.: `glossario`, `02-marco-legal`,
`arquitetura`, `pncp`, `A VALIDAR`): restringir as buscas e a comparação ao doc/tema.

## Tipos de divergência a caçar

- **Inconsistente / stale** — algo afirmado num doc que é contradito por outro,
  aponta para um alvo inexistente, ou ficou defasado: link/âncora quebrado (inclusive
  cross-folder), número de lei divergente, módulo/persona/§ renumerado, item resolvido
  num doc mas ainda `[A VALIDAR]` em outro, metadado de versão/data fora de sincronia,
  `P-NN` citado que não existe no doc 98.
- **Lacuna** — algo referenciado/usado mas nunca definido: termo de domínio sem entrada
  no glossário (06), fonte legal citada sem link em "Fontes" (06), fluxo em 03 sem
  controle em 05 ou base legal em 02, doc ausente do índice do README (de `docs/` **ou**
  de `arquitetura/00`), NFR de arquitetura sem origem em docs/12, `[A VALIDAR]` sem dono.

## Passo 1 — Coletar estado real (buscas em paralelo)

Disparar **simultaneamente** (Bash, todas de leitura, cobrindo as duas pastas):

1. `find docs arquitetura -name "*.md" | sort` — inventário das duas pastas.
2. `grep -rEno '\]\((\.\./docs/)?[0-9]{2}-[a-z-]+\.md(#[a-z0-9-]+)?\)' docs/ arquitetura/` — links internos e cross-folder (arquivo + âncora).
3. `grep -rEn '^#{1,4} ' docs/ arquitetura/` — todos os cabeçalhos (validar âncoras e índices).
4. `grep -rn 'A VALIDAR' docs/ arquitetura/` — todos os marcadores `[A VALIDAR]`.
5. `grep -rEno '1[0-9]\.[0-9]{3}/20[0-9]{2}|Lei [0-9.]+|PNCP|LGPD|LAI|ANPD|PCA' docs/ arquitetura/` — citações legais/normativas e siglas.
6. `grep -rn 'Última atualização\|Estágio\|v0\.\|Concepção' docs/ arquitetura/` — metadados de versão/data/estágio.
7. `grep -rEon 'P-[0-9]+' docs/ arquitetura/` — IDs de pendência citados vs. registrados no doc 98.

Se um foco foi passado, restringir os `grep` ao doc ou tema (ex.: `... arquitetura/02-ingestao-pncp.md`).

**Em paralelo com as buscas**, delegar a leitura estruturada. O conjunto hoje tem ~18
docs; **ler diretamente** os relevantes com Read ainda costuma bastar. Se o foco for
amplo (auditar tudo), delegar a um subagente `Explore`:

> "Leia todos os arquivos em `docs/` e `arquitetura/` do Radar de Licitações e retorne,
> por documento, listas brutas (sem análise): (1) entidades nomeadas — módulos, personas,
> fluxos, controles, fases legais, contêineres/componentes de arquitetura; (2) termos de
> domínio usados; (3) leis/normas citadas com o número; (4) links para outros docs
> (inclusive `../docs/…`); (5) IDs `P-NN` citados; (6) trechos `[A VALIDAR]`. Seja conciso."

Aguardar todos os resultados antes de comparar.

## Passo 2 — Comparar e classificar

Com os dados acima, checar (priorizar o foco, se houver):

1. **Links e âncoras** — cada `](NN-….md#ancora)` e cada `](../docs/NN-….md)` aponta
   para arquivo existente (passo 1.1) e, se houver `#ancora`, para um cabeçalho real
   convertido em slug (passo 1.3)?
2. **Índices** — cada doc da tabela do README (`docs/00`) existe? Cada doc de
   arquitetura está listado em `arquitetura/00-README.md`? Algum arquivo em qualquer
   pasta **não** está no índice da sua pasta? (lacuna)
3. **Entidades entre docs** — os **4 módulos** (01 §4) e as **4 personas** (01 §3)
   aparecem com mesmos nomes/numeração em 03, 04, 05, 07, 09–11? As **fases legais**
   batem entre 02 e 04? Os NFRs de `arquitetura/` batem com docs/12, §3?
4. **Citações legais** — os números (14.133/2021, LGPD 13.709/2018, LAI 12.527/2011,
   Decreto 12.343/2024) são idênticos onde aparecem? Divergência = stale.
5. **Princípio transversal** (README) — cada fluxo de 03 tem controle em 05 **e** base
   legal em 02? A ingestão de `arquitetura/02` respeita o checklist de 04, §6?
6. **Glossário e Fontes (06)** — termos de domínio usados sem entrada no glossário;
   fontes legais citadas sem link em "Fontes"; termos/fontes órfãos.
7. **Metadados** — versão/estágio/"Última atualização" consistentes entre docs.
8. **`[A VALIDAR]`** — montar o inventário; sinalizar itens decididos num doc mas ainda
   abertos em outro, ou pendências sem dono/gate.
9. **Cross-folder e pendências** — cada `P-NN` citado em `arquitetura/` (ou em qualquer
   doc) existe no registro do doc 98? Cada doc de arquitetura referencia `docs/` por
   caminho relativo válido?
10. **Contratos externos marcados** — afirmações sobre a **API do PNCP** (endpoints,
    parâmetros, códigos de modalidade) em `arquitetura/02` devem estar marcadas
    `[A VALIDAR — Swagger]` enquanto não confirmadas. Afirmação "dura" sobre contrato
    externo não verificado = risco a sinalizar (stale em potencial).

## Passo 3 — Montar o relatório

```markdown
# Auditoria de consistência da documentação

> Data: <data corrente> | Foco: <foco ou "geral"> | Pastas: docs/ + arquitetura/

## ⚠️ Inconsistente / stale (afirmado, contradito ou inexistente)

<lista: doc:linha → o que afirma vs. a realidade
 (link quebrado, número legal divergente, §/módulo renumerado,
  P-NN inexistente, contrato PNCP afirmado sem [A VALIDAR])>

Se zero itens: "Nenhum encontrado."

## 🆕 Lacuna (referenciado/usado mas não definido)

<lista: termo / fluxo / fonte / doc / NFR → onde deveria ser registrado
 (glossário 06, controle 05, base legal 02, índice 00, docs/12, doc 98)>

Se zero itens: "Nenhum encontrado."

## 🕓 [A VALIDAR] em aberto (inventário)

<lista: doc:linha → ponto pendente; conferir contra os P-NN do doc 98>

## ✓ Consistente (amostra)

<3–5 itens que batem entre docs, para dar contexto>

## Recomendações

<lista priorizada de atualizações — indicar arquivo:seção>
```

## Regras

- **Não modificar** nenhum arquivo — apenas reportar divergências.
- **Não inventar** — se não encontrou algo, escrever "não localizado" em vez de inferir.
- Se um doc não puder ser lido, reportar como "doc não lido" e continuar.
- Manter o relatório **≤ 60 linhas**; priorizar stale e lacunas sobre confirmações positivas.
- A auditoria cobre **duas pastas**: `docs/` e `arquitetura/`. Links de `arquitetura/`
  para `docs/` são relativos (`../docs/…`) e devem resolver; `P-NN` citados devem existir
  no registro do doc 98.
- Contexto: **sem código de aplicação e sem git** — nada de comparar contra use cases,
  migrations ou commits. As referências externas são a **fonte legal** (doc 06) e, para
  a arquitetura, o **Swagger do PNCP** (contratos não confirmados ficam `[A VALIDAR]`).
