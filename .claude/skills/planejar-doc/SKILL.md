---
name: planejar-doc
description: >-
  Produz um plano assertivo ANTES de editar a documentação do Radar de Licitações.
  Mapeia os docs pertinentes (docs/ + arquitetura/), confronta as fontes tratando
  docs/13 como autoridade estratégica e o doc 98 como registro de decisões, e entrega
  um plano de edição concreto — com `doc:§`, cap de 4 passos, sem hedge — mais o
  ferramental de revisão a rodar depois (`/revisar-ddd`, `/auditar-docs`) e o `P-NN`
  a atualizar. É a PORTA DA FRENTE do loop; os dois revisores são a porta dos fundos.
  Use quando for criar/alterar um doc, propor uma mudança de modelo/fluxo/decisão, ou
  resolver um `[A VALIDAR]`. NÃO edita arquivos e NÃO revisa (isso é das irmãs) —
  apenas planeja.
allowed-tools: Read, Grep, Bash(grep:*), Bash(find:*), Bash(cat:*), Bash(ls:*), Agent, Task
---

# Planejar mudança de documentação

Produzir um **plano de edição fundamentado nas fontes canônicas**, antes de tocar
qualquer arquivo. O projeto está em **Concepção**: só documentação (`docs/` +
`arquitetura/`), **sem código e sem git**. Aqui a **verdade é o doc** — não há código
para consultar. O plano nasce das fontes certas e aponta o caminho, não implementa.

Mudança: `$ARGUMENTS`

## Princípio — a verdade é o doc, e tem hierarquia de autoridade

Quando as fontes divergem, o plano **segue a autoridade**, não a maioria:

1. **`docs/13`** (design estratégico: bounded contexts, linguagem ubíqua, context map,
   integração) — **autoridade canônica**. Fronteira/modelo se resolve por ela.
2. **`docs/12`** (modelo conceitual/ERD) + **`arquitetura/*`** (realização técnica) —
   realizam o que 13 fixa; divergência com 13 = alinhar a realização, não o contrário.
3. **`docs/98`** (Decisões e Pendências) — registro dos `[A VALIDAR]` como `P-NN`.
   Resolver um `[A VALIDAR]` **exige** atualizar o doc de origem **e** o status no 98
   (convenção do próprio 98) — isso vira passo do plano.
4. Fontes externas (Lei 14.133/2021, LGPD, PNCP) — a verdade legal está no `docs/06` e
   nas fontes oficiais; contrato do PNCP não confirmado fica `[A VALIDAR — Swagger]`.

## Regras

- **Sem prosa** ("vou agora…"). Output = as seções do Passo 4, nada mais.
- **Sem hedge** ("talvez", "considere"). Decisão concreta ou pergunta direta ao usuário.
- Cada passo do plano tem `doc:§` (ou `doc:linha`) ou marca `(NOVO)`.
- **Cap de 4 passos.** Se não couber em 4, pedir para dividir a mudança.
- Divergência **entre docs** → o plano segue a autoridade (13); o doc divergente vira
  passo *"alinhar doc X a 13 §Y"* + atualizar o `P-NN` correspondente no 98.
- Sempre listar o **ferramental depois** (revisão + registro) via a tabela do Passo 5.
- **Não editar** — sem Write/Edit. O plano é entregue; o usuário decide se segue.

## Fluxo

### 1. Mapear docs pertinentes (máx 4)

Usar o índice de `docs/00-README.md` e `arquitetura/00-README.md` para selecionar
**apenas** os docs pertinentes à mudança — considerando as **duas pastas** e os
cross-refs `../docs/…`. Listar sem ler ainda.

### 2. Mapear o estado atual com `Explore` (mapeamento, não análise)

Disparar **uma** chamada `Explore` (paralela se tocar docs das duas pastas):

> "Nos docs `<lista da etapa 1>` do Radar de Licitações, sintetize sem análise: (1) como
> o conceito/fluxo `<mudança>` é descrito hoje e em qual doc/§ ele é **definido**; (2)
> quais outros docs o **referenciam** (inclusive `../docs/…`); (3) convenções específicas
> observadas ali (não as gerais). Liste com `doc:§`. 5–10 linhas, conciso."

Não pedir julgamento — só o mapa. Aguardar o resultado.

### 3. Read parcial dos docs

Para cada doc da etapa 1, ler **só a seção relevante** — achar a `§` com `Grep` antes e
usar `limit`/`offset` se o doc passar de ~200 linhas. **Nunca** o doc inteiro.

### 4. Confrontar e planejar — output final, exatamente este formato

```markdown
## Fontes consultadas
- docs/XX §Y → ✓ confirma
- docs/XX §A vs docs/YY §B → ✗ divergem: <o que a autoridade (13/§) diz> vs <o que o outro afirma em doc:linha>

## Estado atual
<3–5 linhas: síntese do Explore + reads, sem prosa>

## Plano
1. <doc:§ ou (NOVO)> — <ação concreta em 1 linha>
2. ...
3. ...
4. ...

## Fora do escopo
- <coisa que parece relacionada mas não será tocada>

## Ferramental depois
### Revisão (rodar após editar)
- /<skill> — <por que, nesta mudança>
### Registro
- doc 98 → <P-NN a criar/atualizar, ou "nenhum">
```

### 5. Tabela de ferramental (consultar antes de preencher o Passo 4)

Incluir uma linha quando o critério bate; omitir o resto. Não há "ferramental *durante*":
a mudança é editar Markdown, não há build — o ferramental é sempre **de revisão (depois)**
ou **de registro**. Se nada de revisão bater, escrever `- (nenhuma)`.

| Ferramenta | Tipo | Listar se o plano toca… |
|---|---|---|
| `/revisar-ddd` | skill (revisão) | fronteira de contexto, linguagem ubíqua, context map, agregado raiz, padrão de integração (ACL/PL/Shared Kernel/Open Host), escopo tenant/catálogo |
| `/auditar-docs` | skill (revisão) | links/âncoras, glossário/termos, citações legais, índice do README, ou cita `P-NN` |
| doc 98 (`P-NN`) | registro | resolve ou cria um `[A VALIDAR]` (atualizar origem **e** status no 98) |

### 6. Sem implementação

Não chamar Edit/Write. O plano é o entregável — o usuário decide se segue.

## Quando NÃO usar (dizer que a skill é overkill e propor editar direto)

- Mudança trivial (uma frase, corrigir um número/data) — vai direto.
- Correção mecânica isolada (link quebrado, typo) — vai direto, ou é caso de `/auditar-docs`.
- Pergunta de leitura ("onde está X?") — responder direto, sem plano.
