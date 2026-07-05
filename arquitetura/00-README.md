# Arquitetura — Core do MVP · Radar de Licitações

> Documentação de arquitetura (v0.1) · Estágio: **Concepção técnica** · Última atualização: 2026-07-04
>
> Esta pasta é o **deliverable do arquiteto**: recebe o recorte de MVP definido pelo produto ([docs/07 · MVP e Roadmap](../docs/07-mvp-e-roadmap.md)) e o transforma em um desenho de solução. Escopo **restrito ao core do MVP** — a esteira PNCP → matching → alerta → triagem. Multi-tenant, Módulos 3/4 e fontes além do PNCP são *Next/Later* e aparecem só como pontos de evolução.

## Índice

| # | Documento | O que cobre |
|---|-----------|-------------|
| 01 | [Visão Arquitetural](01-visao-arquitetural.md) | Drivers arquiteturais, estilo, diagramas C4 (contexto e contêineres), stack proposta, topologia |
| 02 | [Ingestão de Dados do PNCP](02-ingestao-pncp.md) | Como pegar os dados do PNCP: API de Consulta, sincronização, pipeline de ingestão, resiliência e conformidade |
| 03 | [Desenho da Solução](03-desenho-da-solucao.md) | Fluxo ponta a ponta, contratos de eventos, modelo físico, matching e triagem, mapeamento aos NFRs |
| 04 | [Teste de Estresse e Falhas](04-teste-de-estresse-e-falhas.md) | Cenários de carga, o que medir, runbook de falhas e degradação graciosa |
| 05 | [Teste de Estresse do Banco](05-stress-test-banco.md) | Cenários de carga no PostgreSQL, índices/particionamento, runbook de falhas do banco |
| 06 | [Perfil de Estresse por Tabela](06-estresse-por-tabela.md) | Caracterização por tabela (quentes vs. frias), pontos de dor, o que não estressar |
| 07 | [Teste de Segurança](07-teste-de-seguranca.md) | Casos de abuso (IDOR, prompt-injection, SSRF...), método, gate de severidade |
| 08 | [Infraestrutura e Implantação](08-infraestrutura-e-implantacao.md) | Compute por workload (serverless/container/gerenciado), equivalentes por provedor, topologia, IaC |
| 09 | [Teste de Elasticidade da Infra](09-teste-de-elasticidade-infra.md) | Cold start, cotas do provedor, autoscale, pool na borda, custo sob carga, failover |
| 10 | [Padrões e Estrutura de Código](10-padroes-e-estrutura-de-codigo.md) | Clean Architecture (domain/application/infra), value objects, use cases, erros customizados, monorepo, gRPC cross-domain |
| 11 | [Segurança da IA](11-seguranca-da-ia.md) | Defesa contra injeção de prompt (direta/indireta), contexto mínimo, saída validada, sem agência excessiva |

## Como esta pasta se conecta à documentação de produto

A arquitetura **não reinventa** requisitos — ela realiza os que já estão em `docs/`:

| Vem de | O que impõe à arquitetura |
|--------|---------------------------|
| [docs/07 (MVP)](../docs/07-mvp-e-roadmap.md) | O recorte: só PNCP, single-tenant, esteira até o go/no-go |
| [docs/12 (Dados e NFRs)](../docs/12-modelo-de-dados-e-requisitos-nao-funcionais.md) | Entidades núcleo e os NFRs/SLAs numéricos que a arquitetura precisa atingir |
| [docs/05 (Segurança)](../docs/05-seguranca-e-privacidade.md) | Controles por camada, isolamento por tenant, auditabilidade |
| [docs/02 (Marco Legal)](../docs/02-marco-legal.md) | API oficial em vez de scraping; minimização e proveniência na ingestão |
| [docs/03 (Fluxos)](../docs/03-fluxos.md) | Os fluxos de sistema que a arquitetura instrumenta |
| [docs/10 (IA)](../docs/10-modulo-analise-ia.md) e [docs/11 (Matching)](../docs/11-monitoramento-matching-e-cobertura.md) | As regras de qualidade da triagem e do matching |

## Princípios arquiteturais

Derivados dos documentos acima — cada princípio tem origem rastreável:

1. **Fonte oficial, nunca scraping (no MVP).** A ingestão usa a API pública de consulta do PNCP; isso é decisão de arquitetura *e* de conformidade (docs/02, §4).
2. **Minimização e proveniência na entrada.** Dado pessoal desnecessário é descartado/anonimizado **antes** de persistir; todo registro carrega origem, timestamp e base legal (docs/03, §2 e docs/05, §5).
3. **Tenant-aware desde o dia 1.** Mesmo single-tenant no MVP, `tenantId` existe em toda entidade — migrar depois é caro (docs/12, §2).
4. **Desacoplado por eventos.** Ingestão, matching e triagem se comunicam por fila, não por chamada síncrona — resiliência e frescor (docs/12, NFRs).
5. **Degradação graciosa.** A queda de uma fonte ou da IA degrada função, não derruba o produto (docs/11, §7 e docs/10, §6).
6. **Custo de IA sob teto.** A triagem por IA é assíncrona e cacheada por edital; o custo por edital é guardrail da unidade econômica (docs/08, §4 e docs/10, §7).
7. **Auditável por padrão.** Todo acesso a dado pessoal e toda decisão automática deixam rastro (docs/05, §3).

## Convenções

Marcações `[A VALIDAR]` seguem a mesma convenção de `docs/`: pendências de arquitetura são consolidadas em [docs/98 · Decisões e Pendências](../docs/98-decisoes-e-pendencias.md) (itens P-26 em diante). A skill `auditar-docs` audita esta pasta **e** `docs/`, incluindo os cross-references entre elas.
