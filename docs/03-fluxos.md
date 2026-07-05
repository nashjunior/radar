# 03 · Fluxos do Produto

> Fluxos de sistema e de usuário na fase de concepção. Diagramas em Mermaid renderizam no GitHub e em visualizadores compatíveis. Controles de segurança citados aqui estão detalhados no documento 05.

## 1. Arquitetura de fluxo em alto nível

O produto é, em essência, uma esteira que vai da **fonte pública** ao **acionamento do usuário**, com quatro estágios que espelham os quatro módulos.

```mermaid
flowchart LR
    subgraph Fontes
      PNCP[(PNCP<br/>API pública)]
      CGOV[(Compras.gov.br)]
      OUTROS[(Portais estaduais/<br/>municipais)]
    end
    PNCP --> ING
    CGOV --> ING
    OUTROS --> ING
    subgraph Radar
      ING[1· Ingestão &<br/>Normalização] --> STORE[(Base<br/>normalizada)]
      STORE --> MATCH[1· Matching &<br/>Alerta]
      STORE --> TRIAGEM[2· Análise &<br/>Triagem]
      STORE --> INTEL[4· Inteligência<br/>de mercado]
      MATCH --> GESTAO[3· Gestão da<br/>participação]
      TRIAGEM --> GESTAO
    end
    MATCH --> USER((Usuário))
    TRIAGEM --> USER
    GESTAO --> USER
    INTEL --> USER
```

Cada seta que cruza a fronteira "Fontes → Radar" é um ponto de controle legal (base LGPD + termos de uso) e de segurança (validação de entrada). Cada seta "Radar → Usuário" é um ponto de controle de acesso (o usuário só vê o que lhe pertence).

## 2. Fluxo de sistema — Ingestão e normalização (Módulo 1)

Este é o fluxo mais crítico para conformidade, porque é onde dados de terceiros entram no sistema.

```mermaid
flowchart TD
    A[Agendador dispara coleta] --> B{Fonte tem<br/>API oficial?}
    B -->|Sim| C[Consumir API pública<br/>com paginação e rate-limit]
    B -->|Não| D{Termos permitem<br/>coleta + base legal OK?}
    D -->|Não| X[Não coletar ·<br/>registrar bloqueio]
    D -->|Sim| E[Coleta controlada]
    C --> F[Validar & de-duplicar]
    E --> F
    F --> G[Minimização:<br/>descartar/anonimizar<br/>dado pessoal desnecessário]
    G --> H[Normalizar para<br/>schema canônico]
    H --> I[(Base normalizada)]
    I --> J[Registrar proveniência:<br/>fonte, timestamp, base legal]
```

Pontos-chave: a preferência por API oficial (documento 02, §4) é uma decisão do próprio fluxo; a **minimização acontece antes da persistência**, não depois; e cada registro carrega sua **proveniência** (de onde veio, quando, sob qual base legal) — essencial para auditoria e para atender direitos do titular.

## 3. Fluxo de usuário — Configuração de radar e alerta (Módulo 1)

```mermaid
flowchart TD
    A[Usuário define critérios:<br/>ramo, região, valor,<br/>palavras-chave, órgão] --> B[Sistema salva perfil<br/>de monitoramento]
    B --> C[Motor de matching cruza<br/>novos editais x critérios]
    C --> D{Casou?}
    D -->|Não| C
    D -->|Sim| E[Gerar alerta com<br/>link para o edital-fonte]
    E --> F[Notificar<br/>e-mail / app / etc.]
    F --> G[Usuário revisa]
    G --> H{Relevante?}
    H -->|Sim| I[Enviar para Triagem ·<br/>feedback melhora matching]
    H -->|Não| J[Descartar ·<br/>feedback melhora matching]
```

O laço de *feedback* (relevante/não relevante) é o que faz o matching melhorar com o tempo e é uma métrica de sucesso (documento 01, §7).

## 4. Fluxo de usuário — Triagem de edital (Módulo 2)

```mermaid
flowchart TD
    A[Edital selecionado] --> B[Extrair objeto, requisitos<br/>de habilitação, prazos, valores]
    B --> C[Cruzar requisitos x<br/>perfil/documentos da empresa]
    C --> D[Calcular aderência<br/>e sinalizar riscos]
    D --> E[Apresentar resumo<br/>go / no-go ao usuário]
    E --> F{Decisão do usuário}
    F -->|Participar| G[Criar caso no<br/>módulo de Gestão]
    F -->|Não participar| H[Arquivar com motivo]
```

Aqui a extração automática pode errar (risco de qualidade de dados, documento 01, §8). Por isso o produto **apresenta e sugere**, mas a decisão go/no-go é sempre do usuário, e o resumo sempre linka o trecho-fonte do edital para conferência.

## 5. Fluxo de usuário — Gestão da participação (Módulo 3)

```mermaid
flowchart LR
    NEW[Novo caso] --> PREP[Preparando<br/>proposta/documentos]
    PREP --> SUBM[Proposta<br/>apresentada]
    SUBM --> JULG[Em julgamento]
    JULG --> HAB[Habilitação]
    HAB --> REC[Recursos]
    REC --> RES{Resultado}
    RES --> WON[Vencido/Homologado]
    RES --> LOST[Não classificado]
    PREP -.prazo.-> ALERTA[Lembretes de prazo]
    SUBM -.prazo.-> ALERTA
    JULG -.prazo.-> ALERTA
    HAB -.prazo.-> ALERTA
    REC -.prazo.-> ALERTA
```

Os estados espelham as fases legais da Lei 14.133 (ver documento 04 para o mapeamento formal). O motor de prazos é a funcionalidade que mais reduz risco operacional do usuário.

## 6. Fluxo de dados — Inteligência de mercado (Módulo 4)

```mermaid
flowchart TD
    A[(Base normalizada +<br/>resultados históricos)] --> B[Agregar por órgão,<br/>objeto, fornecedor, valor]
    B --> C[Calcular preços de referência,<br/>frequência, taxa de disputa]
    C --> D[Dashboards e consultas]
    D --> E[Usuário consulta para<br/>precificar e decidir]
```

Este módulo trabalha majoritariamente com **dados agregados**, o que é favorável à LGPD: agregação e anonimização reduzem o risco de tratamento de dado pessoal. Onde houver identificação de pessoa física, valem as regras do documento 02.

## 7. Fontes de dados (insumo do Módulo 1)

| Fonte | Tipo de acesso | Papel no produto |
|-------|----------------|------------------|
| **PNCP** — Portal Nacional de Contratações Públicas | APIs públicas de consulta (sem login) + dados abertos | Fonte âncora; publicação obrigatória por lei |
| **Compras.gov.br / Comprasnet** (federal) | API de dados abertos (Swagger) | Complementa dados federais e resultados |
| **Portais estaduais / municipais / privados credenciados** | Heterogêneo (API ou HTML) | Cobertura ampliada; entram só após checklist do doc 02, §6 |

Notas técnicas observadas nas fontes oficiais: as APIs do PNCP e do Compras.gov.br retornam **JSON**, usam **paginação** (total de registros, total de páginas, página atual) e o acesso de **consulta é público**; apenas as APIs de manutenção exigem autenticação — irrelevantes para o Radar. O design da ingestão deve respeitar paginação e aplicar *rate-limiting* educado para não sobrecarregar as fontes.

## 8. Onde a segurança entra em cada fluxo

Cada fluxo acima tem um controle de segurança correspondente no documento 05: a ingestão (§2) exige validação de entrada e registro de proveniência; a configuração de alertas (§3) e a gestão (§5) exigem controle de acesso por usuário/cliente; a inteligência (§6) exige agregação/anonimização. Nenhum fluxo é considerado "pronto" sem seu par de controle.
