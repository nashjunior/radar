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

  async obter(chaveOuUri: string, signal: AbortSignal): Promise<Uint8Array> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.chave(chaveOuUri),
      }),
      { abortSignal: signal },
    );

    if (!response.Body) throw new ObjetoNaoEncontradoError(chaveOuUri);
    return response.Body.transformToByteArray();
  }

  async deletar(chaveOuUri: string, signal: AbortSignal): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: this.chave(chaveOuUri),
      }),
      { abortSignal: signal },
    );
  }

  /**
   * `armazenar` devolve a URI `s3://<bucket>/<chave>` (identificador opaco persistido como
   * `storageKey`/`textoKey`, RAD-278); `obter`/`deletar` recebem esse MESMO valor de volta. Contra
   * S3 real, `Key` precisa ser só a chave — sem descontar o prefixo `s3://bucket/` a busca sempre
   * falha (`NoSuchKey`), erro invisível a testes que usam objetos mockados com chave e URI iguais
   * por coincidência. Aceita a chave crua também, por retrocompatibilidade.
   */
  private chave(chaveOuUri: string): string {
    const prefixo = `s3://${this.bucket}/`;
    return chaveOuUri.startsWith(prefixo) ? chaveOuUri.slice(prefixo.length) : chaveOuUri;
  }
}
