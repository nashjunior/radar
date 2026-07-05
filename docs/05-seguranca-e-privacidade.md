# 05 · Segurança e Privacidade

> Segurança e privacidade são requisitos **transversais** do Radar, não uma etapa final. Este documento define os princípios e os controles por camada, ligando-os aos fluxos do documento 03 e às obrigações do documento 02.

## 1. Por que segurança é central neste produto

O Radar concentra a **estratégia comercial de participação** de seus usuários: quais licitações uma empresa vai disputar, com que preço, quais são suas forças e fraquezas de habilitação. No cenário multi-cliente das consultorias, uma mesma instância guarda dados de concorrentes entre si. Um vazamento não seria apenas um incidente de privacidade — seria a exposição da inteligência competitiva dos clientes. Isso eleva a segurança de "boa prática" a **requisito de sobrevivência do negócio**.

Some-se a isso o risco regulatório: como o produto trata dados pessoais de fontes públicas sob a LGPD (documento 02, §4), uma falha de segurança pode configurar incidente reportável à ANPD.

## 2. Modelo de ameaças (visão inicial)

Os vetores mais relevantes nesta fase de concepção:

**Acesso indevido entre clientes (multi-tenant leakage).** O cliente A não pode, em hipótese alguma, ver dados do cliente B. É a ameaça mais crítica para as consultorias.

**Exfiltração de dados.** A base concentra dados valiosos; credenciais comprometidas ou uma API mal protegida poderiam permitir extração em massa.

**Envenenamento de dados na ingestão.** O produto consome conteúdo de fontes externas (editais, HTML). Conteúdo malicioso pode tentar injeção (SQL, comandos, prompt injection na etapa de análise por IA do módulo 2).

**Abuso de credenciais de fontes.** Onde houver autenticação com portais, o vazamento dessas credenciais é um risco.

**Bloqueio/quebra de fontes.** Menos "segurança" e mais resiliência, mas relevante: perda de acesso a uma fonte degrada o produto.

## 3. Princípios de segurança do projeto

O projeto adota **security-by-design** e **privacy-by-design**, com quatro princípios que orientam decisões:

1. **Menor privilégio.** Cada componente e cada usuário acessam apenas o estritamente necessário.
2. **Minimização de dados.** Não coletar nem reter dado pessoal que não seja necessário à finalidade (também é exigência LGPD).
3. **Isolamento por tenant.** Segregação lógica rígida dos dados de cada cliente.
4. **Auditabilidade.** Todo acesso e todo tratamento de dado pessoal deixam rastro (quem, quando, o quê, sob qual base legal).

## 4. Controles por camada

Esta é a **linha de base decidida** (baseline) dos controles de segurança do projeto — não mais uma proposta. Cada controle carrega um **gate** (o momento em que precisa estar em pé, na convenção do doc 98, §1): **Pré-dev** (invariante arquitetural do dia 1, caro de retrofitar), **Pré-lançamento** (antes do go-live do MVP) e **Next** (endurecimento pós-MVP, aditivo). A prova de cada controle são os casos de abuso de [A07](../arquitetura/07-teste-de-seguranca.md) (`AB*`); cada linha remete à pendência que detalha e implementa o controle (P-51–P-63, P-07/P-08 no doc 98).

| Camada | Ameaça endereçada | Controles (baseline) | Gate | Prova / Pendência |
|--------|-------------------|----------------------|------|-------------------|
| **Ingestão** (Mód. 1) | Envenenamento, extrapolação LGPD | Validação/sanitização de entrada e de schema; queries parametrizadas; preferência por API oficial; minimização antes de persistir; registro de proveniência; rate-limiting educado com as fontes. **Egress allowlist + anti-SSRF** na busca de anexos/URLs | Pré-dev (validação, proveniência, minimização) · Pré-lançamento (SSRF/egress) | AB7, AB8 / P-58 |
| **Armazenamento** | Exfiltração | Criptografia em repouso; **escopo `tenantId`/`clienteFinalId` em toda entidade desde o dia 1** e segregação lógica por tenant; segredos em cofre (secrets manager), nunca no código; retenção mínima; criptografia de campo para a classe crítica | Pré-dev (escopo por tenant, segredos em cofre, cripto em repouso) · Pré-lançamento (retenção, cripto de campo) · Next (isolamento físico RLS) | AB1, AB12 / P-08, P-59, P-07 |
| **Trânsito** | Interceptação | TLS em todas as comunicações; sem tráfego de dado sensível em texto claro | Pré-dev | AB11 / — |
| **Aplicação / API** | Acesso indevido, abuso | **Autorização por objeto** (confirma posse por `tenantId`/`clienteFinalId` a cada acesso, não só filtro de query — anti-IDOR/BOLA); **identidade verificada na borda via IdP (token OIDC) — o `tenantId`/`clienteFinalId` vem de claim verificado do token, nunca de header controlado pelo cliente**; AuthN forte (MFA); RBAC por papel; rate-limit por tenant; WAF/gateway, headers (HSTS/CSP), CORS/CSRF, validação de schema, anti-mass-assignment; validação de saída para não vazar dado de outro tenant | Pré-dev (autorização por objeto + tenant derivado de claim verificado — invariantes nos use cases/borda) · Pré-lançamento (AuthN/MFA, RBAC, WAF/rate-limit/headers) | AB1, AB2, AB3, AB9 / P-51, P-52, P-53, P-55, P-08 |
| **Análise por IA** (Mód. 2) | Prompt injection via edital | Tratar conteúdo do edital como não confiável; separar instruções de dados; não executar conteúdo extraído; **classe crítica nunca vai ao LLM**; schema + sanitização da saída da IA | Pré-dev (edital-como-dado, separação instrução/dado) · Pré-lançamento (corpus adversarial, minimização ao LLM, sanitização de saída) | AB4, AB5, AB6 (A11) / P-54, P-72, P-73 |
| **Observabilidade** | Detecção tardia | **Audit log append-only/imutável e fail-closed** (`UPDATE`/`DELETE` negados; trava se a trilha não grava); trilha de acesso a dado pessoal; alertas de acesso anômalo; higiene de logs (sem PII/segredos) + SIEM | Pré-dev (audit log append-only/fail-closed — modelo AUDIT_LOG) · Pré-lançamento (SIEM, higiene de logs, alertas) | AB13 / P-61 |
| **Operação** | Erro humano, credenciais | Menor privilégio nos acessos internos; rotação de segredos; ambientes separados (dev/staging/prod); **verificação de identidade do titular antes de atender solicitação** | Pré-dev (ambientes separados, menor privilégio) · Pré-lançamento (rotação, verificação de titular) | AB10 / P-57 |

**Decisão (regra dura, não afrouxável).** Três invariantes são **Pré-dev** porque não se retrofitam sem reescrever o núcleo, e sustentam os casos de abuso críticos de A07 §5: (1) **autorização por objeto** + `tenantId`/`clienteFinalId` em toda entidade (sustenta **AB1**); (2) **audit log append-only/fail-closed** (sustenta **AB13**); (3) **edital como dado não-confiável** com instrução separada (sustenta **A11**/AB4). A **verificação de identidade do titular** (**AB10**) é obrigatória antes do go-live. O isolamento **físico** por RLS (P-07) é endurecimento **aditivo** no Next — ele **soma-se** à autorização por objeto, **nunca a substitui**: o baseline lógico vale desde o dia 1, mesmo single-tenant. Fechar P-04 **decide esta tabela**; a implementação e o teste de cada controle seguem nas pendências citadas.

## 5. Privacidade por design (LGPD na prática)

Os controles técnicos que materializam as obrigações do documento 02:

**Minimização na ingestão.** O ponto de decisão está no fluxo do documento 03, §2: dado pessoal desnecessário é descartado ou anonimizado **antes** de chegar à base. Quanto menos dado pessoal armazenado, menor a superfície de risco e de obrigação.

**Base legal e proveniência registradas.** Cada registro sabe de onde veio, quando e sob qual base legal foi tratado. Isso viabiliza auditoria e resposta a titulares.

**Atendimento a direitos do titular.** Existe um processo (e endpoints internos) para localizar, corrigir e eliminar dados pessoais de um titular mediante solicitação — exigência direta da LGPD.

**Política de retenção.** Dados são mantidos apenas pelo tempo necessário à finalidade; há prazos definidos e expurgo automático. `[A VALIDAR — definir prazos]`

**Agregação no módulo de inteligência.** O módulo 4 opera preferencialmente sobre dados agregados/anonimizados, reduzindo o tratamento de dado pessoal identificável.

## 6. Resposta a incidentes (esboço)

Mesmo em concepção, convém deixar o princípio registrado: se houver incidente de segurança com dado pessoal, a LGPD exige comunicação à ANPD e, quando aplicável, aos titulares, em prazo razoável. O projeto precisa, antes do lançamento, de um **plano de resposta a incidentes** com papéis definidos, canal de reporte e critérios de escalonamento. `[A VALIDAR — criar plano antes do go-live]`

## 7. O que fica pendente para as próximas fases

Este documento estabelece princípios e controles em nível de concepção. Antes de desenvolvimento avançado, precisam ser detalhados: a arquitetura concreta de isolamento multi-tenant (P-07), os prazos de retenção por tipo de dado, o LIA (avaliação de legítimo interesse) com o jurídico, e o plano de resposta a incidentes. Cada um desses itens é um `[A VALIDAR]` que deve virar tarefa própria no roadmap.

**Já decididos (P-08):** o **cofre de segredos** = **AWS Secrets Manager** (rotação nativa; segredo nunca em código) e o **provedor de identidade** = **Amazon Cognito** (User Pools, OIDC/JWT), com o `tenantId` derivado de **claim verificado do token na borda**, nunca de header do cliente (§4; [../arquitetura/08](../arquitetura/08-infraestrutura-e-implantacao.md) §§3,5,11). A **operação** de identidade — expiração/revogação de sessão, MFA obrigatório, proteção brute-force e recuperação de conta — segue em **P-53** (Pré-lançamento) sobre este mesmo IdP.

## 8. Regra de ouro do projeto

> Nenhuma funcionalidade que colete, armazene ou exponha dados avança sem responder a duas perguntas: **qual a base legal** (documento 02) e **qual o controle de segurança** (este documento). Segurança e conformidade não são revisão final — são pré-condição de cada fluxo.

## 9. Classificação de dados

O princípio de menor privilégio e o isolamento por tenant (§3) só operam bem se soubermos **o que** estamos protegendo. O Radar lida com níveis muito diferentes de sensibilidade — e o mais sensível não é o dado pessoal do edital, é a **estratégia comercial do cliente**:

Regra de classificação: quando um registro combinar mais de uma classe, prevalece a classe mais restritiva. Um edital é público como ato administrativo, mas trechos com CPF, e-mail pessoal ou dados de responsável técnico são **Pessoal de terceiro** e seguem minimização LGPD (documento 02, §4). Toda entidade persistida carrega `tenantId` desde o MVP single-tenant; no *Next* de consultorias, dados ligados a cliente acompanhado também carregam `clienteFinalId`.

| Classe | Exemplos | Base/finalidade | Manuseio obrigatório |
|--------|----------|-----------------|----------------------|
| **Público** | Metadados do PNCP, texto de edital sem dado pessoal, modalidade, órgão, prazos publicados | Transparência da licitação; LAI e PNCP (documento 02, §§3 e 5) | Registrar proveniência; preservar integridade; indexar para busca/matching; tratar conteúdo como não confiável na ingestão e na IA |
| **Pessoal de terceiro** | Nome, CPF, e-mail pessoal, telefone, responsável técnico ou sócio citado em edital/anexo | Base legal definida para tratamento de dado público; minimização obrigatória (documento 02, §4) | Coletar só o necessário; mascarar ou descartar CPF e contato pessoal sem utilidade para a decisão; registrar base legal/proveniência; não exibir em lista, alerta ou log quando não for necessário |
| **Conta do usuário** | Nome, e-mail corporativo, organização, credenciais, preferências de notificação, perfil de acesso | Execução de contrato e gestão da conta (documento 02, §9) | Criptografia em repouso; credenciais sempre armazenadas com hash ou geridas por provedor de identidade; acesso por papel e objeto; logs sem segredo; atendimento a direitos do titular |
| **Estratégia comercial do cliente** | Critérios de monitoramento, intenção de disputar, go/no-go, preço pretendido, aderência, forças/fraquezas de habilitação, histórico de participação e feedback | Execução do serviço contratado; inteligência competitiva do cliente (documento 02, §9) | Classe **crítica**: autorização por objeto em todo acesso; isolamento por `tenantId` e, quando aplicável, `clienteFinalId`; menor privilégio; auditoria de leitura e escrita; não enviar ao LLM nem a logs; exportação apenas por ação explícita de usuário autorizado |

A classe **crítica** é a razão de a segurança ser requisito de sobrevivência (§1): no cenário multi-cliente, ela concentra a inteligência competitiva de concorrentes numa mesma instância. Nenhum acesso a dado desta classe ocorre sem trilha de auditoria (§3, princípio 4). No MVP, mesmo com uma empresa por conta, a implementação já deve usar autorização por objeto para evitar vazamento cross-tenant; no *Next*, o mesmo controle se estende ao recorte por cliente-final.

Pendências relacionadas permanecem separadas: prazos de retenção por tipo de dado (P-05), RBAC detalhado (P-52), DPA/suboperadores e residência do LLM (P-54/P-66) e criptografia em nível de campo para a classe crítica (P-59).
