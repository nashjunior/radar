import type { AlertasApiGateway } from '@/application/ports.js';
import type { AlertaCardItem } from '@/domain/alerta-card.js';

const STUB_ALERTAS: AlertaCardItem[] = [
  {
    alertaId: 'alerta-001',
    editalId: 'edital-001',
    modalidade: 'Pregão',
    titulo: 'Aquisição de equipamentos de informática para uso administrativo',
    orgao: 'Min. da Educação',
    valorEstimado: 85000,
    dataAbertura: '2026-07-10T14:00:00.000Z',
    aderencia: 92,
    relevante: null,
    proveniencia: { fonte: 'PNCP', dataColeta: '2026-07-05T08:30:00.000Z', baseLegal: 'Lei 14.133/2021, art. 174' },
  },
  {
    alertaId: 'alerta-002',
    editalId: 'edital-002',
    modalidade: 'Concorrência',
    titulo: 'Contratação de serviços de desenvolvimento de software sob demanda',
    orgao: 'TRF - 1ª Região',
    valorEstimado: 240000,
    dataAbertura: '2026-07-15T10:00:00.000Z',
    aderencia: 78,
    relevante: null,
    proveniencia: { fonte: 'PNCP', dataColeta: '2026-07-05T09:00:00.000Z', baseLegal: 'Lei 14.133/2021, art. 174' },
  },
  {
    alertaId: 'alerta-003',
    editalId: 'edital-003',
    modalidade: 'Dispensa',
    titulo: 'Fornecimento de licenças de software de gestão empresarial',
    orgao: 'ANATEL',
    valorEstimado: 45000,
    dataAbertura: '2026-07-08T17:00:00.000Z',
    aderencia: 65,
    relevante: null,
    proveniencia: { fonte: 'PNCP', dataColeta: '2026-07-04T10:15:00.000Z', baseLegal: 'Lei 14.133/2021, art. 174' },
  },
  {
    alertaId: 'alerta-004',
    editalId: 'edital-004',
    modalidade: 'Pregão',
    titulo: 'Contratação de suporte técnico especializado em infraestrutura TI',
    orgao: 'SERPRO',
    valorEstimado: 180000,
    dataAbertura: '2026-07-20T09:00:00.000Z',
    aderencia: 85,
    relevante: null,
    proveniencia: { fonte: 'PNCP', dataColeta: '2026-07-05T11:00:00.000Z', baseLegal: 'Lei 14.133/2021, art. 174' },
  },
  {
    alertaId: 'alerta-005',
    editalId: 'edital-005',
    modalidade: 'Concorrência',
    titulo: 'Desenvolvimento e manutenção de sistemas de informação governamental',
    orgao: 'CGU',
    valorEstimado: 500000,
    dataAbertura: '2026-07-25T14:00:00.000Z',
    aderencia: 71,
    relevante: null,
    proveniencia: { fonte: 'PNCP', dataColeta: '2026-07-05T12:30:00.000Z', baseLegal: 'Lei 14.133/2021, art. 174' },
  },
  {
    alertaId: 'alerta-006',
    editalId: 'edital-006',
    modalidade: '',
    titulo: '',
    orgao: '',
    valorEstimado: null,
    dataAbertura: null,
    aderencia: 55,
    relevante: null,
  },
];

export class AlertasStubGateway implements AlertasApiGateway {
  async listar(_signal: AbortSignal): Promise<AlertaCardItem[]> {
    return Promise.resolve([...STUB_ALERTAS]);
  }
}
