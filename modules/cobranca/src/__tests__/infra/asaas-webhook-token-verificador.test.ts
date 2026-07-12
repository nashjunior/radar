import { describe, expect, it } from 'vitest';
import { tokenWebhookAsaasValido } from '../../infra/adapters/asaas-webhook-token-verificador.js';

describe('tokenWebhookAsaasValido — comparação em tempo constante (P-107 (5), compensação RAD-239/RAD-253)', () => {
  it('token igual ao segredo ⇒ true', () => {
    expect(tokenWebhookAsaasValido('segredo-forte-123', ['segredo-forte-123'])).toBe(true);
  });

  it('token diferente ⇒ false', () => {
    expect(tokenWebhookAsaasValido('token-errado', ['segredo-forte-123'])).toBe(false);
  });

  it('tokens de comprimento diferente não lançam (hash antes de comparar)', () => {
    expect(() => tokenWebhookAsaasValido('curto', ['segredo-bem-mais-longo-que-o-token'])).not.toThrow();
    expect(tokenWebhookAsaasValido('curto', ['segredo-bem-mais-longo-que-o-token'])).toBe(false);
  });

  it('header ausente (undefined/null/vazio) ⇒ false, fail-closed', () => {
    expect(tokenWebhookAsaasValido(undefined, ['segredo'])).toBe(false);
    expect(tokenWebhookAsaasValido(null, ['segredo'])).toBe(false);
    expect(tokenWebhookAsaasValido('', ['segredo'])).toBe(false);
  });

  it('lista de segredos vazia ⇒ false, nunca aceita por configuração ausente', () => {
    expect(tokenWebhookAsaasValido('qualquer-coisa', [])).toBe(false);
  });

  it('lista só com strings vazias ⇒ false, fail-closed (ambos os segredos não configurados)', () => {
    expect(tokenWebhookAsaasValido('qualquer-coisa', ['', ''])).toBe(false);
  });
});

describe('tokenWebhookAsaasValido — dupla-chave na janela de rotação (RAD-261)', () => {
  const VIGENTE = 'token-vigente-abc';
  const ANTERIOR = 'token-anterior-xyz';

  it('token vigente (primeiro da lista) ⇒ true', () => {
    expect(tokenWebhookAsaasValido(VIGENTE, [VIGENTE, ANTERIOR])).toBe(true);
  });

  it('token anterior (segundo da lista) ⇒ true durante a janela', () => {
    expect(tokenWebhookAsaasValido(ANTERIOR, [VIGENTE, ANTERIOR])).toBe(true);
  });

  it('token de terceiro (nem vigente nem anterior) ⇒ false', () => {
    expect(tokenWebhookAsaasValido('token-de-terceiro', [VIGENTE, ANTERIOR])).toBe(false);
  });

  it('ASAAS_WEBHOOK_TOKEN_ANTERIOR ausente (string vazia) não afrouxa a checagem do vigente', () => {
    expect(tokenWebhookAsaasValido(VIGENTE, [VIGENTE, ''])).toBe(true);
    expect(tokenWebhookAsaasValido('qualquer-coisa', [VIGENTE, ''])).toBe(false);
  });
});
