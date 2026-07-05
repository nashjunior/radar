import type { ObjectStorage } from '../../application/ports.js';

/**
 * Adaptador S3 para armazenamento de anexos (PDFs) de editais.
 * [A VALIDAR — provedor de object storage: S3 / GCS / R2]
 *
 * TODO: implementar com @aws-sdk/client-s3 quando o provedor for escolhido.
 * Retenção dos arquivos segue a política de docs/05, §5. [A VALIDAR — prazo]
 */
export class S3ObjectStorage implements ObjectStorage {
  // constructor(
  //   private readonly client: S3Client,
  //   private readonly bucket: string,
  // ) {}

  async armazenar(
    _chave: string,
    _conteudo: Uint8Array,
    _metadados: { contentType: string },
    _signal: AbortSignal,
  ): Promise<string> {
    // TODO:
    // await client.send(new PutObjectCommand({
    //   Bucket: this.bucket,
    //   Key: _chave,
    //   Body: _conteudo,
    //   ContentType: _metadados.contentType,
    // }));
    // return `s3://${this.bucket}/${_chave}`;
    throw new Error('S3ObjectStorage.armazenar: não implementado');
  }
}
