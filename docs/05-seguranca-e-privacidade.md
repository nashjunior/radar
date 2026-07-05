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

| Camada | Ameaça endereçada | Controles propostos `[A VALIDAR]` |
|--------|-------------------|-----------------------------------|
| **Ingestão** (Mód. 1) | Envenenamento, extrapolação LGPD | Validação/sanitização de entrada; preferência por API oficial; minimização antes de persistir; registro de proveniência; rate-limiting educado com as fontes |
| **Armazenamento** | Exfiltração | Criptografia em repouso; segregação por tenant; retenção mínima; segredos em cofre (secrets manager), nunca no código |
| **Trânsito** | Interceptação | TLS em todas as comunicações; sem tráfego de dado sensível em texto claro |
| **Aplicação / API** | Acesso indevido, abuso | AuthN forte (idealmente MFA); AuthZ por papel e por tenant em toda requisição; rate-limiting; validação de saída para não vazar dado de outro tenant |
| **Análise por IA** (Mód. 2) | Prompt injection via edital | Tratar conteúdo do edital como não confiável; separar instruções de dados; não executar conteúdo extraído |
| **Observabilidade** | Detecção tardia | Logs de auditoria; alertas de acesso anômalo; trilha de acesso a dado pessoal |
| **Operação** | Erro humano, credenciais | Menor privilégio nos acessos internos; rotação de segredos; ambientes separados (dev/prod) |

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

Este documento estabelece princípios e controles em nível de concepção. Antes de desenvolvimento avançado, precisam ser detalhados: a arquitetura concreta de isolamento multi-tenant, a escolha de cofre de segredos e provedor de identidade, os prazos de retenção por tipo de dado, o LIA (avaliação de legítimo interesse) com o jurídico, e o plano de resposta a incidentes. Cada um desses itens é um `[A VALIDAR]` que deve virar tarefa própria no roadmap.

## 8. Regra de ouro do projeto

> Nenhuma funcionalidade que colete, armazene ou exponha dados avança sem responder a duas perguntas: **qual a base legal** (documento 02) e **qual o controle de segurança** (este documento). Segurança e conformidade não são revisão final — são pré-condição de cada fluxo.

## 9. Classificação de dados

O princípio de menor privilégio e o isolamento por tenant (§3) só operam bem se soubermos **o que** estamos protegendo. O Radar lida com níveis muito diferentes de sensibilidade — e o mais sensível não é o dado pessoal do edital, é a **estratégia comercial do cliente**:

| Classe | Exemplos | Sensibilidade | Tratamento mínimo |
|--------|----------|---------------|-------------------|
| **Público** | Texto do edital, dados abertos do PNCP | Baixa | Íntegro; proveniência registrada |
| **Pessoal de terceiro** | Nomes, CPF em editais | Média (LGPD, documento 02, §4) | Minimização na ingestão; base legal e proveniência |
| **Conta do usuário** | Cadastro, credenciais | Média-alta | Criptografia, controle de acesso, base contratual (documento 02, §9) |
| **Estratégia comercial do cliente** | Quais licitações, preços, forças/fraquezas | **Crítica** | Isolamento por tenant rígido; menor privilégio; auditoria de todo acesso |

A classe **crítica** é a razão de a segurança ser requisito de sobrevivência (§1): no cenário multi-cliente, ela concentra a inteligência competitiva de concorrentes numa mesma instância. Nenhum acesso a dado desta classe ocorre sem trilha de auditoria (§3, princípio 4). `[A VALIDAR — formalizar a matriz de classificação e o manuseio por classe]`
