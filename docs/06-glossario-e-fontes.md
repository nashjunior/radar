# 06 · Glossário e Fontes

## Glossário do domínio

**Licitação** — Procedimento administrativo pelo qual a Administração Pública seleciona a proposta mais vantajosa para um contrato.

**Edital** — Documento que rege uma licitação: objeto, requisitos de habilitação, prazos, critério de julgamento e condições.

**Alerta de prazo crítico** — Alerta imediato de edital que casa com os critérios do usuário e cujo prazo final conhecido está em até 3 dias corridos. Não espera digest e tem regra dura de zero alertas perdidos.

**PNCP (Portal Nacional de Contratações Públicas)** — Sítio oficial de divulgação centralizada e obrigatória dos atos exigidos pela Lei 14.133/2021 (art. 174). Fonte âncora do produto.

**Modalidade** — Forma do procedimento licitatório. Na Lei 14.133: pregão, concorrência, concurso, leilão e diálogo competitivo.

**Pregão** — Modalidade preferencial para bens e serviços comuns; usualmente eletrônico.

**Diálogo competitivo** — Modalidade nova da Lei 14.133 para contratações complexas, com diálogo prévio entre a Administração e licitantes pré-selecionados.

**Habilitação** — Verificação da documentação (jurídica, fiscal, técnica, econômica) do licitante. Na Lei 14.133 ocorre, em regra, **após** o julgamento.

**Julgamento** — Classificação das propostas conforme o critério do edital.

**Homologação** — Ato da autoridade que confirma o resultado da licitação.

**PCA (Plano de Contratações Anual)** — Planejamento anual de contratações do órgão; pode antecipar oportunidades.

**LGPD** — Lei Geral de Proteção de Dados (Lei 13.709/2018).

**ANPD** — Autoridade Nacional de Proteção de Dados.

**LAI** — Lei de Acesso à Informação (Lei 12.527/2011).

**LIA (Legitimate Interest Assessment)** — Avaliação que justifica o uso da base legal de legítimo interesse sob a LGPD.

**Web scraping** — Coleta automatizada de dados de páginas web. Considerada tratamento de dados sujeito à LGPD (ANPD, Radar Tecnológico nº 3).

**Multi-tenant** — Arquitetura em que uma instância serve vários clientes com dados segregados.

**Proveniência** — Metadado que registra origem, data e base legal de um dado.

**Assinatura** — Contrato recorrente do Tenant com o Radar: plano comercial, ciclo, status e cota. É agregado **nosso** (docs 13, §3), distinto do objeto que o gateway de pagamento mantém do seu lado. Não confundir com a assinatura eletrônica de propostas nos portais — que está **fora de escopo** (docs 01, §6).

**Plano (comercial)** — Nível de contratação do SaaS (preço + cota + limites). Termo **sobrecarregado**: em contexto de licitação, "plano" é o **PCA** (acima). Nos documentos de billing, escreva sempre *plano comercial* ou *plano de assinatura*.

**Cota de triagens** — Quantidade de triagens que o plano comercial dá ao Tenant no ciclo. É a métrica de valor do produto (docs 09, §6.1) e a unidade que o gate de entitlement protege. ⚠️ **Colisão:** não confundir com a *cota do provedor* de nuvem (arq/09, P-68) nem com a **cota reservada ME/EPP** da Lei 14.133/2021 (art. 48) — esta última é linguagem do domínio de licitações e, se entrar, entra em Matching/Triagem, nunca em Cobrança (docs 13, §3).

**Reserva de cota** — Débito **síncrono** de 1 unidade da cota, feito na borda **antes** de aceitar a triagem (a triagem é assíncrona; esperar o resultado para contar deixaria um *burst* estourar a cota). Reserva é **gate**, não fatura: se a triagem falha, a reserva é liberada e nada é cobrado (docs 98, P-107).

**Uso confirmado (faturável)** — Reserva que virou linha de fatura ao chegar o evento `triagem.concluida`. Reserva ≠ uso confirmado: só o segundo é cobrável. A linha (`RegistroDeUso`) **só nasce confirmada** — a reserva vive num contador da `Assinatura`, não numa linha de uso.

**RegistroDeUso × RegistroUsoLlm** — ⚠️ **Colisão de contextos.** `RegistroDeUso` (**Cobrança**) é a **unidade faturável**: uma triagem concluída, sempre atribuível a um Tenant. `RegistroUsoLlm`/`UsoLlmLedger` (**Triagem**, já em código — RAD-230/P-20/P-38) é o **custo de uma chamada de LLM**, com `tenantId` **anulável** de propósito, porque a pré-extração do catálogo global (P-92) não é atribuível a tenant. Um serve para **cobrar do cliente**, o outro para **medir o nosso custo**; não se somam nem se reconciliam. Onde P-107 (alínea b) fala em *"ledger de uso"*, é o **de LLM**.

**Ciclo (de faturamento)** — Janela mensal em que a cota vale e o uso é somado; fecha na renovação.

**Carência** — Prazo em que a Assinatura segue **ativa** apesar de pagamento falho, enquanto rodam as retentativas (*dunning*), antes de suspender. É política **nossa**, no agregado — não do gateway (docs 13, §3).

## Fontes consultadas

Legislação e órgãos oficiais:

- Lei nº 14.133/2021 — texto na íntegra (Planalto): https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14133.htm
- Nova Lei de Licitações — Portal de Compras do Governo Federal: https://www.gov.br/compras/pt-br/nllc
- Nova Lei de Licitações — Ministério Público da União: https://www.mpu.mp.br/contratacoes
- PNCP — Editais: https://pncp.gov.br/app/editais
- PNCP — Dados Abertos: https://www.gov.br/pncp/pt-br/acesso-a-informacao/dados-abertos
- PNCP — API de Consulta (Swagger): https://pncp.gov.br/api/consulta/swagger-ui/index.html
- Compras.gov.br — Dados Abertos: https://www.gov.br/compras/pt-br/cidadao/compras-publicas-dados-abertos
- API Compras.gov.br (Swagger): https://dadosabertos.compras.gov.br/swagger-ui/index.html
- Decreto nº 12.343/2024 (atualização de valores para 2025) — Observatório da Nova Lei de Licitações: https://www.novaleilicitacao.com.br/2025/01/03/decreto-atualiza-valores-da-lei-de-licitacoes-e-contratos-administrativos/
- TCU — Divulgação do edital: https://licitacoesecontratos.tcu.gov.br/5-1-divulgacao-do-edital/

Proteção de dados / LGPD:

- Lei nº 13.709/2018 (LGPD) — texto compilado (Planalto): https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/L13709compilado.htm
- ANPD — Titular de Dados: https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados-1
- ANPD — Guia orientativo para definições dos agentes de tratamento de dados pessoais e do encarregado: https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia-orientativo-para-definicoes-dos-agentes-de-tratamento-de-dados-pessoais-e-do-encarregado
- ANPD — Regulamentações, incluindo Resolução CD/ANPD nº 18/2024 sobre atuação do encarregado: https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd
- ANPD — Radar Tecnológico nº 3 sobre IA generativa e web scraping: https://www.gov.br/anpd/pt-br/assuntos/noticias/ia-generativa-e-tema-do-3o-volume-da-serie-radar-tecnologico-da-anpd
- ANPD alerta que web scraping de dados pessoais está sujeito à LGPD (Radar Tecnológico nº 3): https://www.tabnews.com.br/NewsletterOficial/anpd-alerta-que-web-scraping-de-dados-pessoais-viola-lgpd
- ANPD — Transferência Internacional de Dados (Regulamento; Res. CD/ANPD nº 19/2024 — cláusulas-padrão contratuais e demais mecanismos do art. 33 da LGPD; Resolução CD/ANPD nº 32/2026 — reconhecimento de adequação da União Europeia): https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd
- LGPD e contratações públicas — Blog da Zênite: https://zenite.blog.br/lei-geral-de-protecao-de-dados-e-contratacoes-publicas/
- Web scraping e LGPD: riscos jurídicos do uso de dados públicos: https://assisemendes.com.br/web-scraping-e-lgpd-riscos-juridicos-do-uso-de-dados-publicos/
- A obrigatoriedade da publicação no PNCP — Migalhas: https://www.migalhas.com.br/depeso/377927/a-obrigatoriedade-da-publicacao-dos-instrumentos-da-licitacao-no-pncp

Nuvem e sub-operador do LLM (Amazon Bedrock — P-54/P-66):

- AWS — Data Privacy Center e Data Processing Addendum (DPA): https://aws.amazon.com/compliance/data-privacy/
- AWS — Lei Geral de Proteção de Dados do Brasil (LGPD): https://aws.amazon.com/compliance/brazil-data-privacy/
- Amazon Bedrock — Pricing (batch inference a 50% abaixo do on-demand para modelos selecionados): https://aws.amazon.com/bedrock/pricing/
- Amazon Bedrock — Batch inference (S3/JSONL, `CreateModelInvocationJob`): https://docs.aws.amazon.com/bedrock/latest/userguide/batch-inference.html
- Amazon Bedrock — Data protection (retenção configurável, zero-retention por policy): https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html
- Amazon Bedrock — Cross-region inference (roteamento geográfico da inferência / residência): https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html

Gateway de pagamento (Asaas — P-107(a)):

- Asaas — IPs oficiais (allowlist da borda do webhook): https://docs.asaas.com/docs/ips-oficiais-do-asaas
- Asaas — Atualizar webhook existente (`PUT /v3/webhooks/{id}`; `authToken` de 32–255 caracteres é definido por nós, logo reemissível por API): https://docs.asaas.com/reference/atualizar-webhook-existente
- Asaas — Gerenciamento das chaves de API de subcontas (criação/revogação programática existe **só** para subcontas pela conta-pai, com whitelist de IP e habilitação manual de 2h; a chave da conta principal só sai/entra pelo painel): https://docs.asaas.com/docs/gerenciamento-de-chaves-de-api-de-subcontas
- Asaas — Fila de sincronização do webhook: 15 falhas consecutivas interrompem a fila; eventos ficam retidos e os mais antigos são descartados após 14 dias; reativação pelo painel ou por `interrupted: false` na API: https://docs.asaas.com/docs/como-reativar-fila-interrompida

> As fontes secundárias (blogs jurídicos, portais especializados) foram usadas para contexto e interpretação. Toda decisão de conformidade deve se ancorar nos textos legais oficiais e em parecer jurídico próprio. Itens marcados `[A VALIDAR]` ao longo da documentação dependem dessa validação.
