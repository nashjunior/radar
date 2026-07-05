# 01 · Visão e Escopo

> Estágio do projeto: **Concepção**. Este documento define *o quê* e *para quem*, não *como*.

## 1. O problema

Participar de licitações públicas no Brasil é operacionalmente caro e propenso a erros. As oportunidades estão espalhadas por dezenas de portais (o PNCP como repositório nacional obrigatório, o Compras.gov.br/Comprasnet no âmbito federal, além de portais estaduais, municipais e privados credenciados). Cada edital é um documento denso, com requisitos de habilitação, prazos curtos e regras que mudaram substancialmente com a entrada em vigor da Lei 14.133/2021. Quem quer vender para o governo — ou assessora quem vende — gasta horas garimpando editais relevantes, lendo documentos para decidir se vale a pena participar, controlando prazos manualmente em planilhas e reagindo tarde a oportunidades.

O custo desse trabalho manual é triplo: oportunidades relevantes passam despercebidas, decisões de "participar ou não" são tomadas com informação incompleta, e prazos legais são perdidos por falha de controle. O Radar de Licitações existe para reduzir esses três custos.

## 2. Visão

Ser a camada de inteligência entre as fontes públicas de licitação e a decisão de negócio de quem participa — transformando um fluxo disperso e manual de editais em oportunidades qualificadas, monitoradas e acionáveis, com conformidade legal e segurança embutidas por padrão.

## 3. Personas

O produto atende a quatro perfis, que compartilham o núcleo (monitorar e decidir) mas divergem no uso avançado:

**Empresa fornecedora.** Vende bens ou serviços ao setor público e busca oportunidades aderentes ao seu ramo. Quer ser avisada cedo, entender rapidamente se qualifica e não perder prazo. É a persona central para priorização.

**Consultoria / assessoria de licitações.** Gerencia licitações para vários clientes simultaneamente. Precisa de multi-cliente, segregação de dados por cliente e visão de portfólio. Puxa as necessidades de organização, permissões e escala.

**Órgão público (setor de compras).** Publica e conduz licitações. Interesse principal em inteligência de mercado (preços de referência, histórico) e acompanhamento — não em "participar". Uso mais consultivo. `[A VALIDAR]` prioridade desta persona no MVP.

**Uso interno / próprio.** A operação da própria empresa que mantém o Radar, servindo como primeiro usuário e campo de prova das funcionalidades.

## 4. Os quatro módulos (escopo funcional)

O produto foi concebido em quatro módulos que formam uma esteira, do sinal bruto à decisão:

**Módulo 1 — Monitoramento e alerta.** Rastreia continuamente as fontes de editais (PNCP e demais portais), normaliza os dados e notifica o usuário sobre editais que casam com seus critérios (ramo, região, valor, palavras-chave, órgão). É a fundação: sem ingestão confiável, os demais módulos não têm insumo.

**Módulo 2 — Análise e triagem de editais.** Lê o edital e seus anexos, extrai requisitos de habilitação, objeto, prazos, valores e condições, e apoia a decisão de "participar ou não" avaliando aderência e risco. Reduz o tempo de leitura de horas para minutos e padroniza o critério de decisão.

**Módulo 3 — Gestão da participação.** Acompanha cada licitação que o usuário decidiu disputar: prazos legais, checklist de documentos, status das fases (proposta, julgamento, habilitação, recurso), e lembretes. É o "kanban" da operação de licitação.

**Módulo 4 — Inteligência de mercado.** Dados históricos e agregados: quem ganhou o quê, por qual preço, com que frequência, preços de referência e estatísticas de disputa. Alimenta tanto a decisão de participar (módulo 2) quanto a estratégia de precificação.

Os módulos 1 e 2 formam o núcleo mínimo de valor; 3 e 4 são incrementos naturais sobre a mesma base de dados. O recorte de MVP e a sequência de entrega (Now/Next/Later) estão no documento 07.

## 5. Proposta de valor por módulo

| Módulo | Dor que resolve | Valor entregue |
|--------|-----------------|----------------|
| 1 · Monitoramento | Garimpo manual em vários portais | Oportunidades relevantes entregues cedo, sem esforço |
| 2 · Triagem | Ler edital denso para decidir | Decisão de "go/no-go" em minutos, padronizada |
| 3 · Participação | Controle de prazos em planilha | Nenhum prazo legal perdido; visão de status |
| 4 · Inteligência | Precificar e estimar no escuro | Precificação e estratégia baseadas em histórico |

## 6. Fora de escopo (nesta fase)

Para manter foco na concepção, ficam explicitamente **fora** do escopo inicial: emissão ou assinatura de propostas diretamente nos portais governamentais em nome do usuário (automação de submissão); aconselhamento jurídico (o produto informa, não substitui advogado); e integração de pagamento/faturamento de contratos. Esses pontos podem entrar em roadmap futuro, mas trazem risco legal e de segurança elevado e não devem ser assumidos como dados. `[A VALIDAR]`

## 7. Métricas de sucesso (candidatas)

Como o projeto está em concepção, estas são hipóteses de métrica a validar: cobertura de fontes (% de editais relevantes capturados vs. universo real), tempo médio da publicação do edital até o alerta, taxa de alertas marcados como relevantes pelo usuário (precisão do matching), e redução no tempo de triagem por edital. Métricas de negócio (conversão participação→vitória) dependem dos módulos 3 e 4. Estas métricas foram desdobradas em uma árvore com North Star, alvos, guardrails e instrumentação no documento 08.

## 8. Principais riscos (visão de produto)

O risco mais estrutural é **legal e de privacidade**: o produto vive de dados públicos, mas "público" não significa "uso livre" sob a LGPD (ver documento 02). O segundo é de **dependência de fontes**: mudanças em APIs ou termos de uso dos portais podem quebrar a ingestão. O terceiro é de **qualidade de dados**: editais têm formatos heterogêneos, e erro de extração no módulo 2 gera decisão errada. O quarto é de **segurança**: a plataforma concentra a estratégia comercial de participação dos clientes — um dado sensível de negócio cujo vazamento seria crítico, especialmente no cenário multi-cliente das consultorias.

Cada um desses riscos é endereçado nos documentos seguintes: o legal em 02 e 04, o de fontes em 03, e o de segurança em 05.

## 9. Por que agora (timing)

A Lei 14.133/2021 tornou-se o regime obrigatório com a revogação da Lei 8.666/1993 e da Lei 10.520/2002 (documento 02, §2), e o PNCP consolidou-se como repositório nacional obrigatório (art. 174). Essa transição abriu uma janela: as regras, as fases e as fontes de dados mudaram ao mesmo tempo, o que desatualiza processos manuais e ferramentas antigas e força fornecedores e assessorias a reaprenderem o jogo. Um produto nascido já sob a 14.133 e ancorado no PNCP como fonte primária entra sem legado — enquanto incumbentes precisam migrar. É o momento de maior disposição do mercado a adotar uma nova camada de inteligência (documento 09). `[A VALIDAR — dimensionar a janela]`
