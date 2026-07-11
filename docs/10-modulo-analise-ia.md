# 10 · Módulo 2 — Análise e Triagem por IA

> Aprofundamento do módulo mais **diferenciador e mais arriscado** do produto (documento 01, §§4 e 8). O fluxo já está no documento 03 (§4); aqui define-se a barra de qualidade, como se avalia (eval), a política de confiança e human-in-the-loop, e os modos de falha. Segurança de prompt injection está no documento 05 (§4). Estágio: **Concepção**.

## 1. Por que este módulo decide o produto

O Módulo 1 encontra editais; qualquer concorrente faz isso (documento 09). É o Módulo 2 que converte "achei um edital" em "vale a pena participar, e aqui está o porquê". Esse salto é o fosso competitivo — e também o maior risco: uma extração errada gera uma decisão de negócio errada (documento 01, §8). Confiança é o produto. Sem barra de qualidade, este módulo é um passivo, não um ativo.

## 2. Escopo — o que a IA faz e o que não faz

**Faz:** extrai do edital e anexos o objeto, os requisitos de habilitação (jurídica, fiscal, técnica, econômica), prazos, valores, modalidade, penalidades e condições; cruza com o perfil/documentos da empresa; calcula **aderência**; sinaliza **riscos**; e apresenta um resumo go/no-go.

**Não faz:** não **decide** (a decisão go/no-go é sempre do usuário — documento 03, §4); não dá **parecer jurídico** (documento 01, §6); não preenche automaticamente campos numéricos críticos sem confiança suficiente (§4).

## 3. Pipeline de extração

```mermaid
flowchart TD
    A[Edital + anexos] --> B{Tem texto<br/>selecionável?}
    B -->|Não| OCR[OCR]
    B -->|Sim| P[Parsing e segmentação]
    OCR --> P
    P --> E[Extração estruturada por campo<br/>objeto, habilitação, prazos, valores]
    E --> S[Score de confiança por campo]
    S --> G{Confiança ≥ limiar?}
    G -->|Sim| ADER[Cruzar com perfil →<br/>aderência e riscos]
    G -->|Não| FLAG[Marcar 'verificar' ·<br/>não pré-preencher]
    ADER --> RES[Resumo go/no-go<br/>com CITAÇÃO da fonte]
    FLAG --> RES
    RES --> USER{{Usuário decide}}
```

## 4. Princípios de qualidade e confiança

1. **Sempre citar a fonte.** Todo campo extraído e toda afirmação do resumo linkam o trecho e a página do edital (já em documento 03, §4). O usuário confere em um clique. Sem citação, não se exibe como fato.
2. **Confiança calibrada.** Cada campo carrega um score. Abaixo do limiar, o campo é marcado "verificar" e **não** alimenta automaticamente a decisão — nunca se apresenta um palpite como certeza.
3. **Human-in-the-loop.** A decisão é do usuário; campos de baixa confiança exigem confirmação antes de contar para a aderência.
4. **Conteúdo do edital é não confiável.** Trata-se o texto como dado, não instrução — defesa contra prompt injection (documento 05, §4): separar instruções de dados, nunca executar conteúdo extraído.

### 4.1 Limiar de confiança — política e valor calibrado (P-19)

O princípio 2 acima só vira gate executável quando o **limiar** tem um valor. A **estrutura** da política já está fixada (arquitetura/17, §6): opera **por campo**, com o `is_critico` do esquema de rótulo (§5.2) definindo onde a régua é dura, e a **confiança agregada = o mínimo dos campos críticos** — um único crítico fraco derruba a extração inteira. Abaixo do limiar, o campo é marcado "verificar" e **não pré-preenche** nem alimenta a decisão; se um crítico ficar abaixo, a extração é **incompleta** e cai em leitura assistida (§6).

O **valor calibrado** é a decisão de P-19 (RAD-139, 2026-07-08):

| Parâmetro | Valor calibrado | Onde vive | Status |
|-----------|:--------------:|-----------|--------|
| Limiar da confiança agregada (gate de release dos campos críticos) | **0,70** | `LIMIAR_CONFIANCA_PADRAO` em `@radar/triagem` (fonte única; a composição-root injeta em `TriarEditalInput.limiarConfianca`) | Calibrado — P-19 fechado |

- **Resultado da calibração (A16 §2.4 · RAD-139).** Protocolo executado com gold set sintético de 30 editais (`scripts/calibrar-limiar-gold-set.ts`): recall@0,70 = **95,4%** ✓, recall@0,71 = 91,9% ✗ — 0,70 é o maior corte que mantém recall ≥ 95%. Zero alucinação numérica verificada @0,70 (todos os erros numéricos tinham confiança < 0,70). Sem corte separado por classe numérica necessário.
- **Recalibração com gold set real.** Quando P-18 (gold set rotulado, ≥ 50 editais reais) e P-84/P-85 (protocolo de rotulagem + framework de eval) estiverem resolvidos, rodar `pnpm --filter @radar/triagem calibrar:limiar [gold-set-rotulado.json]` para confirmar ou ajustar o número. A estrutura (parâmetro injetado) não muda — só o valor aqui e no código-fonte.

## 5. Barra de qualidade e avaliação (eval)

Sem medição, não há confiança. O módulo é avaliado contra um **gold set**: um conjunto de editais rotulados por especialista, cobrindo modalidades e formatos heterogêneos.

| Dimensão | Como se mede | Meta (hipótese) `[A VALIDAR]` |
|----------|--------------|-------------------------------|
| **Recall de campos críticos** (prazo, objeto, habilitação) | vs. rótulos do gold set | ≥ 95% — perder um prazo é inaceitável |
| **Precisão de extração** | vs. rótulos do gold set | ≥ 90% |
| **Alucinação em campos numéricos** (valores, prazos, datas) | auditoria dos campos numéricos | **zero** — regra dura (guardrail, documento 08, §4) |
| **Fidelidade do resumo** (faithfulness) | % de afirmações rastreáveis à fonte citada | ≥ 98% `[A VALIDAR]` |
| **Aceitação pelo usuário** | % de triagens aceitas sem refazer (documento 08, §3) | ≥ 70% `[A VALIDAR]` |

**Regressão.** O gold set roda a cada mudança de prompt, modelo ou pipeline — nenhuma mudança sobe sem passar. É o mesmo espírito do checklist de conformidade (documento 04, §6) aplicado à qualidade da IA.

### 5.1 Cobertura mínima

O gold set deve cobrir os eixos de variação que mais impactam a extração:

- **Modalidade** (Lei 14.133/2021): Pregão Eletrônico, Concorrência, Dispensa de Licitação e Inexigibilidade como eixo principal; Leilão, Concurso e Credenciamento como cobertura complementar.
- **Formato do documento**: PDF nativo (texto selecionável), PDF imagem pura (OCR obrigatório), PDF misto.
- **Complexidade**: simples (objeto único, item único), moderada (múltiplos itens), complexa (múltiplos lotes, requisitos técnicos especializados).
- **Casos-limite**: edital mal estruturado, prazos conflitantes entre seções, valor estimado sigiloso (§9 do documento 05), habilitação técnica de alta especificidade.

Distribuição mínima `[A VALIDAR — confirmar com especialista de domínio]`:

| Modalidade / Formato | PDF nativo | PDF imagem | PDF misto |
|---------------------|-----------|------------|-----------|
| Pregão Eletrônico | ≥ 10 | ≥ 5 | ≥ 3 |
| Concorrência | ≥ 5 | ≥ 2 | ≥ 2 |
| Dispensa de Licitação | ≥ 3 | — | — |
| Inexigibilidade | ≥ 3 | — | — |
| Demais modalidades | ≥ 2 | — | — |
| **Casos-limite** | ≥ 5 (transversal às linhas acima) | | |

**Total mínimo: ≥ 50 editais rotulados**, garantindo pelo menos 15 no caminho OCR para stressar o pipeline de pré-processamento. Os casos-limite são ortogonais à modalidade — um edital com prazos conflitantes pode ser Pregão ou Concorrência.

### 5.2 Esquema de rótulo

Cada edital no gold set carrega um rótulo estruturado. O campo `is_critico` define onde o **recall ≥ 95% é regra dura** (gate de release, documento 07, §6); campos não-críticos seguem a meta de precisão geral (≥ 90%).

| Campo | Tipo | `is_critico` | Notas |
|-------|------|:------------:|-------|
| `objeto` | `string` | sim | Descrição literal do edital |
| `modalidade_codigo` | `string` | sim | Código PNCP (FK para tabela de domínio, arquitetura/03, §4) |
| `valor_estimado` | `number \| null` | sim | `null` se sigiloso ou omitido |
| `data_abertura_propostas` | `ISO date` | sim | Prazo para envio de propostas |
| `data_sessao` | `ISO date \| null` | sim | Data da sessão pública |
| `prazo_vigencia_meses` | `number \| null` | não | Do contrato, se mencionado |
| `habilitacao.juridica` | `string[]` | sim | Lista de exigências |
| `habilitacao.fiscal` | `string[]` | sim | |
| `habilitacao.tecnica` | `string[]` | sim | |
| `habilitacao.economica` | `string[]` | não | |
| `penalidades` | `string[]` | não | Percentuais ou condições |
| `fontes` | `Record<campo, {pagina, secao}>` | — | Origem de cada campo no PDF |

### 5.3 Protocolo de avaliação

1. **Extração sem dica** — o pipeline recebe o PDF bruto; nenhum metadado de rótulo é fornecido.
2. **Comparação por campo** — cada campo extraído é classificado como `correto`, `parcial` (capturado, mas com imprecisão aceitável) ou `ausente/errado`.
3. **Cálculo das métricas** (via as definições da tabela acima):
   - *Recall crítico* = corretos(campos\_criticos) / rotulados(campos\_criticos)
   - *Precisão geral* = (corretos + parciais) / total\_extraídos
   - *Alucinação numérica* = qualquer campo numérico com valor inventado → falha imediata
   - *Faithfulness* = afirmações\_com\_citação\_verificável / total\_afirmações\_do\_resumo
4. **Reprovação automática** se qualquer regra dura falhar: recall crítico < 95%, alucinação numérica > 0, ou faithfulness < 98%.
5. **Relatório por categoria** — resultados quebrados por modalidade × formato para identificar onde o pipeline degrada (§6).

### 5.4 Protocolo de rotulagem do gold set (P-84)

#### Quem rotula

- **Anotador primário:** especialista de produto (Produto) com conhecimento do domínio de licitações — interpreta o edital e preenche o esquema de rótulo (§5.2).
- **Anotador de revisão:** engenheiro de IA (Eng/Iara) — revisa a anotação quanto a consistência com o esquema e cobertura dos campos críticos.
- **Árbitro:** tech lead (Artur) — resolve qualquer discordância que persista após a revisão.

A separação de papéis evita viés de confirmação: o primário não sabe o que o modelo extraiu; a revisão valida o protocolo, não a saída da IA.

#### Critério de desempate entre anotadores

1. Comparar as anotações campo a campo antes de consultar o edital novamente.
2. Discordâncias em campos **não-críticos**: o anotador primário prevalece, com nota de justificativa.
3. Discordâncias em campos **críticos** (`is_critico: true`): obrigatório consultar o texto-fonte; prevalece a anotação ancorada no trecho exato (`citacao` preenchida). Se ambas tiverem citação, o árbitro decide.
4. Qualquer campo onde nenhum anotador consegue ancorar uma citação verificável é marcado `indeterminado` e excluído do cálculo de recall para aquele edital.

#### Cadência de atualização

| Momento | Ação |
|---|---|
| **Pré-lançamento** | Rotular os ≥ 50 editais iniciais (cobertura obrigatória de §5.1) antes do Gate 4 (CI). |
| **A cada sprint que alterar prompt ou modelo** | Re-verificar editais do eixo afetado; acrescentar ao menos 3 editais novos se recall degradar. |
| **Trimestral** | Revisar rótulos de editais cujo formato foi atualizado pelo órgão publicador; descartar os desatualizados e repor. |
| **Ao resolver P-93/P-94/P-95** | Rerotular os editais de cada faixa de dificuldade impactada e recalibrar o limiar (P-19). |

O gold set é um artefato versionado em `data/gold-set/` (um arquivo JSON por edital, conforme o esquema de §5.2). Cada edição gera uma entrada no CHANGELOG do diretório com data, responsáveis e motivo.

## 6. Modos de falha e fallback

Degradar com transparência é melhor que errar com confiança:

- **Baixa confiança na extração** → degradar para **leitura assistida**: destacar os trechos relevantes sem decidir por ele.
- **PDF imagem / OCR falha** → marcar "requer leitura manual"; não inventar conteúdo.
- **Anexos ausentes ou ilegíveis** → sinalizar triagem **incompleta**; não apresentar aderência como final.
- **Edital fora do padrão** (modalidade rara, estrutura atípica) → reduzir confiança e pedir revisão humana.

## 7. Custo e desempenho

O **custo de IA por edital** é guardrail da unidade econômica (documentos 08, §4 e 09, §6): a arquitetura de extração deve caber abaixo do preço médio por triagem. A **latência de triagem** é um NFR (documento 12): a promessa de "horas para minutos" (documento 01, §5) só se cumpre com resposta rápida. Custo e latência não competem aqui — o **split extração/aderência** (documento 12; arquitetura/03, §6; P-45) é o que os concilia: a extração é **1 por edital, cacheável e não sensível à latência**, enquanto a aderência por perfil é interativa.

### 7.1 Alavancas de custo/desempenho

Decididas na avaliação do adaptador de LLM (arquitetura/17, §5.1; RAD-53) e **todas subordinadas à barra de qualidade** — nenhuma troca recall ≥ 95% ou zero alucinação numérica (§5) por custo. As que **mudam o que vai ao modelo** só valem depois de passar no gold set (§5.3):

- **Pré-extração em lote na ingestão** (P-92) — como a extração não é sensível à latência, ela roda de forma **assíncrona quando o edital é ingerido** (antes de o usuário pedir a triagem) e **em lote**, o que corta ~metade do custo de extração. Quando o usuário chega, a extração já está pronta e só a aderência por perfil é calculada — rápida e barata. Preserva a inferência (mesmo modelo e prompt), então não depende do gold set.
- **Modelo por dificuldade** (P-93) — editais fáceis (PDF nativo, item único, modalidade simples — eixos de §5.1) usam um modelo mais barato; os difíceis, um mais capaz. Cada faixa é validada no gold set (§5.3) antes de valer.
- **Minimização do que vai ao modelo** (P-94) — o custo é dominado pela entrada; enviar só as **seções candidatas** (objeto, habilitação, prazos, valores) em vez do edital inteiro, medindo o consumo para **impor o teto de custo por edital** (P-20/P-38). Sujeito ao gold set, pois recortar demais arrisca o recall.
- **Reuso do prefixo estável** (P-95) — quando o prompt tiver exemplos do gold set, o trecho fixo (instrução + esquema) pode ser cacheado entre chamadas. Hoje o prefixo é pequeno demais para compensar; fica condicionado ao gold set.

O **teto de custo por edital** que fecha a unidade econômica continua `[A VALIDAR]` (P-20/P-38); as alavancas acima são o mecanismo para respeitá-lo.

## 8. Pendências

- Construir o gold set rotulado (cobertura e esquema em §§5.1–5.2; rótulos a produzir e metas a validar pré-lançamento). `[A VALIDAR]`
- Fixar os limiares de confiança por campo (§4). `[A VALIDAR]`
- Definir o teto de custo de IA por edital que fecha a unidade econômica (§7). `[A VALIDAR]`
- Validar no gold set as alavancas de custo que mudam o modelo/entrada (§7.1) — modelo por dificuldade (P-93), minimização de entrada (P-94), cache de prefixo (P-95); a pré-extração em lote (P-92) preserva a inferência e não depende do gold set. `[A VALIDAR]`

Rastreadas no documento **98 · Decisões e pendências**.
