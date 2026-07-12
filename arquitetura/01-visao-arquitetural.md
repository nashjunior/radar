# A01 · Visão Arquitetural

> Estilo, drivers e a estrutura de alto nível do core do MVP. Diagramas em Mermaid (renderizam no GitHub). Números vêm de [docs/12](../docs/12-modelo-de-dados-e-requisitos-nao-funcionais.md); escolha de tecnologia ainda **não confirmada** é **proposta** marcada `[A VALIDAR]` (as confirmadas trazem o `P-NN` da decisão).

## 1. Drivers arquiteturais

A arquitetura é moldada por poucos requisitos que, se falharem, quebram o produto:

| Driver | Requisito (docs/12, §3) | Consequência de projeto |
|--------|-------------------------|-------------------------|
| **Frescor** | p95 publicação→alerta ≤ 30 min | Polling frequente do PNCP + processamento assíncrono por fila |
| **Cobertura** | ≥ 99% dos editais do PNCP | Varredura por modalidade + reconciliação; idempotência por `numeroControlePNCP` |
| **Qualidade da triagem** | recall de campos críticos alto, zero alucinação numérica | Triagem por IA com citação da fonte e human-in-the-loop (docs/10) |
| **Conformidade** | API oficial, minimização, proveniência | Ingestão só via API; minimização antes de persistir |
| **Custo de IA** | teto por edital | Triagem assíncrona, cacheada, sob demanda |
| **Isolamento** | 0 vazamento cross-tenant (no *Next*) | `tenantId` desde já; caminho para RLS |
| **Resiliência de fonte** | degradação graciosa | Retry idempotente, detecção de *schema drift*, monitor de saúde |

## 2. Estilo arquitetural

**Monólito modular + workers assíncronos**, não microserviços. No MVP, um único deploy com módulos de fronteira clara (ingestão, matching, triagem, notificação, API) e *workers* que consomem uma fila. É o ponto ótimo de custo/velocidade para concepção: simples de operar, barato, e já desacoplado por eventos onde importa (ingestão → processamento). A quebra em serviços independentes fica para quando escala/organização exigirem. **Confirmado (P-27, 2026-07-05).**

## 3. Diagrama de contexto (C4 — nível 1)

```mermaid
flowchart TB
    USER([Empresa fornecedora<br/>usuária do MVP])
    subgraph RADAR[Radar de Licitações · MVP]
      SYS[Sistema Radar]
    end
    PNCP[(PNCP<br/>API pública de consulta)]
    LLM[[Provedor LLM<br/>Claude]]
    MAIL[[Provedor de e-mail]]

    PNCP -->|editais JSON| SYS
    USER -->|define critérios,<br/>lê alertas, decide| SYS
    SYS -->|alertas / digest| MAIL
    MAIL -->|e-mail| USER
    SYS -->|texto do edital<br/>como dado| LLM
    LLM -->|extração + citações| SYS
```

Fontes futuras (Compras.gov.br, portais estaduais) e canais futuros (app, WhatsApp) entram no *Next* (docs/07); ficam fora do contexto do MVP.

## 4. Diagrama de contêineres (C4 — nível 2)

```mermaid
flowchart TB
    subgraph Cliente
      WEB[Web App<br/>SPA]
    end
    subgraph Borda
      API[API / BFF<br/>REST + Auth]
    end
    subgraph Assíncrono
      SCHED[Ingestion Scheduler<br/>+ PNCP Client]
      QUEUE[[Fila de eventos]]
      MATCH[Matching Worker]
      TRIA[Triagem/IA Worker]
      NOTIF[Notification Worker]
      HEALTH[Source-Health Monitor]
    end
    subgraph Dados
      DB[(PostgreSQL<br/>base normalizada)]
      OBJ[(Object Storage<br/>editais/anexos)]
      AUD[(Audit log)]
    end

    PNCP[(PNCP API)] --> SCHED
    SCHED --> DB
    SCHED --> OBJ
    SCHED -->|edital.ingerido| QUEUE
    QUEUE --> MATCH
    MATCH --> DB
    MATCH -->|alerta.gerado| QUEUE
    QUEUE --> NOTIF
    NOTIF --> MAIL[[E-mail]]
    WEB --> API
    API --> DB
    API -->|triagem.solicitada| QUEUE
    QUEUE --> TRIA
    TRIA --> LLM[[Claude]]
    TRIA --> DB
    HEALTH -.monitora.-> SCHED
    API --> AUD
    TRIA --> AUD
```

## 5. Stack — primitivas confirmadas (P-27, 2026-07-05)

As **primitivas** estão confirmadas (relacional, fila gerenciada, blob S3-compatível, Claude, e-mail transacional, TS); o **vendor/modelo exato** dentro de cada uma fica deferido às pendências próprias — provedor de nuvem ([P-64](../docs/98-decisoes-e-pendencias.md)), região ([P-28](../docs/98-decisoes-e-pendencias.md)), LLM direto-vs-nuvem ([P-66](../docs/98-decisoes-e-pendencias.md)), modelo Claude/custo ([P-20](../docs/98-decisoes-e-pendencias.md)). O racional importa mais que a marca:

| Camada | Proposta | Racional |
|--------|----------|----------|
| Base normalizada | **PostgreSQL** | Modelo relacional casa com as entidades (docs/12); *full-text* nativo serve o matching do MVP; RLS habilita multi-tenant no *Next* |
| Fila de eventos | Fila gerenciada (SQS/RabbitMQ/Redis Streams) | Desacopla ingestão de processamento; retries e *dead-letter* |
| Object storage | S3-compatível | Guardar PDFs de editais/anexos para a triagem |
| Triagem/IA | **Claude** (família atual: um modelo *Sonnet* no caso comum por custo/latência, *Opus* em editais difíceis) | Qualidade de extração com citação; escolha exata e custo/edital são guardrail de docs/10, §7 `[A VALIDAR]` |
| E-mail | Provedor transacional (SES/SendGrid) | Entregabilidade de alertas e digest |
| Runtime/linguagem | **TypeScript** (linguagem única) | Deriva do compute por workload; ver [A08 §9](08-infraestrutura-e-implantacao.md); *seam* para Go no tier serverless quando P-31/A09 medirem o gatilho; Python só p/ OCR/eval. **Confirmado (P-27, 2026-07-05)** |
| Hospedagem | **Compute misto** (serverless + container + gerenciado), **região Brasil** — ver [A08](08-infraestrutura-e-implantacao.md) | Latência e residência de dados (nice-to-have LGPD) |
| Cobrança do SaaS | **Gateway de pagamento com checkout hospedado**; **default de GTM: Asaas** (fallback BR: Pagar.me/Iugu; Stripe só fallback técnico), com aceite de Segurança concedido em RAD-253 sob as compensações de [P-107](../docs/98-decisoes-e-pendencias.md) alínea a; fees/contrato comercial seguem Packaging/Produto | **Dependência externa e sub-operador LGPD** (DPA — alínea do próprio [P-107](../docs/98-decisoes-e-pendencias.md): **não** é herança de P-54/P-57, escopados a LLM/e-mail/nuvem; residência do Radar — [P-28](../docs/98-decisoes-e-pendencias.md)): Asaas exige ROPA/Política e DPA/Anexo II cobrindo retenção, direitos do titular e eventual transferência internacional; Stripe processa nos EUA, o que exige mecanismo do art. 33 da LGPD, igual ao LLM. Compra-se o **pagamento**; o **entitlement** (plano, cota, carência) é agregado nosso — o port é provider-agnóstico e o swap não pode depender de metering nativo do provedor ([docs/13 §3](../docs/13-dominios-e-bounded-contexts.md)) |

## 6. Preparo para multi-tenant (mesmo sem usar no MVP)

O MVP é single-tenant, mas o custo de retrofit é alto (docs/05, §7). Portanto, desde já: `tenantId` em toda entidade (docs/12, §2); toda query de leitura passa por um filtro de tenant central; e o design de dados é compatível com *Row-Level Security* do Postgres, a ser **ativado** quando as consultorias entrarem (*Next*). Isso é decisão de arquitetura, não de produto.

## 7. Transversais mapeados aos contêineres

- **Segurança por camada** (docs/05, §4): validação/sanitização no `PNCP Client`; TLS em todo trânsito; segredos em cofre; AuthN/AuthZ na `API`; edital tratado como não-confiável no `Triagem/IA Worker` (anti prompt-injection).
- **Observabilidade**: logs estruturados, métricas de negócio (docs/08) e o `Source-Health Monitor` (docs/11, §7).
- **Auditoria**: `Audit log` append-only para todo acesso a dado pessoal e toda decisão automática (docs/05, §3).

## 8. Pendências

Estilo (monólito modular), stack de primitivas e runtime/linguagem **confirmados** ([P-27](../docs/98-decisoes-e-pendencias.md), 2026-07-05). Seguem abertos: provedor de nuvem ([P-64](../docs/98-decisoes-e-pendencias.md)) e região/residência de dados ([P-28](../docs/98-decisoes-e-pendencias.md)).
