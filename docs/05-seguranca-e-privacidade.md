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

**Malware em anexo binário.** Os anexos/PDFs baixados do PNCP são arquivos binários **não confiáveis**: podem carregar malware que infecta quem baixa/abre, ou ser servidos ao browser/OCR sem verificação. É ameaça **distinta** da injeção acima (o binário não precisa "injetar" nada no parser para ser nocivo) e não é coberta pelo anti-SSRF (§4) — exige verificação de confiança do arquivo antes do consumo.

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
| **Ingestão** (Mód. 1) | Envenenamento (injeção), **malware em anexo binário**, extrapolação LGPD | Validação/sanitização de entrada e de schema; queries parametrizadas; preferência por API oficial; minimização antes de persistir; registro de proveniência; rate-limiting educado com as fontes. **Egress allowlist + anti-SSRF** na busca de anexos/URLs. **Trust-gating de anexos:** landing/quarentena → scan AV/malware assíncrono por evento → limpo/rejeitado; só objeto **limpo** é servido a triagem/OCR/front/download (controle **somado**, não substitui SSRF/P-58 nem prompt-injection/A11) | Pré-dev (validação, proveniência, minimização) · Pré-lançamento (SSRF/egress, trust-gating de anexos) | AB7, AB8, **AB14** / P-58, **P-104** |
| **Armazenamento** | Exfiltração | Criptografia em repouso; **escopo `tenantId`/`clienteFinalId` em toda entidade desde o dia 1** e segregação lógica por tenant; segredos em cofre (secrets manager), nunca no código; retenção mínima; criptografia de campo para a classe crítica | Pré-dev (escopo por tenant, segredos em cofre, cripto em repouso) · Pré-lançamento (retenção, cripto de campo) · Next (isolamento físico RLS) | AB1, AB12 / P-08, P-59, P-07 |
| **Trânsito** | Interceptação | TLS em todas as comunicações; sem tráfego de dado sensível em texto claro | Pré-dev | AB11 / — |
| **Aplicação / API** | Acesso indevido, abuso | **Autorização por objeto** (confirma posse por `tenantId`/`clienteFinalId` a cada acesso, não só filtro de query — anti-IDOR/BOLA); **identidade verificada na borda via IdP (token OIDC) — o `tenantId`/`clienteFinalId` vem de claim verificado do token, nunca de header controlado pelo cliente**; AuthN forte (MFA); RBAC por papel; rate-limit por tenant; WAF/gateway, headers (HSTS/CSP), CORS/CSRF, validação de schema, anti-mass-assignment; validação de saída para não vazar dado de outro tenant | Pré-dev (autorização por objeto + tenant derivado de claim verificado — invariantes nos use cases/borda) · Pré-lançamento (AuthN/MFA, RBAC, WAF/rate-limit/headers) | AB1, AB2, AB3, AB9 / P-51, P-52, P-53, P-55, P-08 |
| **Análise por IA** (Mód. 2) | Prompt injection via edital | Tratar conteúdo do edital como não confiável; separar instruções de dados; não executar conteúdo extraído; **classe crítica nunca vai ao LLM**; schema + sanitização da saída da IA | Pré-dev (edital-como-dado, separação instrução/dado) · Pré-lançamento (corpus adversarial, minimização ao LLM, sanitização de saída) | AB4, AB5, AB6 (A11) / P-54, P-72, P-73 |
| **Observabilidade** | Detecção tardia | **Audit log append-only/imutável e fail-closed** (`UPDATE`/`DELETE` negados; trava se a trilha não grava); trilha de acesso a dado pessoal; alertas de acesso anômalo; higiene de logs (sem PII/segredos) + SIEM | Pré-dev (audit log append-only/fail-closed — modelo AUDIT_LOG) · Pré-lançamento (SIEM, higiene de logs, alertas) | AB13 / P-61 |
| **Operação** | Erro humano, credenciais | Menor privilégio nos acessos internos; rotação de segredos; ambientes separados (dev/staging/prod); **verificação de identidade do titular antes de atender solicitação** | Pré-dev (ambientes separados, menor privilégio) · Pré-lançamento (rotação, verificação de titular) | AB10 / P-57 |

**Decisão (regra dura, não afrouxável).** Três invariantes são **Pré-dev** porque não se retrofitam sem reescrever o núcleo, e sustentam os casos de abuso críticos de A07 §5: (1) **autorização por objeto** + `tenantId`/`clienteFinalId` em toda entidade (sustenta **AB1**); (2) **audit log append-only/fail-closed** (sustenta **AB13**); (3) **edital como dado não-confiável** com instrução separada (sustenta **A11**/AB4). A **verificação de identidade do titular** (**AB10**) é obrigatória antes do go-live. O isolamento **físico** por RLS (P-07) é endurecimento **aditivo** no Next — ele **soma-se** à autorização por objeto, **nunca a substitui**: o baseline lógico vale desde o dia 1, mesmo single-tenant. Fechar P-04 **decide esta tabela**; a implementação e o teste de cada controle seguem nas pendências citadas.

**Trust-gating de anexos (controle novo, Pré-lançamento — P-103/RAD-124).** Anexo/PDF do PNCP é binário não confiável (§2): entra em **landing/quarentena**, passa por **scan AV/malware assíncrono dirigido por evento** (padrão worker — **nunca** dentro de `gravar()/armazenar()`) e só então é promovido a **limpo** ou **rejeitado/isolado**. Triagem, OCR, front e download **só consomem objeto limpo** — a leitura de consumo recusa pendente/rejeitado (fail-closed) e resolve por objeto de domínio, nunca por `storageKey` arbitrário do cliente. Cada transição de confiança emite evento auditável (reencosta em AB13/P-61 até o audit log real ficar em pé). É controle **somado e ortogonal**: não substitui o anti-SSRF (P-58) nem a defesa de prompt-injection na IA (A11) — o PDF segue dado não confiável para o LLM mesmo depois de "limpo"; e é independente do eixo **temperatura** (retenção/cost-tiering, P-30). Prova em **AB14** ([A07](../arquitetura/07-teste-de-seguranca.md) §§2,5); implementação na Ingestão em **P-104**.

**RBAC por papel (P-52 — decisão Produto+Segurança).** RBAC define **quem pode tentar** uma ação; autorização por objeto (P-51/AB1) confirma **se aquele usuário tem posse/escopo** sobre o `tenantId`/`clienteFinalId` do recurso. Os dois controles são obrigatórios e cumulativos: se o papel não permite, nega; se o objeto não pertence ao escopo do usuário, nega; usuário sem papel válido nega por padrão. Papéis são atribuídos no contexto **Identidade & Organização** (documento 13, §5) e a checagem operacional ocorre na borda/use case de autorização (documento 14, §6).

| Papel | Escopo | Pode ler | Pode escrever/decidir | Não pode |
|-------|--------|----------|------------------------|----------|
| **Admin consultoria** | `tenantId` e todos os `clienteFinalId` explicitamente vinculados ao tenant/contrato | Critérios, alertas, triagens, perfil de habilitação, preferências, usuários/papéis do próprio tenant e trilhas operacionais necessárias | Gerenciar usuários e papéis; criar/editar critérios; solicitar/consultar triagem; registrar decisão/feedback; editar perfil de habilitação; ajustar preferências do escopo | Atravessar tenant; acessar `clienteFinalId` fora do vínculo; alterar audit log; burlar verificação de titular |
| **Operador** | `tenantId` e `clienteFinalId` atribuídos | Oportunidades, alertas, triagens, critérios e perfil de habilitação do escopo atribuído | Criar/editar critérios; registrar feedback; solicitar/consultar triagem; registrar decisão operacional; editar perfil de habilitação; ajustar preferências próprias | Administrar usuários/papéis; ler audit log amplo; atuar fora dos `clienteFinalId` atribuídos; atender solicitação de titular |
| **Cliente-final read-only** | Próprio `clienteFinalId` | Alertas, triagens, critérios publicados para si e perfil de habilitação em leitura | Ajustar apenas preferências próprias de notificação/conta | Criar/editar critérios; alterar perfil de habilitação; administrar usuários/papéis; registrar decisão em nome da consultoria; acessar dados de outro cliente-final |
| **DPO/Compliance interno** | Escopo operacional necessário para conformidade, sempre registrado em auditoria | Solicitações de titular e audit log necessário ao atendimento/comprovação | Atender solicitação de titular após identidade verificada; registrar decisão/fundamento do atendimento; aplicar bloqueio/anonimização/eliminação conforme política | Alterar estratégia comercial do cliente; usar solicitação LGPD para contornar AB1; administrar papéis salvo acúmulo formal com Admin |

Matriz mínima de permissões por recurso × ação:

| Recurso / ação | Admin consultoria | Operador | Cliente-final read-only | DPO/Compliance interno |
|----------------|-------------------|----------|-------------------------|-------------------------|
| `USUARIO` / `PAPEL` — gerenciar | Sim, no próprio tenant | Não | Não | Não, salvo acúmulo formal com Admin |
| `CRITERIO_MONITORAMENTO` — ler/criar/editar | Sim, por escopo | Sim, por escopo atribuído | Ler apenas os critérios expostos ao próprio `clienteFinalId` | Não |
| `ALERTA` — ler e registrar feedback | Sim, por escopo | Sim, por escopo atribuído | Ler apenas | Não, salvo necessidade auditável de conformidade |
| `TRIAGEM` — solicitar, consultar e registrar decisão | Sim, por escopo | Sim, por escopo atribuído | Ler apenas | Não, salvo necessidade auditável de conformidade |
| `PERFIL_HABILITACAO` — ler/editar | Sim, por escopo | Sim, por escopo atribuído | Ler apenas | Não, salvo atendimento de titular com identidade verificada |
| `PREFERENCIA_NOTIFICACAO` — editar | Sim, no escopo administrado | Sim, próprias | Sim, próprias | Não |
| `AUDIT_LOG` — consultar | Escopo operacional restrito | Não | Não | Sim, mínimo necessário e sempre auditado |
| `SOLICITACAO_TITULAR` — atender | Abrir/acompanhar quando aplicável | Não | Não pelo produto; canal DPO-mediado | Sim, após identidade verificada |

AB2 passa a ser a prova testável desta decisão: operador não vira admin; read-only não escreve; sem papel não acessa; papel em um `clienteFinalId` não atravessa outro; `AUDIT_LOG` e `SOLICITACAO_TITULAR` permanecem restritos a DPO/Compliance/Admin conforme necessidade, com trilha de auditoria e identidade verificada quando envolver direito de titular.

## 5. Privacidade por design (LGPD na prática)

Os controles técnicos que materializam as obrigações do documento 02:

**Minimização na ingestão.** O ponto de decisão está no fluxo do documento 03, §2: dado pessoal desnecessário é descartado ou anonimizado **antes** de chegar à base. Quanto menos dado pessoal armazenado, menor a superfície de risco e de obrigação.

**Base legal e proveniência registradas.** Cada registro sabe de onde veio, quando e sob qual base legal foi tratado. Isso viabiliza auditoria e resposta a titulares.

**Encarregado, ROPA e transparência.** O go-live exige encarregado formalmente designado, canal público do encarregado, ROPA vivo e Política de Privacidade/Termos de Uso publicados (documento 02, §9; P-03). O ROPA registra finalidade, base legal, categorias de dados, operadores/suboperadores, retenção e salvaguardas por operação de tratamento.

**Atendimento a direitos do titular.** Existe um processo interno para localizar, corrigir, anonimizar/bloquear ou eliminar dados pessoais de um titular mediante solicitação — exigência direta da LGPD. O MVP usa canal DPO-mediado, sem portal público de titular (P-100): toda solicitação vira `SolicitaçãoDeTitular`, exige verificação de identidade antes de qualquer revelação/alteração, registra auditoria append-only e responde com escopo, decisão e fundamento. Pedido com identidade insuficiente falha fechado (`IdentidadeNaoVerificadaError`). Quando eliminação conflitar com retenção, auditoria ou defesa de direitos, o atendimento usa bloqueio/anonimização ou negativa fundamentada.

**Operadores e suboperadores.** LLM, e-mail transacional, nuvem e qualquer prestador que trate dado pessoal só entram em produção com contrato de tratamento/DPA, instruções documentadas do controlador, deveres de confidencialidade e segurança, retenção/eliminação, cooperação em direitos do titular e incidente. A classe **Estratégia comercial do cliente** não vai ao LLM nem a logs (documento 05, §9); P-54/P-66/P-80 fecham os detalhes de provedor, residência e DPA específico.

**Política de retenção (P-05/P-44).** A LGPD não fixa um prazo único para o Radar; a decisão segue finalidade, necessidade, término do tratamento e hipóteses de conservação (arts. 6º, 15, 16, 18 e 37). Esta é a matriz-base do MVP **PNCP-only**; fonte nova, dado pessoal sensível, contrato de cliente que peça prazo maior ou uso fora da decisão de licitação reabre validação jurídica.

| Conjunto de dados | Prazo-base | Arquivamento / expurgo | Observações |
|-------------------|------------|-------------------------|-------------|
| **Catálogo público** (`EDITAL`, `RESULTADO`, `MODALIDADE`, `ORGAO`) sem dado pessoal necessário | Ativo enquanto a licitação estiver aberta e por **24 meses** após encerramento ou última atualização relevante | Arquivar em camada fria até completar **5 anos**; após isso, manter apenas histórico agregado/anonimizado necessário à inteligência de mercado | Preserva valor de busca, matching e histórico sem manter bruto indefinidamente; proveniência fica vinculada ao registro |
| **Anexos/PDFs de edital** em object storage | Mesmo prazo do edital: ativo até encerramento + **24 meses** | Tiering nativo; expurgo ao completar **5 anos**, salvo retenção legal, disputa ou solicitação ativa | Anexo é classe **Público** quando sem PII necessária; PII desnecessária deve ser descartada/anonimizada na ingestão, não "resolvida" pelo tiering |
| **Pessoal de terceiro** extraído de edital/anexo | Não persistir salvo necessidade clara para a finalidade; quando persistido, no máximo até encerramento + **24 meses** | Eliminar, bloquear ou anonimizar antes se deixar de ser necessário ou se o titular exercer direito cabível | CPF, contato pessoal e dado sensível incidental são minimizados antes da base; não entram em alerta, lista, log ou LLM sem necessidade |
| **Conta do usuário** | Enquanto houver contrato/conta ativa + **5 anos** para defesa de direitos e obrigações contratuais | Credenciais, tokens e sessões são revogados no encerramento; preferências e dados operacionais sem obrigação remanescente são eliminados em até **90 dias** | A Política de Privacidade informa a retenção; pedidos do titular seguem o canal do encarregado |
| **Estratégia comercial do cliente** (`CRITERIO_MONITORAMENTO`, `ALERTA`, `TRIAGEM`, `CASO`, `PERFIL_HABILITACAO`, feedback) | Enquanto a conta estiver ativa + **24 meses** após encerramento contratual ou última ação do usuário | Eliminar ou anonimizar; métricas agregadas podem permanecer sem reidentificação | Classe crítica: não vai ao LLM nem a logs; prazo maior exige instrução contratual expressa e registro no ROPA |
| **Notificações e logs de entrega** | Até **180 dias** após envio ou falha final | Eliminar ou agregar para métricas de entregabilidade | Não substituem o `AUDIT_LOG`; conteúdo de notificação não deve carregar PII desnecessária |
| **PROVENIENCIA** | Enquanto o dado referenciado existir | Após expurgo do dado, manter *tombstone* mínimo por **5 anos**: fonte, hash/ID, datas, base legal e decisão de eliminação, sem PII desnecessária | Sustenta prestação de contas e resposta ao titular sem reter o dado bruto |
| **AUDIT_LOG** e `SolicitaçãoDeTitular` | **12 meses** em consulta operacional; arquivo frio até **5 anos** do evento ou encerramento da solicitação | Após 5 anos, eliminar ou anonimizar, exceto *legal hold*, incidente, disputa ou obrigação específica | Append-only, imutável e fail-closed; expurgos também geram evento auditável |

Regras transversais: (1) expurgo automático roda por política versionada e gera trilha de auditoria; (2) *legal hold* suspende eliminação apenas no escopo necessário; (3) dado anonimizado de forma robusta pode permanecer para métrica e inteligência; (4) backups seguem a janela operacional definida em P-60 e não são usados como arquivo histórico; (5) prazos menores por contrato são permitidos, prazos maiores exigem aprovação do encarregado e atualização do ROPA.

**Agregação no módulo de inteligência.** O módulo 4 opera preferencialmente sobre dados agregados/anonimizados, reduzindo o tratamento de dado pessoal identificável.

## 6. Resposta a incidentes (esboço)

Mesmo em concepção, convém deixar o princípio registrado: se houver incidente de segurança com dado pessoal, a LGPD exige comunicação à ANPD e, quando aplicável, aos titulares, em prazo razoável. O projeto precisa, antes do lançamento, de um **plano de resposta a incidentes** com papéis definidos, canal de reporte e critérios de escalonamento. `[A VALIDAR — criar plano antes do go-live]`

## 7. O que fica pendente para as próximas fases

Este documento estabelece princípios e controles em nível de concepção. Antes de desenvolvimento avançado, precisam ser detalhados: a arquitetura concreta de isolamento multi-tenant (P-07), a implementação operacional do expurgo e arquivamento da matriz de retenção (P-30/P-39/RAD-101), a execução do LIA aprovado para o legítimo interesse (P-01), a designação/publicação do encarregado e dos documentos de transparência (P-03), os contratos de tratamento com suboperadores (P-57/P-54/P-80) e o plano de resposta a incidentes. Cada item segue no roadmap pelo gate indicado no documento 98.

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

Pendências relacionadas permanecem separadas: implementação operacional da retenção/arquivamento (P-30/P-39/RAD-101), DPA/suboperadores e residência do LLM (P-54/P-66) e criptografia em nível de campo para a classe crítica (P-59). O RBAC detalhado está decidido em §4/P-52 e sua implementação segue como checagem de papel somada à autorização por objeto.
