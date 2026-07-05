---
name: revisar-ddd
description: >-
  Revisa a INTEGRIDADE DO MODELO estratégico de DDD do Radar de Licitações entre os
  documentos: bounded contexts e agregados raiz (docs/13 ↔ docs/12 ↔ arquitetura/03),
  linguagem ubíqua vazando entre contextos, direção do context map (dependências para
  dentro do core Triagem), padrões de integração (ACL no PNCP, Published Language via
  eventos, Shared Kernel só do tenantId, Open Host da Governança) e invariantes de
  modelo que cruzam docs (escopo tenantId/clienteFinalId, catálogo global vs. dado de
  cliente, extração cacheável ≠ aderência por perfil, modalidade FK, fase dirigida por
  dados). Use quando pedirem para revisar o design de domínio, checar fronteiras de
  contexto, linguagem ubíqua, o context map ou a coerência do modelo entre docs.
  NÃO cobre mecânica de documentação (links, glossário, citações legais, índices,
  P-NN, [A VALIDAR]) — isso é da skill `auditar-docs`, sua irmã. Apenas reporta.
allowed-tools: Read, Grep, Bash(grep:*), Bash(find:*), Bash(cat:*), Bash(ls:*), Agent, Task
---

# Revisar integridade do modelo DDD

Guardar a **coerência do design estratégico de DDD** do Radar de Licitações enquanto os
documentos evoluem. O projeto está em **Concepção**: só documentação (`docs/` +
`arquitetura/`), **sem código de aplicação e sem git**. Não há `import`, entidade,
migration ou proto para fiscalizar — a revisão é **doc-vs-doc de MODELO**: fronteiras
de contexto, linguagem ubíqua, direção do context map, padrões de integração e as
invariantes que atravessam mais de um documento.

## Fronteira com a skill `auditar-docs` (não duplicar)

- **`auditar-docs` = mecânica**: links/âncoras quebrados, citações legais divergentes,
  termo fora do glossário, fonte sem entrada em 06, índice defasado, `P-NN` inexistente,
  inventário de `[A VALIDAR]`.
- **`revisar-ddd` (esta) = semântica do modelo**: agregado raiz declarado em 13 mas
  ausente em 12; dependência de contexto na direção errada; evento consumido de forma
  síncrona onde o contrato é Published Language; `tenantId` faltando numa entidade de
  cliente; unificação indevida de dois sentidos de "Aderência".

Achado de mecânica encontrado de passagem: **aponte que é da `auditar-docs`** e siga —
não trate como violação de modelo.

## Fonte da verdade do design estratégico

| Doc | O que fixa |
|-----|-----------|
| `docs/13-dominios-e-bounded-contexts.md` | **Canônico.** Subdomínios (§2), os 8 bounded contexts + linguagem ubíqua + agregado raiz (§3), context map (§4), decisões de integração (§5) |
| `docs/12-modelo-de-dados-e-requisitos-nao-funcionais.md` | ERD conceitual e escopo `tenantId`/`clienteFinalId` (§§1–2) |
| `arquitetura/03-desenho-da-solucao.md` | Contratos de evento (§3), modelo físico (§4), cache extração×triagem (§6) |
| `arquitetura/01-visao-arquitetural.md` | Estilo monólito modular (§2), C4 contexto/contêineres (§§3–4), Shared Kernel `tenantId` (§6) |
| `docs/98-decisoes-e-pendencias.md` | Pendências de modelo: **P-43** (fronteiras/linguagem), P-45–P-50, P-10 |

Quando 13 divergir de 12/03/01, **13 é a autoridade estratégica** — a menos que a
divergência já seja decisão registrada no doc 98 (P-NN com status Resolvido/Aplicado).

**Foco adicional** (se passado como argumento, ex.: `13`, `triagem`, `eventos`, `tenant`,
`context-map`): restringir buscas e comparação ao contexto/tema.

## Invariantes a defender

### 1. Os 8 bounded contexts e agregados raiz (docs/13 §3)

Ingestão&Catálogo→**Edital** · Monitoramento&Matching→**CritérioDeMonitoramento/Alerta**
· Análise&Triagem→**Triagem** (único **core**) · Gestão→**Caso** (Next) · Inteligência→
*read models/CQRS* (Later) · Governança→**RegistroDeProveniência/SolicitaçãoDeTitular** ·
Identidade→**Tenant/PerfilDeHabilitação** · Notificação→**Notificação**.

- Todo agregado raiz de 13 §3 tem entidade no ERD de 12 §1 (ou é explicitamente CQRS)?
- Nenhuma entidade nova em 12/03 vira **novo agregado raiz** sem entrar em 13 §3?
- A classificação core/supporting/generic é coerente com "onde ganhamos" (docs/09 §4)?

### 2. Linguagem ubíqua — não vaza entre contextos (docs/13 §3)

- **Mesmo termo, modelos distintos é fronteira legítima** — não é erro. Caso canônico:
  **Aderência** = "relevância ao critério" no Matching (barato, estrutural) vs. "aptidão
  da empresa" na Triagem (caro, por IA) — docs/13:39. Doc que **unifica** os dois = violação.
- **Mesmo conceito, nomes divergentes entre docs é cheiro.** Ex.: `CritérioDeMonitoramento`
  (13) / `CRITERIO_MONITORAMENTO` (12) / "Radar/Critério" (linguagem) — confirme que é só
  variação de convenção (PascalCase vs SNAKE_CASE), não conceitual.
- Termo da linguagem de um contexto usado como responsabilidade de **outro** (ex.: "Requisito
  de Habilitação", da Triagem, aparecendo na Ingestão) = vazamento.

### 3. Direção do context map — para dentro do core (docs/13 §4)

```
PNCP ─ACL▶ Ingestão ─edital.ingerido(PL)▶ Matching, Triagem, Inteligência
Matching ─alerta.gerado▶ Notificação   Triagem ─usa PerfilHab▶ Identidade
Gestão ─faseAtual▶ Ingestão            Inteligência ─Resultado+Caso▶ Gestão
Identidade ··tenantId(SharedKernel)··▶ Matching, Triagem
Ingestão, Triagem, Matching ··proveniência/auditoria··▶ Governança (Open Host)
```

- Fluxo em qualquer doc **inverte** uma aresta (ex.: Ingestão "decidindo relevância", que é
  do Matching; ou Triagem chamando o Matching)? Cruze com "Não faz" de arquitetura/03 §2.
- Contexto do **Now** dependendo de contexto **Next/Later** (Gestão, Inteligência) quebra a
  fase do roadmap (docs/07) = violação.

### 4. Padrões de integração (docs/13 §5)

- **ACL no PNCP**: modelo externo (`numeroControlePNCP`, códigos de modalidade, JSON bruto)
  **nunca vaza** — só a Ingestão traduz para o canônico. Matching/Triagem consumindo campo
  cru do PNCP = violação.
- **Eventos = Published Language**: comunicação cross-context é evento assíncrono (fila), não
  chamada síncrona. Contratos em arquitetura/03 §3. Acoplamento novo = evento novo com payload
  mínimo, não chamada direta.
- **Shared Kernel mínimo**: o **único** modelo compartilhado é `tenantId`. "Compartilhar
  entidade X entre contextos" além disso = cheiro forte.
- **Governança = Open Host**: contextos **publicam** proveniência/auditoria para a Governança;
  conformidade não é reimplementada por contexto.

### 5. Invariantes de modelo que cruzam docs

- **Catálogo global vs. dado de cliente** (12 §2, 03 §4): `EDITAL`, `EXTRACAO_EDITAL`,
  `RESULTADO`, `MODALIDADE`, `ORGAO` são globais — **sem `tenantId`** (viabiliza cache).
  `CRITERIO_MONITORAMENTO`, `ALERTA`, `TRIAGEM`, `CASO`, `PERFIL_HABILITACAO` levam
  `tenantId`/`clienteFinalId`. Pôr tenantId no catálogo (ou tirar de dado de cliente) = violação.
- **`tenantId` em toda entidade e todo evento**, mesmo single-tenant (01 §6, 03 §3). Evento
  novo sem `tenantId` = violação.
- **Extração ≠ Aderência** (P-45; 12 §2, 03 §6): `EXTRACAO_EDITAL` = 1 por edital, cacheável;
  `TRIAGEM` = 1 por edital × perfil (`(editalId, perfilId)` único). Unir quebra cache ou correção.
- **Modalidade como FK** à tabela de domínio (P-46), não string denormalizada.
- **Fase dirigida por dados** (P-10): `faseAtual` vem dos dados do edital, nunca de ordem fixa.

## Passo 1 — Coletar estado real (buscas em paralelo)

Dispare **simultaneamente** (todas de leitura, cobrindo as duas pastas):

1. `find docs arquitetura -name "*.md" | sort` — inventário.
2. `grep -rEn 'Edital|Triagem|Alerta|Crit[eé]rio|Caso|Proveni|Perfil|Tenant|Extrac|Resultado|Modalidade' docs/ arquitetura/` — onde os agregados/entidades aparecem.
3. `grep -rEn 'edital\.ingerido|alerta\.gerado|triagem\.(solicitada|concluida)|feedback' docs/ arquitetura/` — contratos de evento (Published Language).
4. `grep -rEni 'tenantId|clienteFinalId|shared kernel|cat[aá]logo (global|p[uú]blico)' docs/ arquitetura/` — escopo de tenant e catálogo global.
5. `grep -rEni 'ACL|anti-corruption|published language|open host|cliente-fornecedor' docs/ arquitetura/` — padrões de integração.
6. `grep -rEni 'bounded context|context map|agregad|ubíqua|ubiqua' docs/ arquitetura/` — declarações de fronteira.
7. `grep -rEn 'P-(4[3-9]|50|10|45|46)' docs/ arquitetura/` — pendências de modelo vs. registro do doc 98.

Restrinja os `grep` ao doc/tema se houver **foco**.

**Em paralelo**, para revisão ampla, delegar a leitura estruturada a um subagente `Explore`:

> "Leia `docs/13`, `docs/12`, `arquitetura/03` e `arquitetura/01` do Radar de Licitações e
> retorne, sem análise: (1) por bounded context — agregado raiz e termos da linguagem ubíqua;
> (2) as arestas de dependência entre contextos descritas (quem depende/consome de quem, e por
> qual padrão: ACL/evento/shared kernel); (3) cada evento citado com seu payload; (4) toda
> afirmação sobre `tenantId`/`clienteFinalId` e sobre catálogo global vs. dado de cliente.
> Liste com `doc:linha`. Seja conciso."

Aguarde todos os resultados antes de comparar.

## Passo 2 — Comparar e classificar

Cruzando 13 ↔ 12 ↔ 03 ↔ 01, rode as invariantes 1–5. Antes de marcar violação, cheque se a
divergência já é **decisão registrada** no doc 98 (P-NN Resolvido/Aplicado) — se for, é
consciente, não violação. Relacione cada achado ao `P-NN` quando existir (sobretudo **P-43**,
que é exatamente este escopo).

## Passo 3 — Montar o relatório

```markdown
# Revisão de integridade do modelo DDD

> Data: <data> | Foco: <foco ou "geral"> | Fonte da verdade: docs/13

## ❌ Violações de modelo
<lista: o que quebra + doc:linha (origem) vs. doc:linha (autoridade) + correção + P-NN>
Se zero: "Nenhuma encontrada."

## ⚠️ Cheiros
<padrão suspeito não bloqueante: nome divergente do mesmo conceito, agregado citado de passagem>
Se zero: "Nenhum."

## ↪️ Fora do escopo (é da `auditar-docs`)
<achados de mecânica vistos de passagem — apontar e delegar>

## 🕓 Pendências de modelo em aberto
<`[A VALIDAR]` que afeta fronteira/linguagem — conferir contra P-43 e correlatos no doc 98>

## ✓ Consistente (amostra)
<2–4 aderências notáveis do modelo, para dar contexto>

## Recomendações
<lista priorizada — indicar doc:seção>
```

## Regras

- **Não modificar** arquivos — apenas reportar.
- **Não inventar** — se não achou, escreva "não localizado" em vez de inferir.
- **Não duplicar a `auditar-docs`** — mecânica não é seu escopo; delegue.
- Priorize violações e cheiros de fronteira sobre confirmações positivas; relatório enxuto.
- Contexto: **sem código e sem git** — nada de comparar contra use cases, migrations ou commits.
