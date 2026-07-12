/**
 * Dataset compartilhado do eval ao vivo do gold set de bootstrap (P-18/P-84/P-85, ainda Aberto).
 * Extraído de `avaliar-gold-set-vivo.ts` (RAD-282) para ser reusado também pelo comparativo
 * raso-vs-completo (`avaliar-gold-set-vivo-comparativo.ts`) sem duplicar o gabarito.
 *
 * ⚠ GOLD SET DE BOOTSTRAP — os editais abaixo são prosa realista hand-authored (não PNCP real),
 * rotulados por valores inequívocos do texto. NÃO é o gold set autoritativo de ≥50 editais reais
 * rotulados por QA (P-18/P-84/P-85). Troque o DATASET por editais reais do PNCP rotulados por
 * Quésia (A16 §2) quando P-18 fechar.
 */
import type { CategoriaHabilitacao } from '../../src/domain/index.js';

export interface Gabarito {
  /** objeto correto quando o texto extraído contém TODOS estes termos (normalizado) */
  objetoTermos: string[];
  /** valor esperado em reais; null = sigiloso/ausente → esperar que NADA seja surfaced */
  valorEstimado: number | null;
  /** data de abertura das propostas 'yyyy-mm-dd'; null = sem abertura (dispensa/inexigibilidade) */
  dataAberturaPropostas: string | null;
  /** por categoria, um termo distintivo por requisito esperado (recall parcial da lista) */
  habilitacao: Partial<Record<CategoriaHabilitacao, string[]>>;
}

export interface EditalGabarito {
  id: string;
  modalidade: string;
  /** Texto completo do documento (o que a Triagem lê depois de RAD-282: anexo real, não metadado). */
  texto: string;
  paginas: number;
  /**
   * Só a cláusula "DO OBJETO" — o que o `objeto` do PNCP (`ContratacaoData.objeto`) carrega
   * tipicamente, ANTES do caminho do anexo (P-110): sem valor/data/habilitação. É a entrada
   * "rasa" usada por `avaliar-gold-set-vivo-comparativo.ts` para medir o ganho de RAD-282.
   */
  objetoResumo: string;
  gabarito: Gabarito;
}

/**
 * 5 editais realistas (reaproveitados do DATASET_EXEMPLO de gravar-fixtures-gold-set-via-cli.ts),
 * cobrindo pregão/concorrência/dispensa/inexigibilidade e o caso adversarial de valor SIGILOSO
 * (gs-002) e ausência de abertura de propostas (gs-003/gs-004). Gabarito por valores inequívocos.
 */
export const DATASET: EditalGabarito[] = [
  {
    id: 'gs-real-001',
    modalidade: 'pregao_eletronico',
    paginas: 2,
    objetoResumo: 'Aquisição de 50 (cinquenta) notebooks para as escolas municipais.',
    texto: [
      'PREGÃO ELETRÔNICO Nº 12/2026 — PREFEITURA MUNICIPAL DE EXEMPLO',
      '1. DO OBJETO: aquisição de 50 (cinquenta) notebooks para as escolas municipais.',
      '2. DO VALOR ESTIMADO: R$ 250.000,00 (duzentos e cinquenta mil reais).',
      '3. DA SESSÃO: a abertura das propostas ocorrerá em 15/03/2026 às 09h00.',
      '4. DA HABILITAÇÃO FISCAL: exige-se Certidão Negativa de Débitos (CND) federal válida.',
      '5. PENALIDADES: multa de 10% sobre o valor do contrato em caso de inexecução total.',
    ].join('\n'),
    gabarito: {
      objetoTermos: ['notebook'],
      valorEstimado: 250000,
      dataAberturaPropostas: '2026-03-15',
      habilitacao: { fiscal: ['cnd'] },
    },
  },
  {
    id: 'gs-real-002',
    modalidade: 'concorrencia',
    paginas: 3,
    objetoResumo: 'Contratação de empresa para execução de obras de reforma na Escola Estadual Central.',
    texto: [
      'CONCORRÊNCIA Nº 03/2026 — GOVERNO DO ESTADO DE EXEMPLO',
      '1. OBJETO: contratação de empresa para execução de obras de reforma na Escola Estadual Central.',
      '2. VALOR ESTIMADO: SIGILOSO (art. 24 da Lei 14.133/2021).',
      '3. DATA DE ABERTURA: 20 de abril de 2026, às 14h, na sede da Secretaria de Obras.',
      '4. HABILITAÇÃO TÉCNICA: atestado de capacidade técnica em obras de reforma de edificações.',
      '5. HABILITAÇÃO ECONÔMICA: capital social mínimo de R$ 500.000,00 ou patrimônio líquido equivalente.',
    ].join('\n'),
    gabarito: {
      objetoTermos: ['reforma'],
      valorEstimado: null, // SIGILOSO — não pode inventar valor (guardrail alucinação)
      dataAberturaPropostas: '2026-04-20',
      habilitacao: { tecnica: ['atestado'], economica: ['capital'] },
    },
  },
  {
    id: 'gs-real-003',
    modalidade: 'dispensa',
    paginas: 1,
    objetoResumo: 'Contratação de empresa de consultoria em tecnologia da informação.',
    texto: [
      'DISPENSA DE LICITAÇÃO Nº 05/2026 — AUTARQUIA FEDERAL DE EXEMPLO',
      '1. OBJETO: contratação de empresa de consultoria em tecnologia da informação.',
      '2. VALOR: R$ 40.000,00 (quarenta mil reais) — enquadrado no art. 75, II, Lei 14.133/2021.',
      '3. PRAZO: o serviço deverá ser entregue em 30 dias a partir da assinatura do contrato.',
      '4. HABILITAÇÃO JURÍDICA: certidão de registro no CNPJ e contrato social atualizado.',
    ].join('\n'),
    gabarito: {
      objetoTermos: ['consultoria'],
      valorEstimado: 40000,
      dataAberturaPropostas: null, // dispensa — sem abertura de propostas
      habilitacao: { juridica: ['cnpj'] },
    },
  },
  {
    id: 'gs-real-004',
    modalidade: 'inexigibilidade',
    paginas: 1,
    objetoResumo: 'Contratação de palestrante especialista em governança pública para evento institucional.',
    texto: [
      'INEXIGIBILIDADE Nº 02/2026 — MUNICÍPIO DE EXEMPLO',
      '1. OBJETO: contratação de palestrante especialista em governança pública para evento institucional.',
      '2. VALOR: R$ 15.000,00 (quinze mil reais).',
      '3. JUSTIFICATIVA: notória especialização do contratado (art. 74, III, "d", Lei 14.133/2021).',
      '4. PRAZO DA PRESTAÇÃO: 10 de maio de 2026.',
    ].join('\n'),
    gabarito: {
      objetoTermos: ['palestrante'],
      valorEstimado: 15000,
      dataAberturaPropostas: null, // inexigibilidade — o "10/05" é prazo de prestação, não abertura
      habilitacao: {},
    },
  },
  {
    id: 'gs-real-005',
    modalidade: 'pregao_eletronico',
    paginas: 4,
    objetoResumo: 'Aquisição de medicamentos (insulina, metformina e losartana) para a rede básica de saúde.',
    texto: [
      'PREGÃO ELETRÔNICO Nº 88/2026 — AUTARQUIA MUNICIPAL DE SAÚDE',
      '1. OBJETO: aquisição de medicamentos (insulina, metformina e losartana) para a rede básica de saúde.',
      '2. VALOR ESTIMADO: R$ 1.200.000,00 (um milhão e duzentos mil reais).',
      '3. ABERTURA DAS PROPOSTAS: 02/06/2026 às 10h, via sistema Comprasnet.',
      '4. HABILITAÇÃO FISCAL: Certidão Negativa de Débitos Trabalhistas (CNDT) e CND federal.',
      '5. HABILITAÇÃO TÉCNICA: alvará de funcionamento da ANVISA e licença sanitária vigente.',
    ].join('\n'),
    gabarito: {
      objetoTermos: ['medicamento'],
      valorEstimado: 1200000,
      dataAberturaPropostas: '2026-06-02',
      habilitacao: { fiscal: ['cndt'], tecnica: ['anvisa'] },
    },
  },
];
