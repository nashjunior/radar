# 02 · Marco Legal e Conformidade

> Este documento resume as leis que regem o domínio e — mais importante para o produto — o que cada uma **implica** para o Radar de Licitações. Não é parecer jurídico; pontos sensíveis marcados `[A VALIDAR]` exigem revisão de advogado.

## 1. Panorama

O Radar opera sobre dois eixos legais distintos que não devem ser confundidos:

1. **O direito das licitações** — as regras que o *setor público* segue para comprar. Definem as fases, os prazos e o que precisa ser publicado. É o que o produto **observa e ajuda o usuário a navegar**.
2. **O direito de proteção de dados e acesso à informação** — as regras que *o Radar* precisa seguir ao coletar, tratar e distribuir dados. É o que o produto **precisa obedecer**.

Confundir os dois é a principal armadilha: o fato de um edital ser público (eixo 1) não autoriza qualquer uso dos dados pessoais nele contidos (eixo 2).

## 2. Lei nº 14.133/2021 — Nova Lei de Licitações e Contratos

A **Lei nº 14.133, de 1º de abril de 2021**, é o marco atual. Ela estabelece normas gerais de licitação e contratação para as Administrações Públicas diretas, autárquicas e fundacionais da União, dos Estados, do Distrito Federal e dos Municípios. Substituiu o regime anterior formado pela Lei 8.666/1993 (licitações), Lei 10.520/2002 (pregão) e parte da Lei 12.462/2011 (RDC), que foram **revogadas**. Contratos firmados sob a legislação anterior continuam regidos pelas regras revogadas até seu encerramento — ou seja, por alguns anos ainda coexistem editais e contratos sob os dois regimes, e o produto precisa lidar com essa transição.

**Modalidades.** A lei prevê cinco: **pregão** (preferencial para bens e serviços comuns), **concorrência** (contratações de maior valor ou complexidade), **concurso** (trabalho técnico, científico ou artístico), **leilão** (alienação de bens) e **diálogo competitivo** (modalidade nova, para contratações complexas em que a Administração dialoga com licitantes pré-selecionados). As antigas *tomada de preços* e *convite* deixaram de existir.

**Fases do procedimento.** A ordem passou a ser: preparação → divulgação do edital → apresentação de propostas e lances → **julgamento** → **habilitação** → recursos → homologação → contratação. A inversão relevante é que, em regra, o **julgamento vem antes da habilitação** — só se verifica a documentação do licitante mais bem colocado. Isso muda a lógica de prazos e de acompanhamento do módulo 3 (ver documento 04).

**Atualização de valores.** Os limites de valor da lei são atualizados por decreto. O **Decreto nº 12.343/2024** atualizou os valores vigentes a partir de 1º de janeiro de 2025 (afetando, entre outros, os arts. 6º, 75 e o regime simplificado do art. 184-A). *Implicação de produto:* qualquer faixa de valor usada em regras de matching ou triagem precisa ser parametrizável, não hard-coded, porque muda anualmente.

## 3. PNCP — Portal Nacional de Contratações Públicas (art. 174)

O **PNCP** é o sítio eletrônico oficial criado pela Lei 14.133 (art. 174) para a **divulgação centralizada e obrigatória** dos atos exigidos pela lei. Na prática, tornou-se o repositório nacional de editais, atas e contratos: publicar no PNCP é condição de eficácia do contrato. Durante a transição, municípios ainda precisaram fazer divulgação complementar em jornal até o fim de 2023; hoje o PNCP é a fonte primária.

*Implicação de produto:* o PNCP é a **fonte de dados âncora** do módulo 1. Ele oferece **APIs públicas de consulta** (sem necessidade de login) e um programa de **dados abertos**. As APIs de *manutenção* (inserção/correção de dados) exigem autenticação e são para órgãos publicadores — não interessam ao Radar, que é consumidor. Detalhes técnicos das fontes estão no documento 03.

## 4. LGPD — Lei nº 13.709/2018 (o eixo mais sensível)

Esta é a lei que mais restringe o produto. O ponto central, reforçado pela **ANPD** (Autoridade Nacional de Proteção de Dados) em seu *Radar Tecnológico nº 3* sobre web scraping (nov/2024): **dado pessoal disponível publicamente continua protegido pela LGPD**. A coleta massiva de dados públicos (scraping) é considerada uma forma de tratamento e está sujeita a todas as regras da lei.

Consequências práticas para o Radar:

**"Público" ≠ "uso livre".** Editais contêm dados pessoais (nomes de pregoeiros, sócios de empresas, responsáveis técnicos, CPFs em alguns casos). Coletá-los e reusá-los exige **base legal** e respeito à **finalidade original** da divulgação. A finalidade original é a transparência do processo licitatório — usos que extrapolem isso (ex.: montar mailing para telemarketing) já foram expressamente considerados ilícitos pela ANPD, mesmo com dado público.

**Base legal candidata: legítimo interesse (art. 7º, IX).** É a hipótese mais plausível para o Radar, mas exige que o interesse seja legítimo, específico e balanceado contra os direitos do titular (teste de proporcionalidade / LIA — *Legitimate Interest Assessment*). `[A VALIDAR — parecer jurídico]`

**Minimização.** O produto deve coletar e reter apenas os dados pessoais necessários à sua finalidade. Dados pessoais que não agregam valor à decisão de negócio (ex.: CPF de terceiros) devem ser descartados ou anonimizados na ingestão — decisão que pertence ao pipeline do módulo 1 (ver documento 05).

**Direitos do titular.** A LGPD garante ao titular acesso, correção e eliminação. O Radar precisa de um processo para atender solicitações de titulares sobre dados pessoais que reteve.

**Prioridade de fonte oficial.** Sempre que uma **API oficial de dados abertos** existir (PNCP, Compras.gov.br), ela deve ser preferida ao scraping de páginas HTML. Além de mais estável, reduz risco jurídico: consumir um endpoint público oficial é materialmente diferente de raspar um portal contra seus termos de uso.

## 5. LAI — Lei nº 12.527/2011 (Acesso à Informação)

A **LAI** garante o direito de acesso a informações públicas e é o fundamento da transparência que torna os editais acessíveis. Ela **favorece** o produto (é a razão de os dados existirem publicamente), mas não anula a LGPD — as duas convivem: transparência do processo de um lado, proteção do dado pessoal de outro.

## 6. Termos de uso dos portais

Independentemente da LGPD, cada portal-fonte tem **termos de uso** próprios. Consumir uma API oficial documentada é o caminho seguro; fazer scraping de um portal cujos termos proíbam coleta automatizada cria risco contratual e reputacional, além do risco LGPD. *Regra do projeto:* antes de adicionar qualquer fonte ao módulo 1, verificar (a) existe API oficial? (b) o que dizem os termos de uso? (c) qual a base legal LGPD? Nenhuma fonte entra sem essas três respostas. `[A VALIDAR por fonte]`

## 7. Resumo de obrigações → implicações de produto

| Norma | O que exige | Implicação direta no Radar |
|-------|-------------|----------------------------|
| Lei 14.133/2021 | Fases, modalidades, prazos, publicação no PNCP | Modelo de dados e fluxos (doc 04) refletem as fases; valores parametrizáveis |
| Art. 174 (PNCP) | Publicação centralizada obrigatória | PNCP é a fonte âncora; usar APIs públicas de consulta |
| LGPD 13.709/2018 | Base legal, finalidade, minimização, direitos do titular | LIA, minimização na ingestão, processo de atendimento a titulares |
| ANPD Radar nº 3 | Scraping é tratamento sujeito à LGPD | Preferir API oficial; documentar base legal por fonte |
| LAI 12.527/2011 | Transparência de dados públicos | Fundamenta a disponibilidade das fontes (a favor) |
| Termos de uso dos portais | Regras de cada fonte | Checklist de 3 perguntas antes de adicionar fonte |
| LGPD art. 41 | Indicar um encarregado (DPO) | Designar encarregado e publicar canal de contato (§9) |
| LGPD art. 37 | Manter registro das operações de tratamento | ROPA vivo, cobrindo dado de terceiro e do usuário (§9) |

## 8. Postura de conformidade do projeto

O Radar adota **compliance-by-design**: a base legal de cada tratamento é definida antes da implementação, não depois. A minimização de dados pessoais acontece o mais cedo possível no pipeline. Fontes oficiais são preferidas a scraping. E existe um dono claro (produto + jurídico) para revisar cada nova fonte de dados. Esses princípios se materializam nos controles técnicos do documento 05.

## 9. Dados pessoais dos próprios usuários do Radar (a outra face da LGPD)

Os §§4-6 tratam do dado de **terceiros** que chega nos editais. Mas o Radar também é **controlador** dos dados pessoais dos seus próprios clientes: dados de conta e — mais sensível — a estratégia comercial de participação (quais licitações, com que preço), que no cenário multi-cliente concentra a inteligência competitiva de concorrentes numa mesma instância (documento 05, §1). É uma superfície LGPD distinta, e não deve ser esquecida por o foco natural recair sobre o dado do edital.

Obrigações que decorrem daí:

- **Base legal do dado do usuário.** Para a relação com o cliente pagante, a base típica é **execução de contrato** (art. 7º, V) e, para alguns tratamentos, legítimo interesse — diferente da base discutida no §4, que trata do dado de terceiro no edital.
- **Encarregado (DPO).** A LGPD (art. 41) exige a indicação de um **encarregado** pelo tratamento, com canal de contato público. `[A VALIDAR — designar]`
- **ROPA — Registro das Operações de Tratamento (art. 37).** O controlador deve manter registro das operações de tratamento. O Radar precisa de um ROPA vivo, cobrindo tanto o dado de terceiro quanto o do usuário. `[A VALIDAR — criar e manter]`
- **Política de Privacidade e Termos de Uso do produto.** Documentos voltados ao usuário final — finalidade, bases legais, retenção e direitos — distintos desta análise legal interna. `[A VALIDAR — redigir]`
- **Direitos do titular-usuário.** Acesso, correção e eliminação valem também para o dado do cliente, não só para o titular do edital (§4).

A classificação de sensibilidade desses dados — em especial a estratégia comercial do cliente — está no documento 05, §9.
