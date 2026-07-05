# Radar de Licitações — Documentação do Projeto

> Documentação de concepção (v0.2) · Estágio: **Concepção** · Última atualização: 2026-07-04

Este é o índice da documentação fundacional do **Radar de Licitações**, uma plataforma que monitora, analisa e apoia a participação de organizações em licitações públicas no Brasil. Os documentos abaixo formam a base de referência para produto, engenharia, jurídico e negócio.

## Índice

| # | Documento | O que cobre |
|---|-----------|-------------|
| 01 | [Visão e Escopo](01-visao-e-escopo.md) | Problema, personas, proposta de valor, escopo dos 4 módulos, o que está dentro/fora, riscos |
| 02 | [Marco Legal e Conformidade](02-marco-legal.md) | Lei 14.133/2021, PNCP, LGPD, LAI, obrigações e implicações para o produto |
| 03 | [Fluxos do Produto](03-fluxos.md) | Fluxos de usuário e de sistema (ingestão, alerta, triagem, participação, inteligência) |
| 04 | [Fluxos conforme a Lei](04-fluxos-conforme-lei.md) | Fluxos do produto mapeados às fases legais da licitação |
| 05 | [Segurança e Privacidade](05-seguranca-e-privacidade.md) | Segurança por design, LGPD by design, controles por camada |
| 06 | [Glossário e Fontes](06-glossario-e-fontes.md) | Termos do domínio e fontes legais/técnicas citadas |
| 07 | [MVP e Roadmap](07-mvp-e-roadmap.md) | Recorte do MVP, walking skeleton, persona-alvo, Now/Next/Later, critérios de release |
| 08 | [Métricas de Sucesso](08-metricas.md) | North Star, árvore de métricas, alvos e guardrails |
| 09 | [Mercado, Posicionamento e Negócio](09-mercado-posicionamento-e-negocio.md) | Análise competitiva, posicionamento, diferenciação e modelo de negócio/pricing |
| 10 | [Módulo 2 — Análise e Triagem por IA](10-modulo-analise-ia.md) | Barra de qualidade, avaliação (eval), confiança/human-in-the-loop, modos de falha |
| 11 | [Módulo 1 — Matching e Cobertura](11-monitoramento-matching-e-cobertura.md) | Precisão × recall, cold-start, fadiga de alerta, priorização de fontes |
| 12 | [Modelo de Dados e Requisitos Não-Funcionais](12-modelo-de-dados-e-requisitos-nao-funcionais.md) | Entidades núcleo (ERD), atributos de primeira classe, NFRs/SLAs |
| 13 | [Domínios e Bounded Contexts (DDD)](13-dominios-e-bounded-contexts.md) | Subdomínios core/supporting/generic, bounded contexts, linguagem ubíqua, context map |
| 14 | [Casos de Uso (MVP)](14-casos-de-uso.md) | Use cases por bounded context, estilo Clean Arch (input/output/ports/erros/eventos) |
| 98 | [Decisões e Pendências](98-decisoes-e-pendencias.md) | Registro central dos `[A VALIDAR]` com dono, gate e status |

> 🏗️ A **arquitetura técnica do core do MVP** (deliverable do arquiteto, derivado do documento 07) está na pasta [`arquitetura/`](../arquitetura/00-README.md): visão arquitetural, ingestão de dados do PNCP e desenho da solução.

## Como ler

Se você tem 5 minutos, leia o documento 01 (Visão e Escopo). Se você é do jurídico, comece pelo 02 (e o §9, sobre os dados dos próprios usuários). Se você é de engenharia, os documentos 03, 05 e 12 são os mais relevantes. O documento 04 é a ponte entre o que o produto faz e o que a lei exige — leitura recomendada para produto e compliance. Para produto e negócio, veja 07 (MVP e roadmap), 08 (métricas) e 09 (mercado e posicionamento); o aprofundamento dos módulos está em 10 e 11. As pendências em aberto estão consolidadas no documento 98.

## Princípio transversal: segurança e conformidade não são um módulo funcional

Neste projeto, **segurança e conformidade legal são requisitos transversais**, não uma etapa final. Cada fluxo (documento 03) tem controles associados (documento 05), e cada funcionalidade nasce ancorada em uma base legal explícita (documento 02). Nenhuma decisão de produto que toque dados de terceiros ou fontes públicas deve avançar sem passar pela pergunta: *qual a base legal e qual o controle de segurança?* No desenho de domínio (documento 13), essa transversalidade se realiza como um **bounded context de suporte próprio — Governança & Conformidade — no padrão Open Host** (todo contexto publica proveniência/auditoria para ele), **não** como um *shared kernel* espalhado (o único Shared Kernel do sistema é o `tenantId`). "Módulo funcional" (os 4 do documento 01) e *bounded context* (documento 13) são **lentes distintas** — conformidade fica fora dos 4 módulos, mas tem modelo próprio; que no monólito modular esse contexto também vire um módulo de deploy (documento 13, §6) não contradiz isso.

## Estado do documento

Esta é uma **v0.2 de concepção**. Números de leis e obrigações foram verificados contra fontes oficiais (ver documento 06), mas decisões de arquitetura, endpoints e políticas específicas ainda são propostas a validar. Marcações `[A VALIDAR]` indicam pontos que dependem de decisão de negócio ou parecer jurídico — todas consolidadas, com dono e gate, no documento 98. A v0.2 acrescentou os documentos 07 a 14 (produto, negócio e engenharia, incluindo os casos de uso do MVP em 14) e o registro de pendências 98.
