# 14 · Casos de Uso (MVP)

> Os **use cases** do MVP, por **bounded context** (documento 13), no estilo **Clean Architecture / application** ([arquitetura/10](../arquitetura/10-padroes-e-estrutura-de-codigo.md)): cada um com **nome** (`<Verbo><Substantivo>UseCase`), **ator/trigger**, **input → output (DTO)**, **ports** que usa, **erros** customizados, **eventos** que publica. Escopo: os **6 contextos do Now** (documento 07); Gestão da Participação (*Next*) e Inteligência de Mercado (*Later*) ficam para depois. Estágio: **Concepção** — assinaturas ilustrativas.
>
> Convenções: modelo em [documento 12](12-modelo-de-dados-e-requisitos-nao-funcionais.md); eventos em [arquitetura/03, §3](../arquitetura/03-desenho-da-solucao.md); toda operação é **abortável** (recebe `AbortSignal`, arquitetura/10 §1); ports com nome de papel, adapters com tecnologia (arquitetura/10 §8). **Autorização por objeto** (confirma *posse* por `tenantId`/`clienteFinalId`, não só filtro de query) é regra transversal a **todo use case disparado pelo usuário** que receba ID controlável pelo cliente — provada pela **matriz AB1** (arquitetura/07, §2.1; P-51).

## 1. Ingestão & Catálogo

> Coletar do PNCP, normalizar e versionar o edital. Agregado raiz: **Edital**.

| Use Case | Trigger / ator | Input → Output | Ports | Erros | Eventos |
|----------|----------------|----------------|-------|-------|---------|
| **`IngerirEditaisUseCase`** | Scheduler (polling A02) | `{modalidade, janela}` → `IngestaoResumoDTO` | `PncpGateway`, `EditalRepository`, `ProvenienciaRepository`, `EventPublisher` | `SchemaDriftError`, `FonteIndisponivelError` | `edital.ingerido` |
| **`ReconciliarCatalogoUseCase`** | Scheduler (diário) | `{janela}` → `ReconciliacaoDTO` | `PncpGateway`, `EditalRepository` | `FonteIndisponivelError` | `edital.ingerido` (dos faltantes) |
| **`AtualizarFaseEditalUseCase`** | Scheduler (`/atualizacao`) | `{numeroControlePncp}` → `EditalDTO` | `PncpGateway`, `EditalRepository` | `EditalNaoEncontradoError` | `edital.fase-mudou` |
| **`BaixarAnexosEditalUseCase`** | sob demanda (antes da triagem) | `{editalId}` → `AnexosDTO` | `PncpGateway`, `ObjectStorage`, `EditalRepository` | `AnexoIndisponivelError` | — |

**Invariantes:** *upsert* idempotente por `numeroControlePncp`; **minimização antes de persistir** (documento 03, §2); **proveniência** (fonte, timestamp, base legal) em todo edital; coleta **só via API oficial** (documento 02, §4). O `PncpGateway` é um **ACL** (documento 13, §5) — o modelo do PNCP não vaza para dentro.

## 2. Monitoramento & Matching

> Cruzar editais × critérios, pontuar e alertar. Agregados: **CritérioDeMonitoramento**, **Alerta**.

| Use Case | Trigger / ator | Input → Output | Ports | Erros | Eventos |
|----------|----------------|----------------|-------|-------|---------|
| **`DefinirCriterioMonitoramentoUseCase`** | Usuário | `{ramoCnae, regiao, faixaValor, palavrasChave, clienteFinalId}` → `CriterioDTO` | `CriterioRepository` | `CriterioInvalidoError`, `AcessoNegadoError` | `criterio.definido` |
| **`CasarEditalComCriteriosUseCase`** | Evento `edital.ingerido` | `{editalId}` → `AlertaDTO[]` | `EditalRepository`, `CriterioRepository`, `AlertaRepository`, `EventPublisher` | — | `alerta.gerado` |
| **`RegistrarFeedbackAlertaUseCase`** | Usuário | `{alertaId, relevante, clienteFinalId}` → `void` | `AlertaRepository` | `AcessoNegadoError`, `AlertaNaoEncontradoError` | `feedback.alerta` |

**Invariantes:** postura **recall-alto** (documento 11, §2) — melhor um alerta a mais que perder edital; ranking por aderência + digest contra fadiga (documento 11, §4). **Aderência** aqui é *relevância ao critério* (barata), distinta da Triagem (documento 13, §3). `faixaValor` lê tabela parametrizável e datada (documento 02, §2).

## 3. Análise & Triagem

> Extrair requisitos, avaliar aderência e risco, sugerir go/no-go. Agregado: **Triagem** (+ **ExtraçãoEdital**, cacheável). Detalhe em [documento 10](10-modulo-analise-ia.md) e [arquitetura/11](../arquitetura/11-seguranca-da-ia.md); implementação (Clean Arch) em [arquitetura/17](../arquitetura/17-analise-e-triagem.md).

| Use Case | Trigger / ator | Input → Output | Ports | Erros | Eventos |
|----------|----------------|----------------|-------|-------|---------|
| **`SolicitarTriagemUseCase`** | Usuário (API) | `{editalId, perfilId, clienteFinalId}` → `void` | `EventPublisher` | `AcessoNegadoError` | `triagem.solicitada` |
| **`ExtrairEditalUseCase`** | interno (1ª triagem do edital) | `{editalId, texto, anexos}` → `ExtracaoEditalDTO` | `LlmGateway`, `ExtracaoRepository`, `ObjectStorage` | `ConfiancaInsuficienteError`, `OcrFalhouError` | `extracao.concluida` |
| **`TriarEditalUseCase`** | Evento `triagem.solicitada` | `{editalId, perfilId, clienteFinalId}` → `TriagemDTO` | `ExtracaoRepository`, `PerfilGateway`, `TriagemRepository`, `LlmGateway`, `EventPublisher` | `AcessoNegadoError`, `PerfilNaoEncontradoError`, `ConfiancaInsuficienteError` | `triagem.concluida` |

**Invariantes (críticos):** **extração cacheada por edital** (1 por edital); **aderência por perfil** (1 por `edital × perfil`) — não misturar (documento 12, P-45). **Autorização por objeto** (`perfil.clienteFinalId == input.clienteFinalId`) contra IDOR (arquitetura/07 AB1, P-51). **Edital = dado não-confiável** (defesa de injeção, arquitetura/11); **citação da fonte** obrigatória; abaixo do limiar de confiança → *fallback* leitura assistida (documento 10, §6). Decisão go/no-go é **sempre do usuário**. A triagem roda em **worker assíncrono** disparado por `triagem.solicitada` — nunca no caminho síncrono da API (custo/latência, arquitetura/03, §§1,3,6); a API publica o comando via `SolicitarTriagemUseCase`. O **Perfil de Habilitação** é lido de Identidade & Organização por Cliente-Fornecedor (documento 13, §5) via **`PerfilGateway`** — um **Gateway** (leitura cross-contexto), não Repository, pois a Triagem não é dona do agregado (arquitetura/10, §8; arquitetura/17); port *consumer-defined*, distinto do `IdentidadeGateway` da Governança (§5) — mesmo padrão, contratos diferentes. `Decidido (P-83, 2026-07-05)`.

## 4. Notificação

> Entregar alerta/digest por canal e preferência. Agregado: **Notificação**.

| Use Case | Trigger / ator | Input → Output | Ports | Erros | Eventos |
|----------|----------------|----------------|-------|-------|---------|
| **`NotificarAlertaUseCase`** | Evento `alerta.gerado` | `{alertaId}` → `void` | `AlertaRepository`, `PreferenciaRepository`, `Notifier` | `CanalIndisponivelError` | `notificacao.enviada` |
| **`EnviarDigestUseCase`** | Scheduler (diário/semanal) | `{usuarioId, janela}` → `DigestDTO` | `AlertaRepository`, `Notifier` | — | `notificacao.enviada` |
| **`DefinirPreferenciasNotificacaoUseCase`** | Usuário | `{usuarioId, canais, frequencia}` → `PreferenciaDTO` | `PreferenciaRepository` | `AcessoNegadoError`, `PreferenciaInvalidaError` | — |

**Invariantes:** criticidade define o canal (prazo curto → imediato; resto → digest); agrupamento e cap por usuário contra fadiga (documento 11, §4).

## 5. Governança & Conformidade

> Base legal, proveniência, direitos do titular, auditoria e retenção — *bounded context* Open Host (documento 13, §5). Agregados: **RegistroDeProveniência**, **SolicitaçãoDeTitular**.

| Use Case | Trigger / ator | Input → Output | Ports | Erros | Eventos |
|----------|----------------|----------------|-------|-------|---------|
| **`RegistrarProvenienciaUseCase`** | interno (ingestão) | `{editalId, fonte, baseLegal}` → `void` | `ProvenienciaRepository` | — | — |
| **`RegistrarAuditoriaUseCase`** | interno (todo acesso a dado pessoal) | `{usuarioId, recurso, acao, baseLegal, escopo}` → `void` | `AuditLogRepository` (append-only) | `AuditoriaIndisponivelError` (fail-closed) | — |
| **`AtenderSolicitacaoTitularUseCase`** | Titular (LGPD) | `{titular, tipo: acesso\|correcao\|eliminacao}` → `SolicitacaoDTO` | `SolicitacaoTitularRepository`, `EditalRepository`, `IdentidadeGateway` | `IdentidadeNaoVerificadaError`, `AcessoNegadoError` | `titular.solicitacao-atendida` |
| **`AplicarRetencaoUseCase`** | Scheduler | `{politica}` → `RetencaoDTO` | vários `Repository`, `ObjectStorage` | — | `retencao.aplicada` |

**Invariantes:** **verificar a identidade do titular** antes de atender (defesa contra pedido falso, arquitetura/07 AB10, P-57) — AB10 é **teste obrigatório do gate** de release (arquitetura/07, §5); auditoria é **append-only e imutável** — tentativa de `UPDATE`/`DELETE` é negada e ela mesma auditada (arquitetura/07 AB13) — e **fail-closed** (se a trilha não grava, a operação que a exigia falha), registrando **quem, quando, o quê, base legal e escopo** (`tenantId`/`clienteFinalId`) — documento 05, §3 (princípio 4); P-61; retenção conforme matriz versionada (documento 05, §5, P-05/P-44).

## 6. Identidade & Organização

> Tenant, usuário, cliente-final e o perfil de habilitação da empresa. Agregados: **Tenant**, **PerfilDeHabilitação**. `tenantId` é o *Shared Kernel* (documento 13, §5).

| Use Case | Trigger / ator | Input → Output | Ports | Erros | Eventos |
|----------|----------------|----------------|-------|-------|---------|
| **`AutenticarUsuarioUseCase`** | Usuário | `{credenciais}` → `SessaoDTO` | `UsuarioRepository`, `TokenProvider` | `CredenciaisInvalidasError`, `MfaRequeridoError` | `usuario.autenticado` |
| **`AutorizarAcessoUseCase`** | interno (toda requisição) | `{usuarioId, recurso, clienteFinalId}` → `void` | `PermissaoRepository` | `AcessoNegadoError` | — |
| **`GerenciarPerfilHabilitacaoUseCase`** | Usuário | `{clienteFinalId, habJuridica, habFiscal, habTecnica, habEconomica}` → `PerfilDTO` | `PerfilRepository` | `AcessoNegadoError`, `PerfilInvalidoError` | `perfil.atualizado` |
| **`ConsultarPerfilHabilitacaoUseCase`** | Usuário (leitura) | `{clienteFinalId}` → `PerfilDTO` \| `null` | `PerfilRepository` | `AcessoNegadoError` | — |

**Invariantes:** **autorização por objeto** por tenant/`clienteFinal` em **toda leitura e escrita** — confirma *posse* do objeto, não só filtro de query — é o controle central contra vazamento cross-tenant (documento 05, §2; P-51). Aplica-se a **todo use case disparado pelo usuário** com ID controlável pelo cliente, não só ao caso feliz da Triagem: `TriarEditalUseCase`/`SolicitarTriagemUseCase` (§3), `RegistrarFeedbackAlertaUseCase` (§2), `DefinirPreferenciasNotificacaoUseCase` (§4), `GerenciarPerfilHabilitacaoUseCase`/`ConsultarPerfilHabilitacaoUseCase` (§6) e `AtenderSolicitacaoTitularUseCase` (§5). A prova é a **matriz AB1 por recurso × ação** (arquitetura/07, §2.1), **teste obrigatório do gate**. MFA e gestão de sessão (P-53). O **Perfil de Habilitação** vive aqui — este é o contexto **dono**, que o persiste (`GerenciarPerfilHabilitacaoUseCase`) e o lê (`ConsultarPerfilHabilitacaoUseCase`, leitura por objeto do próprio `clienteFinal`) via `PerfilRepository` — e é consumido pela Triagem por Cliente-Fornecedor via `PerfilGateway` (leitura cross-contexto; documento 13, §5; P-83). Mesma entidade, Repository no dono e Gateway no consumidor: é a distinção de taxonomia de ports (arquitetura/10, §8).

## 7. Fora deste escopo (Next / Later)

- **Gestão da Participação** (*Next*, documento 07): `IniciarCasoUseCase`, `AvancarFaseCasoUseCase`, `AlertarPrazoCriticoUseCase`, `ConcluirCasoUseCase` — dirigidos pelas fases legais (documento 04).
- **Inteligência de Mercado** (*Later*): `AgregarResultadosUseCase`, `CalcularPrecoReferenciaUseCase` — *read models* (CQRS), sobre `RESULTADO` por edital (documento 12, P-48).

## 8. Pendências

- Validar a lista de use cases com o time (esp. donos por contexto) — vira o backlog do build. `[A VALIDAR]`
- Confirmar assinaturas (input/output DTOs) ao fechar o modelo (documento 12) e os contratos (arquitetura/03, §3). `[A VALIDAR]`

Rastreadas no documento [98](98-decisoes-e-pendencias.md).
