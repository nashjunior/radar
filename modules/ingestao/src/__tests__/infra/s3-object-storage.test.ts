/**
 * Testes do S3ObjectStorage — mock do @aws-sdk/client-s3 (sem chamadas reais).
 * Cobre: armazenar (PUT + checksum SHA256), obter (GET → bytes), deletar (DELETE),
 *        propagação do AbortSignal (P-78) e integridade (checksum obrigatório no PUT).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { S3ObjectStorage } from '../../infra/adapters/s3-object-storage.js';

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const original = await importOriginal<typeof import('@aws-sdk/client-s3')>();
  return {
    ...original,
    S3Client: vi.fn().mockImplementation(() => ({ send: vi.fn() })),
  };
});

const BUCKET = 'radar-editais-test';
const CHAVE = 'editais/abc/anexo.pdf';
const CONTEUDO = new Uint8Array([1, 2, 3, 4]);
const CONTENT_TYPE = 'application/pdf';
const SIGNAL = new AbortController().signal;

function buildStorage() {
  const client = new S3Client({});
  const storage = new S3ObjectStorage(client, BUCKET);
  return { storage, send: vi.mocked(client.send) };
}

describe('S3ObjectStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('armazenar', () => {
    it('chama PutObjectCommand com bucket, chave, conteúdo e contentType', async () => {
      const { storage, send } = buildStorage();
      send.mockResolvedValue({} as never);

      await storage.armazenar(CHAVE, CONTEUDO, { contentType: CONTENT_TYPE }, SIGNAL);

      expect(send).toHaveBeenCalledOnce();
      const [cmd, opts] = send.mock.calls[0]!;
      expect(cmd).toBeInstanceOf(PutObjectCommand);
      expect((cmd as PutObjectCommand).input.Bucket).toBe(BUCKET);
      expect((cmd as PutObjectCommand).input.Key).toBe(CHAVE);
      expect((cmd as PutObjectCommand).input.Body).toBe(CONTEUDO);
      expect((cmd as PutObjectCommand).input.ContentType).toBe(CONTENT_TYPE);
      expect(opts?.abortSignal).toBe(SIGNAL);
    });

    it('usa ChecksumAlgorithm SHA256 para integridade (docs/05 §5)', async () => {
      const { storage, send } = buildStorage();
      send.mockResolvedValue({} as never);

      await storage.armazenar(CHAVE, CONTEUDO, { contentType: CONTENT_TYPE }, SIGNAL);

      const [cmd] = send.mock.calls[0]!;
      expect((cmd as PutObjectCommand).input.ChecksumAlgorithm).toBe('SHA256');
    });

    it('retorna URI s3://<bucket>/<chave>', async () => {
      const { storage, send } = buildStorage();
      send.mockResolvedValue({} as never);

      const uri = await storage.armazenar(CHAVE, CONTEUDO, { contentType: CONTENT_TYPE }, SIGNAL);

      expect(uri).toBe(`s3://${BUCKET}/${CHAVE}`);
    });
  });

  describe('obter', () => {
    it('chama GetObjectCommand com bucket e chave', async () => {
      const { storage, send } = buildStorage();
      const bytes = new Uint8Array([10, 20, 30]);
      send.mockResolvedValue({
        Body: { transformToByteArray: () => Promise.resolve(bytes) },
      } as never);

      const resultado = await storage.obter(CHAVE, SIGNAL);

      expect(send).toHaveBeenCalledOnce();
      const [cmd, opts] = send.mock.calls[0]!;
      expect(cmd).toBeInstanceOf(GetObjectCommand);
      expect((cmd as GetObjectCommand).input.Bucket).toBe(BUCKET);
      expect((cmd as GetObjectCommand).input.Key).toBe(CHAVE);
      expect(opts?.abortSignal).toBe(SIGNAL);
      expect(resultado).toBe(bytes);
    });

    it('lança quando Body está ausente (objeto não encontrado)', async () => {
      const { storage, send } = buildStorage();
      send.mockResolvedValue({ Body: null } as never);

      await expect(storage.obter(CHAVE, SIGNAL)).rejects.toThrow('objeto não encontrado');
    });

    // Regressão: `armazenar` devolve `s3://<bucket>/<chave>` e os callers (ex. EscanearAnexoUseCase)
    // repassam esse mesmo valor de volta como `storageKey`/`textoKey` — sem descontar o prefixo,
    // GetObjectCommand busca uma Key que nunca existiu (NoSuchKey contra S3 real).
    it('aceita a URI s3://<bucket>/<chave> devolvida por armazenar e busca só a chave', async () => {
      const { storage, send } = buildStorage();
      const bytes = new Uint8Array([10, 20, 30]);
      send.mockResolvedValue({
        Body: { transformToByteArray: () => Promise.resolve(bytes) },
      } as never);

      const resultado = await storage.obter(`s3://${BUCKET}/${CHAVE}`, SIGNAL);

      const [cmd] = send.mock.calls[0]!;
      expect((cmd as GetObjectCommand).input.Key).toBe(CHAVE);
      expect(resultado).toBe(bytes);
    });
  });

  describe('deletar', () => {
    it('chama DeleteObjectCommand com bucket e chave', async () => {
      const { storage, send } = buildStorage();
      send.mockResolvedValue({} as never);

      await storage.deletar(CHAVE, SIGNAL);

      expect(send).toHaveBeenCalledOnce();
      const [cmd, opts] = send.mock.calls[0]!;
      expect(cmd).toBeInstanceOf(DeleteObjectCommand);
      expect((cmd as DeleteObjectCommand).input.Bucket).toBe(BUCKET);
      expect((cmd as DeleteObjectCommand).input.Key).toBe(CHAVE);
      expect(opts?.abortSignal).toBe(SIGNAL);
    });

    it('aceita a URI s3://<bucket>/<chave> e apaga só a chave', async () => {
      const { storage, send } = buildStorage();
      send.mockResolvedValue({} as never);

      await storage.deletar(`s3://${BUCKET}/${CHAVE}`, SIGNAL);

      const [cmd] = send.mock.calls[0]!;
      expect((cmd as DeleteObjectCommand).input.Key).toBe(CHAVE);
    });
  });
});
