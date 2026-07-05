# 98 · Decisões e Pendências

> Registro central dos pontos `[A VALIDAR]` espalhados pela documentação. Cada marcação inline continua no seu documento; aqui ela ganha **dono sugerido**, **gate** (o momento em que precisa estar resolvida) e **status**. Transforma pendência solta em backlog acionável. Estágio: **Concepção**.
>
> Convenção: os itens `[A VALIDAR]` nos demais docs são a fonte da verdade; esta tabela é o índice. Ao resolver um item, atualize o documento de origem **e** o status aqui (a skill `auditar-docs` detecta divergências entre os dois).

## 1. Gates (quando cada coisa precisa estar resolvida)

```mermaid
flowchart LR
    G1[Pré-dev] --> G2[Pré-lançamento MVP]
    G2 --> G3[Pré-multi-tenant<br/>Next]
    G3 --> G4[Pré-GTM / comercial]
    G4 --> G5[Later]
```

## 2. Registro

| ID | Pendência | Origem | Tipo | Dono sugerido | Gate | Status |
|----|-----------|--------|------|---------------|------|--------|
| P-01 | Base legal LGPD (legítimo interesse) + LIA | 02 §4 | Jurídico | Jurídico | Pré-lançamento | Aberto |
| P-02 | Base legal e termos de uso por fonte (checklist de 3 perguntas) | 02 §6 | Jurídico+Produto | Jurídico | Por fonte | Aberto |
| P-03 | Encarregado/DPO designado + ROPA + política de privacidade do usuário | 02 §9 | Jurídico | Jurídico | Pré-lançamento | Aberto |
| P-04 | Controles de segurança por camada (validar a tabela proposta) | 05 §4 | Segurança+Eng | Eng | Pré-dev | Aberto |
| P-05 | Política de retenção — definir prazos por tipo de dado | 05 §5 | Jurídico+Eng | Eng | Pré-lançamento | Aberto |
| P-06 | Plano de resposta a incidentes | 05 §6 | Segurança+Jurídico | Segurança | Pré-lançamento | Aberto |
| P-07 | Arquitetura de isolamento multi-tenant | 05 §7 | Eng | Eng | Pré-multi-tenant | Aberto |
| P-08 | Cofre de segredos + provedor de identidade | 05 §7 | Eng | Eng | Pré-dev | Aberto |
| P-09 | Classificação de dados (esp. estratégia comercial do cliente) | 05 §9 | Segurança+Produto | Segurança | Pré-dev | Aberto |
| P-10 | Fase dirigida por dados vs. ordem fixa (inversão julg.→hab.) | 04 §4 | Eng+Produto | Produto | Pré-Módulo 3 | Aberto |
| P-11 | Observabilidade de PCA/plano de contratações (fase preparatória) | 04 §3 | Produto | Produto | Later | Aberto |
| P-12 | Persona primária do MVP (proposta: empresa fornecedora) + prioridade do Órgão público | 01 §3 / 07 §4 | Produto | Produto | Pré-dev | Proposta |
| P-13 | Revisão do escopo excluído (automação de submissão etc.) | 01 §6 | Produto+Jurídico | Produto | Later | Aberto |
| P-14 | Metas numéricas das métricas (frescor, cobertura, precisão) | 08 §3 | Produto+Eng | Produto | Pré-dev | Aberto |
| P-15 | Esquema de eventos de instrumentação | 08 §6 / 12 §5 | Eng | Eng | Pré-lançamento | Aberto |
| P-16 | Pesquisa primária de concorrentes (features, cobertura, preços) | 09 §2 | Negócio+Produto | Negócio | Pré-GTM | Aberto |
| P-17 | Modelo de pricing, planos e alavanca de cobrança | 09 §6 | Negócio | Negócio | Pré-GTM | Aberto |
| P-18 | Gold set rotulado + metas de qualidade da extração IA | 10 §5 | Produto+Eng | Produto | Pré-lançamento | Aberto |
| P-19 | Limiares de confiança por campo (IA) | 10 §4 | Eng | Eng | Pré-lançamento | Aberto |
| P-20 | Teto de custo de IA por edital (unidade econômica) | 10 §7 / 09 §6 | Eng+Negócio | Eng | Pré-lançamento | Aberto |
| P-21 | Limiares de recall/precisão do matching + política de digest | 11 §§2,4 | Produto | Produto | Pré-lançamento | Aberto |
| P-22 | Lista priorizada de fontes além do PNCP | 11 §6 / 07 | Produto | Produto | Pré-Next | Aberto |
| P-23 | Onboarding de cold-start e critérios sugeridos por segmento | 11 §3 | Produto | Produto | Pré-lançamento | Aberto |
| P-24 | Entidades/cardinalidades e números de NFR/SLA | 12 §§1,3 | Produto+Eng | Eng | Pré-dev | Aberto |
| P-25 | Corte single-tenant no MVP vs. expectativa de vender a consultorias cedo | 07 §8 / 09 §5 | Produto+Negócio | Produto | Pré-dev | Aberto |
| P-26 | Confirmar contratos da API de Consulta do PNCP (endpoints, parâmetros, códigos de modalidade) no Swagger | arq/02 §§2,3,8 | Eng | Eng | Pré-dev | Aberto |
| P-27 | Confirmar estilo (monólito modular), stack (Postgres, fila, storage, LLM) e **runtime/linguagem** | arq/01 §§2,5 / arq/08 §9 | Eng | Eng | Pré-dev | Proposta (arq/08 §9, 2026-07-05: **TS-first, linguagem única**; seam p/ **Go** no tier serverless de ingestão/matching acionado por A09 + P-31; **Python** só p/ OCR/eval) |
| P-28 | Região de hospedagem e residência de dados | arq/01 §5 | Eng+Jurídico | Eng | Pré-dev | Aberto |
| P-29 | Cadência de polling do PNCP que atinge frescor ≤ 30 min sem furar rate-limit | arq/02 §3 / 12 §3 | Eng | Eng | Pré-lançamento | Aberto |
| P-30 | Retenção de anexos (editais/PDFs) em object storage | arq/02 §6 / 05 §5 | Jurídico+Eng | Eng | Pré-lançamento | Aberto |
| P-31 | Medir volume/perfil de publicação do PNCP para definir cargas-alvo reais | arq/04 §3 | Eng+Produto | Eng | Pré-dev | Aberto |
| P-32 | Mock/fixtures do PNCP para stress test (não estressar a fonte real) | arq/04 §4 | Eng | Eng | Pré-lançamento | Aberto |
| P-33 | Ferramenta de teste de carga + ambiente isolado | arq/04 §4 | Eng | Eng | Pré-lançamento | Aberto |
| P-34 | Alarmes/SLO e limiares dos circuit breakers (fonte, LLM, custo) | arq/04 §§5,7 | Eng | Eng | Pré-lançamento | Aberto |
| P-35 | Runbook ligado ao plano de resposta a incidentes | arq/04 §8 / 05 §6 | Segurança+Eng | Segurança | Pré-lançamento | Aberto |
| P-36 | SLOs de experiência + error budget; SLO duro p/ "alerta de prazo crítico" (0 perdidos) | Validação PM / arq/04 | Produto+Eng | Produto | Pré-lançamento | Aberto |
| P-37 | Plano de comunicação ao usuário em degradação (status page, banner "triagem atrasada") | Validação PM / arq/04 §6 | Produto | Produto | Pré-lançamento | Aberto |
| P-38 | Alarme de custo de IA como guardrail de negócio (teto rígido + quem é acionado) | Validação PM / arq/04 §5 / 10 §7 | Negócio+Eng | Eng | Pré-lançamento | Aberto |
| P-39 | Estratégia de particionamento do banco (data e/ou tenant) + arquivamento | arq/05 §§3,8 | Eng | Eng | Pré-lançamento | Aberto |
| P-40 | Fan-out reverso do matching em escala (scan vs. percolator) | arq/05 §3 / 11 §5 | Eng | Eng | Pré-Next | Aberto |
| P-41 | Sizing de pool de conexões + statement_timeout/work_mem | arq/05 §6 | Eng | Eng | Pré-lançamento | Aberto |
| P-42 | Quando introduzir réplicas de leitura e o que roteia para elas | arq/05 §6 | Eng | Eng | Pré-Next | Aberto |
| P-43 | Validar limites de bounded context e linguagem ubíqua (Governança contexto vs shared kernel; local do Perfil de Habilitação) | 13 §7 | Produto+Eng | Eng | Pré-dev | Aberto |
| P-44 | Retenção/arquivamento das tabelas append-only e de alto crescimento (EDITAL, ALERTA, PROVENIENCIA, AUDIT_LOG) | arq/06 §§3,7 / 05 §5 | Eng+Jurídico | Eng | Pré-lançamento | Aberto |
| P-45 | **TRIAGEM: separar extração do edital (cacheável, 1 por edital) da aderência (por perfil)** | 12 §1 / A03 §§4,6 | Eng+Produto | Eng | Pré-lançamento | Resolvido (12/A03: EXTRACAO_EDITAL + TRIAGEM) |
| P-46 | Modelar `modalidade` como FK à tabela de domínio MODALIDADE (código PNCP), não string denormalizada | 12 §1 / A03 §4 | Eng | Eng | Pré-dev | Resolvido (12/A03: modalidadeCodigo FK) |
| P-47 | Incluir AUDIT_LOG e SolicitacaoDeTitular no modelo canônico (doc 12) — exigidos por 05 §3 e 13 | 12 §1 / 05 §3 / 13 | Eng+Jurídico | Eng | Pré-lançamento | Resolvido (doc 12) |
| P-48 | RESULTADO deve relacionar-se a EDITAL (mercado inteiro), não só a CASO | 12 §1 / 13 / 09 | Produto+Eng | Eng | Pré-Later | Aplicado (RESULTADO → EDITAL) `[A VALIDAR]` |
| P-49 | Segregação por CLIENTE_FINAL (clienteFinalId) além de tenantId, para consultorias | 12 §1 / A03 §4 / 01 §3 | Eng | Eng | Pré-Next | Aplicado no modelo `[A VALIDAR — ativar no Next]` |
| P-50 | Definir os campos do PERFIL_HABILITACAO (insumo do core Triagem) | 12 §1 / 10 §2 | Produto+Eng | Produto | Pré-lançamento | Resolvido (doc 12) |
| P-51 | **Autorização por objeto (anti-IDOR/BOLA): todo acesso confirma posse por tenant/clienteFinal, não só filtro de query — vetor nº1 de vazamento cross-tenant** | Sec / 05 §2 / A03 §8 | Segurança+Eng | Eng | Pré-lançamento | Aberto |
| P-52 | Modelo de autorização (RBAC): papéis (admin consultoria, operador, cliente-final read-only) e matriz de permissões | Sec / 05 §4 / 13 | Segurança+Produto | Produto | Pré-lançamento | Aberto |
| P-53 | Gestão de identidade: sessão/tokens (expiração, revogação), MFA, proteção brute-force, recuperação de conta segura | Sec / 05 §4 | Segurança+Eng | Eng | Pré-lançamento | Aberto |
| P-54 | **Dados enviados ao LLM: minimizar (não enviar a classe crítica/estratégia comercial), DPA com o provedor como sub-operador, residência** | Sec / 05 §9 / 10 / 02 §9 | Segurança+Jurídico | Segurança | Pré-lançamento | Aberto |
| P-55 | Segurança da API: WAF/gateway, rate-limit por tenant, headers (HSTS/CSP), CORS/CSRF, validação de schema, anti-mass-assignment | Sec / 05 §4 / A01 §7 | Segurança+Eng | Eng | Pré-lançamento | Aberto |
| P-56 | AppSec no CI + supply chain: SAST/DAST, secret scanning, SCA/SBOM, scan de imagem, cadência de pentest | Sec / 05 | Segurança+Eng | Eng | Pré-lançamento | Aberto |
| P-57 | Sub-processadores (contrato de tratamento) com LLM/e-mail/nuvem; e verificação de identidade do titular antes de atender SolicitacaoDeTitular | Sec / 02 §9 / 05 §5 | Jurídico+Segurança | Jurídico | Pré-lançamento | Aberto |
| P-58 | Segmentação de rede + egress allowlist + proteção SSRF na busca de anexos/URLs (ingestão) | Sec / 05 §4 / A02 §6 | Segurança+Eng | Eng | Pré-lançamento | Aberto |
| P-59 | Criptografia em nível de campo/aplicação para a classe crítica (estratégia comercial), além do isolamento | Sec / 05 §9 | Segurança+Eng | Eng | Pré-lançamento | Aberto |
| P-60 | Segurança de backup: criptografia, imutabilidade (anti-ransomware), teste de restauração, RTO/RPO | Sec / 05 §6 / A05 §6 | Segurança+Eng | Eng | Pré-lançamento | Aberto |
| P-61 | Higiene de logs (sem PII/segredos) + SIEM/alertas de eventos de segurança + integridade do audit log | Sec / 05 §3 / A04 §8 | Segurança+Eng | Eng | Pré-lançamento | Aberto |
| P-62 | Teste contínuo de isolamento de tenant (autorização) como gate de release, já no MVP single-tenant | Sec / 05 §2 / 07 §6 | Segurança+Eng | Eng | Pré-lançamento | Aberto |
| P-63 | Gate de severidade (bloquear release em crítico/alto) e SLA de correção de vulnerabilidade | Sec / arq/07 §4 | Segurança+Eng | Eng | Pré-lançamento | Aberto |
| P-64 | Modelo de compute por workload (serverless/glue vs container/pool vs gerenciado) confirmado | arq/08 §§2,4 | Eng | Eng | Pré-dev | Aberto |
| P-65 | IaC (Terraform/Pulumi) + ambientes dev/staging/prod + pipeline CI/CD | arq/08 §6 | Eng | Eng | Pré-dev | Aberto |
| P-66 | LLM: API direta Anthropic vs via nuvem (Bedrock/Vertex) para residência/DPA (liga P-54) | arq/08 §7 / 05 §9 | Segurança+Eng | Eng | Pré-lançamento | Aberto |
| P-67 | Cold start vs frescor: provisioned concurrency / min instances (trade-off de custo) | arq/09 EL1 | Eng | Eng | Pré-lançamento | Aberto |
| P-68 | Mapear cotas/limites do provedor (concorrência, fila, API GW) + pedidos de aumento | arq/09 EL2 | Eng | Eng | Pré-lançamento | Aberto |
| P-69 | Tooling do monorepo (workspaces, build, imposição de boundary entre camadas/contextos) | arq/10 §§2,7 | Eng | Eng | Pré-dev | Aberto |
| P-70 | Geração de stubs a partir do proto (contracts) por linguagem no CI | arq/10 §5 | Eng | Eng | Pré-dev | Aberto |
| P-71 | Padrão de mapeamento DomainError → gRPC/HTTP na borda, sem vazar stack/PII | arq/10 §6 / arq/07 AB11 | Eng+Segurança | Eng | Pré-lançamento | Aberto |
| P-72 | Conjunto de editais adversariais (payloads de prompt injection) + red-team no CI | arq/11 §4 / arq/07 AB4 | Segurança+Eng | Eng | Pré-lançamento | Aberto |
| P-73 | Schema de validação da saída do LLM + sanitização de saída (insecure output handling) | arq/11 §2 / arq/07 AB6 | Eng+Segurança | Eng | Pré-lançamento | Aberto |

> As origens `arq/NN` referem-se à pasta [`arquitetura/`](../arquitetura/00-README.md) (deliverable do arquiteto).

## 3. Como usar este registro

- **Ao resolver:** remova/edite o `[A VALIDAR]` no documento de origem e mova o status aqui para *Resolvido*, com uma linha de decisão (data + o que foi decidido).
- **Ao criar novo `[A VALIDAR]`:** adicione uma linha aqui com origem e gate.
- **Auditoria periódica:** rodar a skill `auditar-docs` para pegar itens resolvidos num doc mas ainda abertos em outro (e vice-versa).
