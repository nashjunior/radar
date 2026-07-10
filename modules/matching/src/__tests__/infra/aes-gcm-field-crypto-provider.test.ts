import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AesGcmFieldCryptoProvider } from '../../infra/adapters/aes-gcm-field-crypto-provider.js';

const signal = new AbortController().signal;

describe('AesGcmFieldCryptoProvider', () => {
  it('cifra e decifra texto com envelope versionado', async () => {
    const provider = AesGcmFieldCryptoProvider.fromBase64Key(randomBytes(32).toString('base64'));

    const cifrado = await provider.cifrarTexto('serviços de TI', 'criterio:campo', signal);
    const decifrado = await provider.decifrarTexto(cifrado, 'criterio:campo', signal);

    expect(cifrado).toMatch(/^v1:/);
    expect(cifrado).not.toContain('serviços de TI');
    expect(decifrado).toBe('serviços de TI');
  });

  it('rejeita decifragem com contexto diferente', async () => {
    const provider = AesGcmFieldCryptoProvider.fromBase64Key(randomBytes(32).toString('base64'));
    const cifrado = await provider.cifrarTexto('estratégia', 'tenant-a:campo', signal);

    await expect(provider.decifrarTexto(cifrado, 'tenant-b:campo', signal)).rejects.toThrow();
  });

  it('preserva valores legados sem envelope para migração compatível', async () => {
    const provider = AesGcmFieldCryptoProvider.fromBase64Key(randomBytes(32).toString('base64'));

    await expect(provider.decifrarTexto('texto-legado', 'criterio:campo', signal)).resolves.toBe('texto-legado');
  });
});
