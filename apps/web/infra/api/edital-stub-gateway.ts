/**
 * Gateway stub — retorna dados de demonstração enquanto o BFF
 * não expõe GET /api/editais/:id (A VALIDAR — trocar por EditalHttpGateway).
 * Proveniência alinhada ao contrato RAD-72 / bab8e09.
 */
import type { EditalId } from '@radar/kernel';
import type { EditalGateway } from '@/application/ports';
import type { EditalDetalhe } from '@/domain/edital-detalhe';

export class EditalStubGateway implements EditalGateway {
  async buscarDetalhes(editalId: EditalId, signal: AbortSignal): Promise<EditalDetalhe | null> {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, 200);
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(signal.reason);
      });
    });

    return {
      id: editalId,
      titulo: 'Aquisição de equipamentos de informática para uso administrativo — Pregão Eletrônico nº 001/2026',
      modalidade: 'Pregão Eletrônico',
      numero: '001/2026',
      orgao: { nome: 'Min. da Educação — FNDE', uf: 'DF' },
      valorEstimado: 85000,
      dataAbertura: '2026-07-10T14:00:00-03:00',
      modoDisputa: 'Disputa aberta',
      proveniencia: {
        fonte: 'PNCP',
        dataColeta: '2026-06-15T00:00:00Z',
        baseLegal: 'Lei 14.133/2021, art. 174',
      },
    };
  }
}
