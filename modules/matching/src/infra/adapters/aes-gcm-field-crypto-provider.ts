import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { FieldCryptoProvider } from '../../application/ports.js';

const PREFIXO = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Criptografia de campo AES-256-GCM para classe crítica (docs/05 §9, P-59).
 * A chave vem de cofre/env em production; nunca há default hardcoded.
 */
export class AesGcmFieldCryptoProvider implements FieldCryptoProvider {
  private constructor(private readonly key: Buffer) {}

  static fromBase64Key(base64Key: string): AesGcmFieldCryptoProvider {
    const key = Buffer.from(base64Key, 'base64');
    if (key.length !== 32) throw new Error('FIELD_CRYPTO_KEY deve ter 32 bytes em base64');
    return new AesGcmFieldCryptoProvider(key);
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): AesGcmFieldCryptoProvider {
    const key = env.FIELD_CRYPTO_KEY;
    if (!key) throw new Error('FIELD_CRYPTO_KEY ausente');
    return AesGcmFieldCryptoProvider.fromBase64Key(key);
  }

  async cifrarTexto(valor: string, contexto: string, signal: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(contextoAad(contexto));
    const ciphertext = Buffer.concat([cipher.update(valor, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [PREFIXO, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(':');
  }

  async decifrarTexto(valor: string, contexto: string, signal: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    if (!valor.startsWith(`${PREFIXO}:`)) return valor;

    const partes = valor.split(':');
    if (partes.length !== 4) throw new Error('campo cifrado inválido');
    const [, iv64, tag64, ciphertext64] = partes;
    const iv = Buffer.from(iv64!, 'base64url');
    const tag = Buffer.from(tag64!, 'base64url');
    const ciphertext = Buffer.from(ciphertext64!, 'base64url');

    const decipher = createDecipheriv('aes-256-gcm', this.key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(contextoAad(contexto));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}

function contextoAad(contexto: string): Buffer {
  return createHash('sha256').update(contexto).digest();
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new Error('operação abortada');
}
