# A08 · Infraestrutura e Implantação

> O que o projeto **precisa de infra**: o modelo de compute por workload (serverless, containers, gerenciados) e seus equivalentes entre provedores. Complementa a stack proposta de [A01, §5](01-visao-arquitetural.md) e a topologia de dados de [A05](05-stress-test-banco.md). Estágio: **Concepção** — escolhas `[A VALIDAR]` (liga P-27, P-28).

## 1. Princípio de escolha

O compute não é uma decisão única — cada workload tem um perfil, e o perfil escolhe o modelo:

- **Serverless** (funções/jobs) para o que é **bursty, agendado ou de cola** e fica **ocioso** entre execuções — paga por uso, escala com o pico, custa ~zero parado.
- **Container gerenciado** para o que é **sempre-ligado** ou precisa de **pool controlado** (concorrência, custo, long-running).
- **Serviço gerenciado** para **estado** (banco, fila, storage, segredos) — comprar, nunca operar.

Regra de ouro: **serverless para o pico e a cola; container para o sempre-ligado e o pool; gerenciado para o dado.** Nada de Kubernetes ou VM crua no MVP (§10).

## 2. Modelo de compute por workload

Mapeando os contêineres de A01/A03:

| Workload | Perfil | Modelo recomendado | Por quê |
|----------|--------|--------------------|---------|
| **Web App (SPA)** | estático | **CDN + object storage** | sem compute; cache na borda |
| **API / BFF** | sempre-ligado, baixa latência | **Container gerenciado** | monólito modular num deploy só; escala horizontal |
| **Ingestão + scheduler** | agendado, bursty, ocioso entre polls | **Serverless (job agendado)** | paga o pico do PNCP, ~zero parado — encaixe perfeito |
| **Matching / Notificação** (consumidores de fila) | orientado a evento, leve | **Serverless (fila→função)** | escala com fan-out; sem servidor ocioso |
| **Triagem / IA** | long-running, caro, precisa de **pool** | **Container (pool limitado)** | *bulkhead* + teto de concorrência controlam custo (A04/A05, P-20); evita timeout de função |
| **Source-Health Monitor** | agendado, leve | **Serverless agendado** | idem ingestão |

Observação: no MVP monólito modular (A01, §2), API e workers podem coabitar um deploy; a tabela mostra o **destino** quando cada um justificar isolamento.

## 3. Serviços gerenciados (comprar, não operar)

| Serviço | Papel | Nota |
|---------|-------|------|
| **Postgres gerenciado** | base normalizada (A05) | **com pool** (pgbouncer/proxy) — serverless + Postgres explode conexões sem ele (P-41) |
| **Fila gerenciada** | eventos entre módulos (A03, §3) | retries + DLQ nativos |
| **Object storage** | editais/anexos (A02, §6) | já é serverless por natureza |
| **Secrets manager** | segredos, rotação (P-08) | nunca segredo no código (05, §4) |
| **LLM (Claude)** | triagem (10) | API direta **ou** via nuvem (Bedrock/Vertex) — decisão de residência/DPA (P-54, P-66) |
| **E-mail transacional** | alertas/digest | entregabilidade |

## 4. Equivalentes por provedor (evitar lock-in)

Escolher **primitivas portáveis** (container OCI, Postgres, fila, blob) mantém a opção aberta:

| Primitiva | AWS | Google Cloud | Azure |
|-----------|-----|--------------|-------|
| Container gerenciado | Fargate / App Runner | Cloud Run | Container Apps |
| Função serverless | Lambda | Cloud Functions / Run Jobs | Functions |
| Agendador | EventBridge Scheduler | Cloud Scheduler | Timer trigger |
| Postgres gerenciado | RDS / Aurora | Cloud SQL / AlloyDB | DB for PostgreSQL |
| Pool de conexão | RDS Proxy | Auth Proxy / pgbouncer | pgbouncer (Flexible) |
| Fila | SQS | Pub/Sub | Service Bus |
| Object storage | S3 | Cloud Storage | Blob |
| Secrets | Secrets Manager | Secret Manager | Key Vault |
| CDN + estático | CloudFront + S3 | Cloud CDN + GCS | Front Door + Blob |
| LLM (Claude) | Bedrock | Vertex AI | (API Anthropic direta) |
| E-mail | SES | (SendGrid/Mailgun) | Communication Services |
| **Região Brasil** | sa-east-1 (SP) | southamerica-east1 (SP) | Brazil South (SP) |

## 5. Topologia de implantação

```mermaid
flowchart TB
    U([Usuário])
    PNCP[(PNCP API)]
    LLM[[Claude]]
    MAIL[[E-mail]]
    subgraph Nuvem[Nuvem · região Brasil]
      CDN[CDN + estático · Web App]
      GW[API Gateway / WAF]
      subgraph Privada[Sub-rede privada · sem acesso público]
        API[API/BFF · container]
        ING[Ingestão · serverless agendado]
        WRK[Matching/Notificação · serverless]
        TRI[Triagem IA · container pool]
      end
      subgraph Gerenciado[Serviços gerenciados]
        DB[(Postgres + pool)]
        Q[[Fila]]
        OBJ[(Object storage)]
        SEC[(Secrets)]
      end
    end
    U --> CDN
    U --> GW --> API
    ING -->|egress allowlist| PNCP
    ING --> DB
    ING --> OBJ
    ING --> Q
    Q --> WRK
    Q --> TRI
    API --> DB
    API --> SEC
    TRI -->|egress allowlist| LLM
    WRK --> MAIL
```

Pontos de segurança embutidos: workers e banco em **sub-rede privada** (sem IP público); **egress allowlist** nas saídas para PNCP e LLM (defesa de SSRF, P-58); WAF/gateway na borda (P-55).

## 6. Ambientes, IaC e CI/CD

- **Ambientes separados** dev / staging / prod (documento 05, §4) — isolados em contas/projetos distintos.
- **IaC** (Terraform ou Pulumi) — toda infra versionada e reproduzível; nada clicado no console (P-65).
- **CI/CD** com os gates já definidos: qualidade (10), stress (A04/A05) e **segurança** (A07 — crítico/alto bloqueia, P-63).
- Imagens de container escaneadas (P-56); segredos vêm do cofre, nunca do pipeline.

## 7. Rede e residência de dados

- **Região Brasil** por padrão (latência + residência LGPD, P-28) — todos os três provedores têm região em SP.
- O ponto sensível é o **LLM**: a API direta da Anthropic pode processar fora do Brasil; via **Bedrock/Vertex** há mais controle de região e o provedor de nuvem entra como sub-operador com DPA — decisão de P-54/P-66. Reforça **não enviar a classe crítica** ao LLM.
- Sub-redes privadas, egress allowlist, sem banco público (§5, liga segurança A07).

## 8. Custo

Pay-per-use do serverless favorece o MVP (volume baixo/bursty; ingestão ociosa custa ~zero). Os custos de base são os **gerenciados** (Postgres, storage) e, sobretudo, o **LLM** — que é guardrail de unidade econômica (P-20, documento 08, §4), não linha de infra comum. *Scale-to-zero* onde der (ingestão, health); pool com teto na triagem.

## 9. Linguagem por tier (deriva do compute)

O modelo de compute (§2) **decide a linguagem**. O gargalo é sempre externo — PNCP, Claude, Postgres — e o trabalho é **I/O-bound**; logo a linguagem da app não é o teto de throughput. O que discrimina é ergonomia com a SPA, riqueza do SDK do LLM e o **cold start** dos workers serverless (que o [A09](09-teste-de-elasticidade-infra.md) vai medir).

A topologia deste doc espalha os workloads por **três modelos de compute**: estático/edge (SPA), container long-running (API/BFF, Triagem-pool) e **função serverless com cold start** (ingestão, matching, notificação, health). A linguagem que cobre os três com suporte de 1ª classe é uma só:

**MVP: TypeScript, linguagem única, um deploy** (monólito modular, [A01 §2](01-visao-arquitetural.md)). É a única que é ao mesmo tempo a linguagem nativa da SPA, roda como container quente (BFF, Triagem) **e** é runtime serverless de cold start baixo (Lambda/Cloud Functions/Run) para os workers bursty. Reforços: SDK Anthropic de 1ª classe na Triagem ([A03 §6](03-desenho-da-solucao.md)); SQL tipado/parametrizado contra SQLi ([AB8](07-teste-de-seguranca.md)); Zod na validação de borda/ACL ([A02 §4](02-ingestao-pncp.md)).

| Tier | Compute (§2) | Linguagem |
|------|--------------|-----------|
| SPA | CDN/edge | **TypeScript** |
| API/BFF | container quente | **TypeScript** (pareia tipos com a SPA) |
| Triagem/IA | container pool | **TypeScript** (Python se OCR/eval exigir) |
| Ingestão / Matching / Notificação | **serverless** | **TS no MVP → Go no seam** (melhor cold start + imagem mínima/CVE no tier exposto a SSRF, [AB7](07-teste-de-seguranca.md)) |
| Eval de IA (offline) | CI | **Python** ([P-18](../docs/98-decisoes-e-pendencias.md)) |

**Consequência da escolha serverless (§2):** ela **desfavorece JVM/.NET** como linguagem única — cold start de segundos nas funções bursty sem GraalVM/SnapStart (complexidade que não se paga no MVP). E **eleva Go** ao runtime infra-ótimo do tier serverless de ingestão/matching *quando* o seam de [doc 13 §6](../docs/13-dominios-e-bounded-contexts.md) abrir — gatilho **medido** pelo [A09](09-teste-de-elasticidade-infra.md) + volume real do PNCP ([P-31](../docs/98-decisoes-e-pendencias.md)), não decisão de hoje. Do ponto de vista de infra, **Python é o mais fraco no fabric** de workers (cold start e imagem maiores, sem tipos com a SPA) e fica escopado a OCR/eval. Decisão registrada em P-27.

## 10. O que NÃO usar agora (e por quê)

Tão importante quanto o que usar:

- **Kubernetes** — overhead operacional que um time em concepção não justifica; container gerenciado (Cloud Run/Fargate) entrega 90% do valor com 10% da operação. Revisitar só com escala/organização que exijam.
- **VM crua** — reintroduz patching, hardening e escala manual que os gerenciados removem.
- **Multi-cloud ativo** — complexidade dupla sem retorno no MVP; a portabilidade (§4) é *seguro*, não estratégia de rodar em dois ao mesmo tempo.
- **Postgres/fila auto-hospedados** — operar estado é onde mais se erra em segurança e disponibilidade.

## 11. Pendências

- Runtime/linguagem: proposta **TS-first** com seam para Go (§9) — confirmar com o time. `[A VALIDAR]` → P-27
- Confirmar provedor e o modelo de compute por workload (§§2,4). `[A VALIDAR]` → P-27, P-64
- Região e residência de dados, incl. o LLM (§7). `[A VALIDAR]` → P-28, P-66
- IaC + ambientes + pipeline CI/CD (§6). `[A VALIDAR]` → P-65

Rastreadas em [../docs/98](../docs/98-decisoes-e-pendencias.md).
