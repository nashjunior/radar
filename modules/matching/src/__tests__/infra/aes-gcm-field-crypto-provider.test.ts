import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AesGcmFieldCryptoProvider } from '../../infra/adapters/aes-gcm-field-crypto-provider.js';

const signal = new AbortController().signal;

// Formato de contexto espelhando contexto() do PostgresCriterioRepository:
// "matching.criterio_monitoramento:{tenant_id}:{cliente_final_id}:{criterio_id}:{campo}"
function ctx(tenantId: string, clienteFinalId: string, criterioId: string, campo: string) {
  return `matching.criterio_monitoramento:${tenantId}:${clienteFinalId}:${criterioId}:${campo}`;
}

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

  // ---------------------------------------------------------------------------
  // Testes de segurança — isolamento cross-tenant (docs/05 §9, P-59, AB1)
  // Verifica que o AAD (contexto) impede decifração cross-tenant mesmo com a
  // mesma chave: mudança de tenant_id, cliente_final_id ou criterio_id na AAD
  // invalida a auth tag do AES-256-GCM e resulta em erro de autenticação.
  // ---------------------------------------------------------------------------

  describe('isolamento cross-tenant por AAD (P-59 / docs/05 §9)', () => {
    it('decifrar com tenant diferente falha mesmo com mesma chave e campo', async () => {
      const provider = AesGcmFieldCryptoProvider.fromBase64Key(randomBytes(32).toString('base64'));
      const cifrado = await provider.cifrarTexto(
        'R$ 500.000',
        ctx('tenant-a', 'cliente-a', 'criterio-1', 'faixa_valor_max'),
        signal,
      );

      await expect(
        provider.decifrarTexto(
          cifrado,
          ctx('tenant-b', 'cliente-a', 'criterio-1', 'faixa_valor_max'),
          signal,
        ),
      ).rejects.toThrow();
    });

    it('decifrar com cliente_final_id diferente falha', async () => {
      const provider = AesGcmFieldCryptoProvider.fromBase64Key(randomBytes(32).toString('base64'));
      const cifrado = await provider.cifrarTexto(
        'R$ 200.000',
        ctx('tenant-a', 'cliente-a', 'criterio-1', 'faixa_valor_min'),
        signal,
      );

      await expect(
        provider.decifrarTexto(
          cifrado,
          ctx('tenant-a', 'cliente-b', 'criterio-1', 'faixa_valor_min'),
          signal,
        ),
      ).rejects.toThrow();
    });

    it('decifrar com criterio_id diferente falha (isolamento entre critérios)', async () => {
      const provider = AesGcmFieldCryptoProvider.fromBase64Key(randomBytes(32).toString('base64'));
      const cifrado = await provider.cifrarTexto(
        'software',
        ctx('tenant-a', 'cliente-a', 'criterio-1', 'palavras_chave:0'),
        signal,
      );

      await expect(
        provider.decifrarTexto(
          cifrado,
          ctx('tenant-a', 'cliente-a', 'criterio-2', 'palavras_chave:0'),
          signal,
        ),
      ).rejects.toThrow();
    });

    it('decifrar com campo diferente falha (isolamento cross-field)', async () => {
      const provider = AesGcmFieldCryptoProvider.fromBase64Key(randomBytes(32).toString('base64'));
      const cifrado = await provider.cifrarTexto(
        '62.01',
        ctx('tenant-a', 'cliente-a', 'criterio-1', 'ramo_cnae'),
        signal,
      );

      await expect(
        provider.decifrarTexto(
          cifrado,
          ctx('tenant-a', 'cliente-a', 'criterio-1', 'regiao_uf'),
          signal,
        ),
      ).rejects.toThrow();
    });

    it('decifrar valor de tenant-a com chave diferente falha', async () => {
      const providerA = AesGcmFieldCryptoProvider.fromBase64Key(randomBytes(32).toString('base64'));
      const providerB = AesGcmFieldCryptoProvider.fromBase64Key(randomBytes(32).toString('base64'));

      const cifrado = await providerA.cifrarTexto(
        'estratégia-secreta',
        ctx('tenant-a', 'cliente-a', 'criterio-1', 'ramo_cnae'),
        signal,
      );

      await expect(
        providerB.decifrarTexto(
          cifrado,
          ctx('tenant-a', 'cliente-a', 'criterio-1', 'ramo_cnae'),
          signal,
        ),
      ).rejects.toThrow();
    });

    it('fromEnv exige FIELD_CRYPTO_KEY; falha sem a variável', () => {
      expect(() => AesGcmFieldCryptoProvider.fromEnv({})).toThrow('FIELD_CRYPTO_KEY ausente');
    });

    it('fromBase64Key rejeita chave de tamanho incorreto', () => {
      expect(() =>
        AesGcmFieldCryptoProvider.fromBase64Key(randomBytes(16).toString('base64')),
      ).toThrow('32 bytes');
    });
  });
});
