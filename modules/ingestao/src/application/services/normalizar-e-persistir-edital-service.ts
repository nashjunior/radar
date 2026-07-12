import type { EditalId } from '@radar/kernel';
import { Edital } from '../../domain/entities/edital.js';
import type { ContratacaoData, EditalRepository, ProvenienciaRepository } from '../ports.js';

/** Fonte única da proveniência PNCP — citação legal exata em um só lugar (CLAUDE.md). */
export const PROVENIENCIA_PNCP = {
  fonte: 'PNCP',
  baseLegal: 'Lei 14.133/2021, art. 174',
} as const;

/**
 * Normaliza um `ContratacaoData` (ACL do PNCP) em `Edital` e persiste (upsert + proveniência).
 * Usado pelos 3 fluxos de ingestão (`IngerirEditaisUseCase`, `IngerirAtualizacoesUseCase`,
 * `ReconciliarCatalogoUseCase`) — a única variação entre eles é qual evento publicar, decisão
 * que permanece em cada use case.
 */
export class NormalizarEPersistirEditalService {
  constructor(
    private readonly editais: EditalRepository,
    private readonly proveniencias: ProvenienciaRepository,
  ) {}

  async persistir(id: EditalId, dado: ContratacaoData, signal: AbortSignal): Promise<Edital> {
    // Só os campos do agregado — complemento da listagem PNCP fica no ACL/demo.
    const edital = Edital.criar({
      id,
      numeroControlePncp: dado.numeroControlePncp,
      modalidadeCodigo: dado.modalidadeCodigo,
      modalidadeNome: dado.modalidadeNome,
      faseAtual: dado.faseAtual,
      objeto: dado.objeto,
      valorEstimado: dado.valorEstimado,
      prazoProposta: dado.prazoProposta,
      dataPublicacao: dado.dataPublicacao,
      dataAtualizacao: dado.dataAtualizacao,
      orgao: dado.orgao,
      itens: dado.itens,
      proveniencia: {
        fonte: PROVENIENCIA_PNCP.fonte,
        baseLegal: PROVENIENCIA_PNCP.baseLegal,
        coletadoEm: new Date(),
      },
    });

    await this.editais.upsertPorNumeroControle(edital, signal);

    await this.proveniencias.registrar(
      {
        editalId: edital.id,
        fonte: edital.proveniencia.fonte,
        baseLegal: edital.proveniencia.baseLegal,
        coletadoEm: edital.proveniencia.coletadoEm,
      },
      signal,
    );

    return edital;
  }
}
