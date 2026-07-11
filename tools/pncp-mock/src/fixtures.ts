/**
 * Tipos de wire format do PNCP + geradores de fixtures.
 *
 * Os tipos refletem a resposta real da API de Consulta do PNCP
 * (schema confirmado em P-26 / A02 §2, 2026-07-05).
 *
 * Regra dura (A04 §4): nunca usar a API real em testes — este módulo
 * reproduz o perfil de carga medido em P-31 sem tocar na fonte.
 */

// ---------------------------------------------------------------------------
// Tipos de wire format (JSON devolvido pela API pública do PNCP)
// ---------------------------------------------------------------------------

/** Envelope de paginação — campos confirmados pelo Swagger e por chamada real. */
export interface PncpPaginaRaw {
  data: PncpContratacaoRaw[];
  totalRegistros: number;
  totalPaginas: number;
  numeroPagina: number;
  paginasRestantes: number;
  empty: boolean;
}

/**
 * Item de contratação no formato bruto do PNCP.
 * Schema completo confirmado em P-26 / A02 §2 (2026-07-05).
 * Campos marcados como nullable refletem comportamento real
 * (sigiloso / não preenchido pelo órgão).
 */
export interface PncpContratacaoRaw {
  // Identidade
  numeroControlePNCP: string;          // ex.: "00394502000167-1-000001/2026"
  anoCompra: number;
  sequencialCompra: number;
  numeroCompra: string;
  processo: string;

  // Objeto e datas
  objetoCompra: string;
  dataInclusao: string;                // ISO 8601
  dataPublicacaoPncp: string;          // ISO 8601
  dataAtualizacao: string;             // ISO 8601
  dataAtualizacaoGlobal: string;       // ISO 8601  — campo de corte do /atualizacao
  dataAberturaProposta: string | null;
  dataEncerramentoProposta: string | null;  // null quando sigiloso ou não preenchido

  // Valores — null quando sigiloso ou regime de contratação direta sem estimativa
  valorTotalEstimado: number | null;
  valorTotalHomologado: number | null;

  // Modalidade e situação
  modalidade: { codigo: number; nome: string };
  situacaoCompraId: number;
  situacaoCompraNome: string;
  tipoInstrumentoConvocatorioCodigo: number;
  tipoInstrumentoConvocatorioNome: string;
  modoDisputaId: number;
  modoDisputaNome: string;
  srp: boolean;

  // Campos complementares opcionais
  informacaoComplementar: string | null;
  linkSistemaOrigem: string | null;
  linkProcessoEletronico: string | null;

  // Órgão e unidade
  orgaoEntidade: {
    cnpj: string;
    razaoSocial: string;
    poderId: string;   // ex.: "E" (Executivo)
    esferaId: string;  // ex.: "F" (Federal)
  };
  unidadeOrgao: {
    codigoUnidade: string;
    nomeUnidade: string;
    ufSigla: string;
    ufNome: string;
    municipioNome: string;
    codigoIbge: number;
  };

  // Amparo legal
  amparoLegal: { codigo: number; nome: string; descricao: string };

  // Arrays e objetos variáveis
  fontesOrcamentarias: unknown[];
  emendaParlamentar: unknown | null;
  unidadeSubRogada: unknown | null;
  orgaoSubRogado: unknown | null;

  // Itens — ausentes em contratações do tipo Dispensa sem item estruturado
  itens?: Array<{
    numeroItem: number;
    descricao: string;
    quantidade: number;
    valorUnitarioEstimado: number | null;
    unidadeMedida?: string;
    criterioJulgamento?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Dados de referência
// ---------------------------------------------------------------------------

/** Tabela de modalidades mapeada em A02 §3 (confirmada no Swagger, 2026-07-05). */
export const MODALIDADES: Readonly<Record<number, string>> = {
  1:  'Leilão - Eletrônico',
  2:  'Diálogo Competitivo',
  3:  'Concurso',
  4:  'Concorrência - Eletrônica',
  5:  'Concorrência - Presencial',
  6:  'Pregão - Eletrônico',
  7:  'Pregão - Presencial',
  8:  'Dispensa',
  9:  'Inexigibilidade',
  10: 'Manifestação de Interesse',
  11: 'Pré-qualificação',
  12: 'Credenciamento',
  13: 'Leilão - Presencial',
} as const;

/**
 * Volume diário por modalidade — perfil de dia útil medido em P-31 (2026-07-05).
 * Total: ~5.799 publicações/dia útil.
 * Modalidades 6, 8 e 9 somam ~93 % do volume (gate: ≥ 90 %).
 */
export const PERFIL_DIA_UTIL_PUBLICACAO: Readonly<Record<number, number>> = {
  1:  6,
  2:  1,
  3:  3,
  4:  275,
  5:  15,
  6:  1_400,   // Pregão Eletrônico — dominante
  7:  50,
  8:  2_650,   // Dispensa — dominante
  9:  1_300,   // Inexigibilidade — dominante
  10: 7,
  11: 5,
  12: 85,
  13: 2,
} as const;

/** Volume de atualizações/dia útil (endpoint /atualizacao) medido em P-31. */
export const VOLUME_ATUALIZACOES_DIA_UTIL = 15_000;

/** Tamanho máximo de página aceito pela API (confirmado Swagger — P-26). */
export const TAMANHO_PAGINA_MAX = 50;

// ---------------------------------------------------------------------------
// Dados sintéticos de órgãos e objetos
// ---------------------------------------------------------------------------

const ORGAOS_FIXTURE = [
  { cnpj: '00394502000167', nome: 'Ministério da Educação', ufSigla: 'DF', ufNome: 'Distrito Federal', mun: 'Brasília', ibge: 5300108, esfera: 'F' },
  { cnpj: '24529265000130', nome: 'Prefeitura de São Paulo', ufSigla: 'SP', ufNome: 'São Paulo', mun: 'São Paulo', ibge: 3550308, esfera: 'M' },
  { cnpj: '75658571000170', nome: 'Governo do Estado do Rio de Janeiro', ufSigla: 'RJ', ufNome: 'Rio de Janeiro', mun: 'Rio de Janeiro', ibge: 3304557, esfera: 'E' },
  { cnpj: '11222333000181', nome: 'Câmara Municipal de Belo Horizonte', ufSigla: 'MG', ufNome: 'Minas Gerais', mun: 'Belo Horizonte', ibge: 3106200, esfera: 'M' },
  { cnpj: '99887766000155', nome: 'Secretaria de Saúde da Bahia', ufSigla: 'BA', ufNome: 'Bahia', mun: 'Salvador', ibge: 2927408, esfera: 'E' },
  { cnpj: '12345678000195', nome: 'Instituto Federal do Paraná', ufSigla: 'PR', ufNome: 'Paraná', mun: 'Curitiba', ibge: 4106902, esfera: 'F' },
  { cnpj: '98765432000110', nome: 'Tribunal Regional Federal da 4ª Região', ufSigla: 'RS', ufNome: 'Rio Grande do Sul', mun: 'Porto Alegre', ibge: 4314902, esfera: 'J' },
] as const;

const OBJETOS_FIXTURE = [
  'Aquisição de material de escritório e expediente',
  'Contratação de serviços de TI — suporte e manutenção de sistemas',
  'Fornecimento de medicamentos para rede de saúde pública',
  'Reforma e revitalização de prédio público histórico',
  'Locação de veículos para uso administrativo',
  'Prestação de serviços de limpeza, conservação e copa',
  'Aquisição de equipamentos de informática — computadores e periféricos',
  'Contratação de serviços de segurança patrimonial armada',
  'Fornecimento de combustível para frota municipal',
  'Manutenção preventiva e corretiva de elevadores e escadas rolantes',
  'Aquisição de mobiliário e equipamentos ergonômicos',
  'Contratação de serviços de engenharia para obra de ampliação',
  'Fornecimento de gêneros alimentícios para refeitório',
  'Contratação de empresa de treinamento e capacitação',
  'Aquisição de softwares e licenças — suite de produtividade',
] as const;

const AMPAROS_LEGAIS = [
  { codigo: 1,  nome: 'Lei 14.133/2021, Art. 28, I',    descricao: 'Pregão' },
  { codigo: 8,  nome: 'Lei 14.133/2021, Art. 75, I',    descricao: 'Dispensa — valor' },
  { codigo: 9,  nome: 'Lei 14.133/2021, Art. 74, I',    descricao: 'Inexigibilidade — empresa exclusiva' },
  { codigo: 4,  nome: 'Lei 14.133/2021, Art. 28, II',   descricao: 'Concorrência' },
  { codigo: 12, nome: 'Lei 14.133/2021, Art. 79, I',    descricao: 'Credenciamento' },
] as const;

// ---------------------------------------------------------------------------
// Gerador de fixtures
// ---------------------------------------------------------------------------

export interface OpcoesGeracao {
  /** Campos sigilosos (valorTotalEstimado e prazo null) */
  sigiloso?: boolean;
  /** Data-base para timestamps (default: 2026-07-10T10:00:00Z) */
  dataBase?: Date;
}

/** Gera uma `PncpContratacaoRaw` sintética com schema completo (P-26). */
export function gerarContratacaoRaw(
  idx: number,
  modalidadeCodigo: number,
  opts?: OpcoesGeracao,
): PncpContratacaoRaw {
  const orgao = ORGAOS_FIXTURE[idx % ORGAOS_FIXTURE.length]!;
  const objeto = OBJETOS_FIXTURE[idx % OBJETOS_FIXTURE.length]!;
  const amparo = AMPAROS_LEGAIS[idx % AMPAROS_LEGAIS.length]!;

  const seq = idx + 1;
  const ano = 2026;
  const dataBase = opts?.dataBase ?? new Date('2026-07-10T10:00:00Z');

  // Variação de timestamps para simular publicações distribuídas ao longo do dia
  const offsetMs = (idx % 1440) * 60_000;  // minuto a minuto dentro de 24h
  const dataPublicacao = new Date(dataBase.getTime() - offsetMs);
  const dataAtualizacao = new Date(dataBase.getTime() - (offsetMs / 2));

  const sigiloso = opts?.sigiloso ?? false;
  const valorEstimado: number | null = sigiloso ? null : 5_000 + idx * 1_000;
  const prazoEncerramento: string | null = sigiloso
    ? null
    : new Date(dataBase.getTime() + 15 * 24 * 60 * 60 * 1_000).toISOString();

  return {
    numeroControlePNCP: `${orgao.cnpj}-1-${String(seq).padStart(6, '0')}/${ano}`,
    anoCompra: ano,
    sequencialCompra: seq,
    numeroCompra: String(seq).padStart(5, '0'),
    processo: `${ano}/${String(seq).padStart(6, '0')}`,
    objetoCompra: `${objeto} — lote ${(idx % 20) + 1}`,
    dataInclusao: dataPublicacao.toISOString(),
    dataPublicacaoPncp: dataPublicacao.toISOString(),
    dataAtualizacao: dataAtualizacao.toISOString(),
    dataAtualizacaoGlobal: dataAtualizacao.toISOString(),
    dataAberturaProposta: new Date(dataBase.getTime() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
    dataEncerramentoProposta: prazoEncerramento,
    valorTotalEstimado: valorEstimado,
    valorTotalHomologado: null,
    modalidade: {
      codigo: modalidadeCodigo,
      nome: MODALIDADES[modalidadeCodigo] ?? `Modalidade ${modalidadeCodigo}`,
    },
    situacaoCompraId: (idx % 4) + 1,
    situacaoCompraNome: ['Divulgada no PNCP', 'Em andamento', 'Encerrada', 'Cancelada'][(idx % 4)]!,
    tipoInstrumentoConvocatorioCodigo: 1,
    tipoInstrumentoConvocatorioNome: 'Edital',
    modoDisputaId: (idx % 2) + 1,
    modoDisputaNome: idx % 2 === 0 ? 'Aberto' : 'Fechado',
    srp: idx % 3 === 0,
    informacaoComplementar: idx % 7 === 0 ? 'Participação exclusiva de ME/EPP' : null,
    linkSistemaOrigem: null,
    linkProcessoEletronico: null,
    orgaoEntidade: {
      cnpj: orgao.cnpj,
      razaoSocial: orgao.nome,
      poderId: 'E',
      esferaId: orgao.esfera,
    },
    unidadeOrgao: {
      codigoUnidade: `${orgao.cnpj.slice(0, 8)}-${String((idx % 5) + 1).padStart(3, '0')}`,
      nomeUnidade: `${orgao.nome} — Unidade ${(idx % 5) + 1}`,
      ufSigla: orgao.ufSigla,
      ufNome: orgao.ufNome,
      municipioNome: orgao.mun,
      codigoIbge: orgao.ibge + (idx % 5),
    },
    amparoLegal: { ...amparo },
    fontesOrcamentarias: [],
    emendaParlamentar: null,
    unidadeSubRogada: null,
    orgaoSubRogado: null,
    itens: gerarItens(idx),
  };
}

function gerarItens(idx: number): NonNullable<PncpContratacaoRaw['itens']> {
  const nItens = (idx % 3) + 1;
  return Array.from({ length: nItens }, (_, i) => ({
    numeroItem: i + 1,
    descricao: `${OBJETOS_FIXTURE[(idx + i) % OBJETOS_FIXTURE.length]!} — item ${i + 1}`,
    quantidade: (i + 1) * 10,
    valorUnitarioEstimado: idx % 5 === 0 ? null : 500 + i * 100,
    unidadeMedida: 'UN',
    criterioJulgamento: 'Menor Preço',
  }));
}

// ---------------------------------------------------------------------------
// Helpers de paginação
// ---------------------------------------------------------------------------

/** Constrói o envelope de paginação a partir de uma fatia de items e do total. */
export function gerarPagina(
  items: PncpContratacaoRaw[],
  numeroPagina: number,
  totalRegistros: number,
  tamanhoPagina = TAMANHO_PAGINA_MAX,
): PncpPaginaRaw {
  const totalPaginas = totalRegistros === 0 ? 1 : Math.ceil(totalRegistros / tamanhoPagina);
  const paginasRestantes = Math.max(0, totalPaginas - numeroPagina);
  return {
    data: items,
    totalRegistros,
    totalPaginas,
    numeroPagina,
    paginasRestantes,
    empty: items.length === 0,
  };
}

/** Resposta de página vazia — cenário de edge case (A04 §4). */
export function paginaVazia(numeroPagina = 1): PncpPaginaRaw {
  return {
    data: [],
    totalRegistros: 0,
    totalPaginas: 1,
    numeroPagina,
    paginasRestantes: 0,
    empty: true,
  };
}
