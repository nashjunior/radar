import { EditalId } from '@radar/kernel';
import type { AnexosDTO } from '@radar/ingestao';
import type { DocumentosDoEditalPort } from '@radar/ingestao';
import type { DocumentosEditalGateway, DocumentosRef } from '@radar/triagem';

/**
 * ACL adapter no composition root: traduz o Open-Host Service da Ingestão
 * (`DocumentosDoEditalPort`) para o port de leitura da Triagem (`DocumentosEditalGateway`).
 * Isolamento de bounded context: Triagem nunca importa o modelo interno da Ingestão.
 */
export class DocumentosEditalAclAdapter implements DocumentosEditalGateway {
  constructor(private readonly port: DocumentosDoEditalPort) {}

  async obterRefs(editalId: EditalId, signal: AbortSignal): Promise<DocumentosRef> {
    const dto: AnexosDTO = await this.port.obterDocumentos(editalId, signal);
    return {
      editalId,
      arquivos: dto.arquivos.map((a) => ({
        nome: a.nome,
        storageKey: a.storageKey,
        tipoMime: a.tipoMime,
        sequencialDocumento: a.sequencialDocumento,
        tipoDocumentoId: a.tipoDocumentoId,
        tipoDocumentoNome: a.tipoDocumentoNome,
        textoKey: a.textoKey,
        paginas: a.paginas,
      })),
    };
  }
}
