import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { ObjetoNaoEncontradoError } from '../../domain/errors/index.js';
import type { ObjectStorage } from '../../application/ports.js';

/**
 * Adapter S3 para armazenamento de anexos (PDFs) de editais — AWS S3, sa-east-1 (P-64/P-28).
 *
 * Integridade: checksum SHA-256 nativo via `x-amz-checksum-sha256` (docs/05 §5).
 * AbortSignal: propagado para todos os comandos (P-78).
 * Tiering: configurado por Lifecycle rules no bucket (arquitetura/08 §3);
 *           não há lógica de tiering no código — é política de storage.
 */
export class S3ObjectStorage implements ObjectStorage {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async armazenar(
    chave: string,
    conteudo: Uint8Array,
    metadados: { contentType: string },
    signal: AbortSignal,
  ): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: chave,
        Body: conteudo,
        ContentType: metadados.contentType,
        ChecksumAlgorithm: 'SHA256',
      }),
      { abortSignal: signal },
    );
    return `s3://${this.bucket}/${chave}`;
  }

  async obter(chave: string, signal: AbortSignal): Promise<Uint8Array> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: chave,
      }),
      { abortSignal: signal },
    );

    if (!response.Body) throw new ObjetoNaoEncontradoError(chave);
    return response.Body.transformToByteArray();
  }

  async deletar(chave: string, signal: AbortSignal): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: chave,
      }),
      { abortSignal: signal },
    );
  }
}
