# A02 · Ingestão de Dados do PNCP

> **Como pegar os dados do PNCP** de forma completa, fresca e conforme. O PNCP é a fonte âncora do MVP (docs/02, §3 e docs/03, §7). Este documento desenha a ingestão que realiza o fluxo de sistema de docs/03, §2.
>
> ⚠️ **Nota de precisão.** Os contratos exatos da API (caminhos, nomes de parâmetro, códigos de modalidade) devem ser confirmados no **Swagger oficial** ([docs/06](../docs/06-glossario-e-fontes.md): `pncp.gov.br/api/consulta/swagger-ui`) antes de codar. O que está aqui é o **desenho**; campos marcados `[A VALIDAR — Swagger]` são a forma esperada, não contrato verificado.

## 1. Por que API, não scraping

Decisão fechada: no MVP a coleta é **só via API pública de consulta do PNCP**. Não é preferência técnica — é conformidade (docs/02, §4): consumir um endpoint oficial documentado é materialmente diferente de raspar HTML contra termos de uso, e a ANPD já tratou scraping como tratamento sujeito à LGPD. Bônus: a API é mais estável e paginada.

## 2. A API de Consulta do PNCP

- **Base (consulta pública, sem autenticação):** `https://pncp.gov.br/api/consulta`
- **Swagger:** `https://pncp.gov.br/api/consulta/swagger-ui/index.html` · spec OpenAPI: `/v3/api-docs`
- **Formato:** JSON, com **paginação** (campos `totalRegistros`, `totalPaginas`, `numeroPagina`, `paginasRestantes`, `empty` — docs/03, §7). Confirmado contra o OpenAPI oficial (2026-07-11, RAD-198): o campo é `numeroPagina`, não `paginaAtual`.
- **Identificador único:** `numeroControlePNCP` — formato `{cnpj}-{sequencialCompra}/{anoCompra}` (ex.: `80881915000192-1-000044/2026`) — chave para deduplicação e idempotência (§4).

Endpoints relevantes ao MVP (contratos confirmados no Swagger e por chamada real — 2026-07-05):

| Propósito | Endpoint | Parâmetros obrigatórios | Parâmetros opcionais | Obs. |
|-----------|----------|------------------------|---------------------|------|
| Contratações por **data de publicação** | `GET /v1/contratacoes/publicacao` | `dataInicial`, `dataFinal` (yyyyMMdd), `codigoModalidadeContratacao` (int) | `codigoModoDisputa`, `uf`, `codigoMunicipioIbge`, `cnpj`, `pagina`, `tamanhoPagina` | |
| Contratações por **data de atualização global** | `GET /v1/contratacoes/atualizacao` | `dataInicial`, `dataFinal` (yyyyMMdd), `codigoModalidadeContratacao` (int) | mesmos opcionais acima | Retorna ~2,6× mais registros que `/publicacao` no mesmo dia |
| Contratações com **proposta em aberto** | `GET /v1/contratacoes/proposta` | `dataFinal` (yyyyMMdd), `pagina` | `codigoModalidadeContratacao`, `tamanhoPagina`, filtros de órgão | Confirmado por chamada real (2026-07-06); `pagina` é obrigatório pelo spec — ausência causa 422 |
| **Detalhe individual** de uma contratação | `GET /v1/orgaos/{cnpj}/compras/{ano}/{sequencial}` | path params | — | Único endpoint de detalhe — não existe `GET /v1/contratacoes/{numeroControlePNCP}`. Confirmado 2026-07-05; reforçado no código em RAD-198 (o gateway usava o endpoint inexistente). |
| **Arquivos/anexos** de uma contratação | `GET /v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/arquivos` | path params | — | Base é a API de **DADOS** (`https://pncp.gov.br/api/pncp`), **não** `/api/consulta` (§2 acima) — confirmado 2026-07-11 (RAD-198). Corpo do item confirmado por chamada real em 2026-07-12 (RAD-274) — ver §6.1. Resposta é **array plano, sem envelope de paginação**. |

**Paginação:** `tamanhoPagina` aceito: 10–50 (limite máximo = **50**; valores > 50 retornam 400). Padrão: 10. Iterar modalidade a modalidade; toda varredura por dia requer ~120 requests com `tamanhoPagina=50`.

**Schema do item** (contratação) — campos confirmados por chamada real:

```
numeroControlePNCP   string   "{cnpj}-{seq}/{ano}" — chave primária para upsert
anoCompra            integer
sequencialCompra     integer
numeroCompra         string
processo             string
objetoCompra         string
dataInclusao         datetime (ISO 8601)
dataPublicacaoPncp   datetime (ISO 8601)
dataAtualizacao      datetime (ISO 8601)
dataAtualizacaoGlobal datetime (ISO 8601)  ← campo de corte do /atualizacao
dataAberturaProposta  datetime | null
dataEncerramentoProposta datetime | null
valorTotalEstimado   decimal | null
valorTotalHomologado decimal | null
modalidadeId         integer  (= codigoModalidadeContratacao)
modalidadeNome       string
modoDisputaId        integer
modoDisputaNome      string   (ex.: "Aberto")
situacaoCompraId     integer  (enum: 1=Divulgada, 2, 3, 4)
situacaoCompraNome   string
tipoInstrumentoConvocatorioCodigo integer
tipoInstrumentoConvocatorioNome   string  (ex.: "Edital")
srp                  boolean  (sistema de registro de preços)
emendaParlamentar    object | null
fontesOrcamentarias  array
usuarioNome          string
linkSistemaOrigem    string | null
linkProcessoEletronico string | null
informacaoComplementar string | null
justificativaPresencial string | null
orgaoEntidade        { cnpj, razaoSocial, poderId, esferaId }
unidadeOrgao         { codigoUnidade, nomeUnidade, ufSigla, ufNome, municipioNome, codigoIbge }
amparoLegal          { codigo, nome, descricao }  (ex.: "Lei 14.133/2021, Art. 28, I")
unidadeSubRogada     object | null
orgaoSubRogado       object | null
```

## 3. Estratégia de sincronização

Três regimes:

1. **Carga inicial (backfill):** varrer janelas de data para trás até o horizonte desejado, por modalidade. Roda uma vez.
2. **Incremental (frescor):** o agendador dispara em intervalo curto o suficiente para o p95 ≤ 30 min (docs/12) — usando `publicacao` para novos editais e `atualizacao` para mudanças de fase/prazo. `[A VALIDAR — cadência exata]`
3. **Reconciliação (cobertura):** varredura periódica mais ampla (ex.: diária) para pegar o que o incremental perdeu e garantir ≥ 99% (docs/12). Divergência entre reconciliação e incremental é sinal de alerta.

**Detalhe individual (regimes 2 e 3).** Tanto o incremental (mudança de fase) quanto a reconciliação consultam o estado atual de um edital específico já catalogado — via `GET /v1/orgaos/{cnpj}/compras/{ano}/{sequencial}` (§2), chaveado por `cnpj`+`anoCompra`+`sequencialCompra` já carregados no registro local, nunca parseado de `numeroControlePNCP` (formato irregular — RAD-198). **Não existe** `GET /v1/contratacoes/{numeroControlePNCP}`.

**Iteração por modalidade.** Como `/publicacao` exige `codigoModalidadeContratacao`, o coletor faz um laço sobre a tabela de modalidades da Lei 14.133 — pregão, concorrência, concurso, leilão, diálogo competitivo, e as hipóteses de contratação direta (docs/02, §2). Os **códigos** foram confirmados por chamada real à API (2026-07-05):

| Código | Nome no PNCP | Lei 14.133/2021 | Volume típico/dia útil |
|--------|-------------|-----------------|------------------------|
| 1 | Leilão - Eletrônico | Art. 28, IV | ~6 |
| 2 | Diálogo Competitivo | Art. 28, V | ~0–2 |
| 3 | Concurso | Art. 28, III | ~1–5 |
| 4 | Concorrência - Eletrônica | Art. 28, II | ~250–300 |
| 5 | Concorrência - Presencial | Art. 28, II | ~10–20 |
| 6 | Pregão - Eletrônico | Art. 28, I | **~1.300–1.500** |
| 7 | Pregão - Presencial | Art. 28, I | ~40–60 |
| 8 | Dispensa | Art. 75 | **~2.500–2.800** |
| 9 | Inexigibilidade | Art. 74 | **~1.200–1.400** |
| 10 | Manifestação de Interesse | — | ~5–10 |
| 11 | Pré-qualificação | Art. 87 | ~3–8 |
| 12 | Credenciamento | Art. 79 | ~70–100 |
| 13 | Leilão - Presencial | Art. 28, IV | ~1–3 |

Modalidades MVP prioritárias (cobrem ≥ 90% do volume): **6, 8, 9** (Pregão Eletrônico + Dispensa + Inexigibilidade).

**Idempotência.** Toda gravação é *upsert* por `numeroControlePNCP` — reprocessar a mesma página nunca duplica nem corrompe. Isso torna *retries* seguros (§5).

## 4. Pipeline de ingestão

Realiza o fluxo de docs/03, §2 — a ordem importa, em especial a minimização **antes** de persistir:

```mermaid
sequenceDiagram
    autonumber
    participant SCH as Scheduler
    participant API as PNCP API
    participant VAL as Validador/Dedup
    participant MIN as Minimização
    participant NRM as Normalizador
    participant DB as Base normalizada
    participant Q as Fila

    SCH->>API: GET /v1/contratacoes/publicacao<br/>(modalidade, data, pagina=1)
    loop até paginasRestantes = 0
        API-->>SCH: página JSON (com rate-limit educado)
        SCH->>VAL: registros da página
        VAL->>VAL: validar schema + dedup por numeroControlePNCP
        VAL->>MIN: registros válidos
        MIN->>MIN: descartar/anonimizar PII desnecessária
        MIN->>NRM: registros minimizados
        NRM->>DB: upsert (schema canônico) + proveniência
        NRM->>Q: publicar evento "edital.ingerido"
        SCH->>API: próxima página
    end
```

Pontos de projeto:

- **Validação de schema** logo na entrada (docs/05, §4): se o payload do PNCP não bate com o schema esperado, não grava — sinaliza *drift* (§5).
- **Minimização antes da base** (docs/03, §2): CPF/nome de terceiro que não agrega à decisão é descartado ou anonimizado; nunca chega ao disco sem necessidade.
- **Normalização ao schema canônico** (docs/12): modalidade, fase, valores e prazos viram atributos de primeira classe; `faseAtual` é derivada dos dados, não de ordem fixa (docs/04, §4).
- **Proveniência obrigatória** (docs/05, §5): cada edital grava fonte (`PNCP`), timestamp de coleta e base legal.
- **Evento, não chamada direta:** a ingestão só publica `edital.ingerido`; matching e triagem reagem depois (desacoplamento).

## 5. Resiliência (docs/11, §7)

- **Rate-limit educado + backoff:** respeitar limites da fonte; recuar em 429/5xx com *exponential backoff*.
- **Retry idempotente:** falha no meio da paginação? Reprocessar é seguro por causa do *upsert* (§3).
- **Detecção de *schema drift*:** mudança de formato da API é detectada pela validação (§4) e **alerta** em vez de gravar lixo.
- **Monitor de saúde da fonte:** o `Source-Health Monitor` acompanha disponibilidade, latência e **volume esperado** de editais/dia; queda ou anomalia gera alerta interno.
- **Degradação graciosa:** falha do PNCP degrada frescor, não derruba o produto; o que já está na base continua servindo matching e triagem.

## 6. Anexos e o texto do edital

A triagem (docs/10) precisa do **edital e anexos**, não só dos metadados. Desenho:

- Metadados vêm no fluxo principal (§4). Os **arquivos** são buscados via endpoint de arquivos (`.../arquivos`) **sob demanda** — quando um edital é enviado à triagem — e guardados em **object storage** com referência no registro.
- Baixar tudo sempre desperdiça storage e banda; baixar sob demanda casa com o custo de IA ser assíncrono e cacheado (docs/08, §4).
- Retenção dos anexos segue a política de retenção (docs/05, §5): ativo até encerramento + 24 meses e arquivo frio/expurgo até 5 anos, com minimização de PII na ingestão.

### 6.1 Contrato de `/arquivos` (confirmado por chamada real — 2026-07-12, RAD-274)

Resposta: **array plano** (sem envelope de paginação). Todos os campos abaixo apareceram em **100%** dos 20 documentos amostrados (17 compras, modalidade 6) — logo são tratados como **obrigatórios** no ACL (ausência ⇒ `SchemaDriftError`, falha loud, nunca grava lixo):

| Campo | Uso na ingestão |
|-------|-----------------|
| `uri` / `url` | URL de download (idênticas na amostra). Dado **não confiável** → passa pela guarda SSRF (P-58). |
| `sequencialDocumento` | **Chave natural** do documento dentro da compra — é o que deve compor a chave de object storage. |
| `titulo` | Texto **livre digitado pelo órgão**. Só metadado de exibição — **nunca** compõe chave nem indica o papel do documento. |
| `tipoDocumentoId` / `tipoDocumentoNome` / `tipoDocumentoDescricao` | **Enum** do PNCP — é o que diz qual documento é o Edital. Confirmados na amostra: `2` Edital · `4` Termo de Referência · `7` Estudo Técnico Preliminar · `16` Outros Documentos. |
| `statusAtivo` (bool) | Documento revogado/substituído ⇒ `false`. **Filtrar**: anexo inativo não entra na triagem. |
| `dataPublicacaoPncp`, `cnpj`, `anoCompra`, `sequencialCompra` | Proveniência/eco do path. |

**Não existem** neste endpoint: `nomeArquivo`, `tamanhoBytes`, `tipoMime`. Esses três só são conhecidos **no download** — `content-length`, `content-disposition: attachment; filename="…"` (nome real, com extensão) e **magic bytes** do corpo. O PNCP responde `content-type: application/octet-stream` para tudo, então o mime declarado **não é fonte confiável** (é preciso *sniff*).

**`titulo` não descreve o documento.** Na amostra há item com `titulo: "Parecer Contábil PREGAO"` e `tipoDocumentoNome: "Estudo Técnico Preliminar"`. A seleção do **documento principal** (o edital) é por `tipoDocumentoId`, nunca por título nem por posição no array.

### 6.2 Formato dos anexos: **não é só PDF**

Amostra real de 20 anexos (2026-07-12, RAD-274): **12 PDF (60%) · 5 DOCX (25%) · 3 ZIP (15%)**. Os ZIP eram justamente documentos do tipo `Edital`. Consequências de desenho:

- O extrator de texto é **multi-formato** (PDF, DOCX, ZIP contendo os anteriores) — um extrator só-PDF cobriria 60% dos casos e perderia o edital em 15% deles.
- **ZIP é superfície de ataque** (zip slip, zip bomb): descompactação com teto de razão/tamanho/profundidade e sem honrar caminho do arquivo interno (docs/05; edital é dado não confiável).
- PDF sem texto selecionável (imagem escaneada) exige **OCR** (docs/10, §6) — fora do MVP; o anexo é marcado `temTextoSelecionavel: false` e a triagem degrada com `falha_ocr` em vez de alucinar.

### 6.3 Onde vive o extrator de texto: **na Ingestão**

O texto é **derivado do binário** e a Ingestão é dona do binário (baixa, quarentena, scan — P-104/AB14). Extrair na Triagem seria: (a) fazer a Triagem conhecer o formato do PNCP, vazando o modelo externo além do ACL (docs/13, §5); (b) contrariar o próprio port da Triagem (`ObjectStorage.obterTextoAnexo`, que por contrato já recebe *"o texto JÁ resolvido"*); (c) re-extrair o mesmo PDF por tenant, quando o texto é **catálogo global cacheável** — mesma natureza da extração (P-45).

Desenho: a Ingestão materializa o texto como **objeto derivado** no storage (após o scan aprovar o anexo como `limpo` — *fail-closed*), com o nº de páginas; `DocumentosDoEditalPort` publica a ref do texto e o tipo de documento; o `ObjectStorage` da Triagem passa a ser um *get* simples do `.txt` — **nenhum parser na Triagem**. Detalhe e sequência de implementação em P-110 (docs/98).

## 7. Conformidade da ingestão (checklist)

Espelha o checklist de docs/04, §6 aplicado à fonte PNCP:

- [ ] Coleta **só** por API oficial; sem scraping (docs/02, §4).
- [ ] Minimização aplicada **antes** de persistir (docs/03, §2).
- [ ] Proveniência (fonte, data, base legal) gravada em todo edital (docs/05, §5).
- [ ] Base legal registrada para qualquer dado pessoal retido (docs/02, §4).
- [ ] TLS em todo trânsito; nenhum dado sensível em texto claro (docs/05, §4).
- [ ] Rate-limit educado com a fonte (docs/03, §7).

## 8. Pendências

- ~~Confirmar no **Swagger** os endpoints, parâmetros e `tamanhoPagina` (§2).~~ **Resolvido — P-26 (2026-07-05)**: contratos confirmados; ver §2 e §3.
- ~~Mapear os **códigos de modalidade** do PNCP (§3).~~ **Resolvido — P-26 (2026-07-05)**: tabela completa em §3.
- ~~Confirmar por chamada real o **corpo de cada item de `/arquivos`** (§6).~~ **Resolvido — P-110 (2026-07-12, RAD-274)**: contrato completo em §6.1; formatos reais em §6.2.
- Fixar a **cadência de polling** que atinge o frescor de 30 min (§3). `[A VALIDAR]` → P-29
- Implementar **lifecycle/tiering e expurgo de anexos** em object storage conforme docs/05, §5 (§6) → P-30
- Implementar o **caminho completo anexo → texto** (extrator multi-formato, chave de storage segura, seleção do documento principal, loop de disponibilidade pós-scan) — §6.1–§6.3 → **P-110**

Rastreadas em [docs/98](../docs/98-decisoes-e-pendencias.md) (P-26, P-29, P-30, P-110).
