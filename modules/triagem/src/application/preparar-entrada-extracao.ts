import type { EditalId } from '@radar/kernel';
import type { EntradaExtracaoDTO } from './dtos.js';
import type { ObjectStorage } from './ports.js';

/** Item hidratado (texto/anexos/páginas) — mesmo shape usado pelo caminho síncrono e em lote. */
export interface ItemExtracao {
  editalId: EditalId;
  texto: string;
  temTextoSelecionavel: boolean;
  anexosRefs: string[];
  paginas: number;
}

/**
 * Resolve o texto dos anexos (baixados pela Ingestão) e monta o contexto MÍNIMO (P-54) da
 * extração: só o edital e anexos — nunca a classe crítica / estratégia comercial.
 */
export async function prepararEntradaExtracao(
  item: ItemExtracao,
  storage: ObjectStorage,
  signal: AbortSignal,
): Promise<EntradaExtracaoDTO> {
  const anexos = await Promise.all(
    item.anexosRefs.map((ref) => storage.obterTextoAnexo(ref, signal)),
  );
  return {
    editalId: item.editalId,
    texto: item.texto,
    temTextoSelecionavel: item.temTextoSelecionavel,
    anexos,
    paginas: item.paginas,
  };
}
