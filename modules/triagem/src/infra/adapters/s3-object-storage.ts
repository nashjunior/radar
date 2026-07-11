import type { ObjectStorage } from '../../application/ports.js';

/**
 * Client mínimo de object storage, provider-agnóstico (S3 / GCS / R2 [A VALIDAR]). O composition root
 * liga o SDK concreto (get do objeto + extração de texto/OCR); só o contrato mínimo aparece aqui —
 * a tecnologia fica SÓ na infra (P-74). Devolve o texto JÁ resolvido de um anexo.
 */
interface BlobClient {
  obterTexto(ref: string, opts: { signal: AbortSignal }): Promise<string>;
}

/**
 * Adaptador de object storage para os anexos (PDFs) do edital, baixados pela Ingestão (A17 §4.1).
 * O papel aqui é LER: resolver o texto de um anexo por referência. Retenção segue docs/05 §5
 * [A VALIDAR — prazo]. Propaga o `AbortSignal` ao client (P-78).
 */
export class S3ObjectStorage implements ObjectStorage {
  constructor(private readonly client: BlobClient) {}

  async obterTextoAnexo(ref: string, signal: AbortSignal): Promise<string> {
    return this.client.obterTexto(ref, { signal });
  }
}
