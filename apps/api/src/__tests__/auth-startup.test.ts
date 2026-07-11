import { describe, expect, it } from 'vitest';
import { resolverConfigAuth } from '../middleware/tenant.js';

describe('resolverConfigAuth', () => {
  describe('invariante P-91 — fail-closed em produção', () => {
    it('lança se NODE_ENV=production e AUTH_MODE=dev', () => {
      expect(() =>
        resolverConfigAuth({ NODE_ENV: 'production', AUTH_MODE: 'dev' }),
      ).toThrow('AUTH_MODE=dev é proibido em NODE_ENV=production');
    });

    it('não lança em NODE_ENV=production com modo cognito e vars obrigatórias', () => {
      expect(() =>
        resolverConfigAuth({
          NODE_ENV: 'production',
          COGNITO_USER_POOL_ID: 'sa-east-1_ABC',
          COGNITO_CLIENT_ID: 'client-id',
        }),
      ).not.toThrow();
    });
  });

  describe('modo dev', () => {
    it('lança se AUTH_DEV_SECRET ausente', () => {
      expect(() =>
        resolverConfigAuth({ NODE_ENV: 'development', AUTH_MODE: 'dev' }),
      ).toThrow('AUTH_DEV_SECRET é obrigatório');
    });

    it('não lança com AUTH_DEV_SECRET presente em desenvolvimento', () => {
      expect(() =>
        resolverConfigAuth({
          NODE_ENV: 'development',
          AUTH_MODE: 'dev',
          AUTH_DEV_SECRET: 'segredo-de-dev-minimo-32-caracteres-ok',
        }),
      ).not.toThrow();
    });

    it('não lança com AUTH_DEV_SECRET presente sem NODE_ENV explícito', () => {
      expect(() =>
        resolverConfigAuth({ AUTH_MODE: 'dev', AUTH_DEV_SECRET: 'meu-segredo-de-dev' }),
      ).not.toThrow();
    });
  });

  describe('modo cognito', () => {
    it('lança se COGNITO_USER_POOL_ID ausente', () => {
      expect(() =>
        resolverConfigAuth({ NODE_ENV: 'production', COGNITO_CLIENT_ID: 'client' }),
      ).toThrow('COGNITO_USER_POOL_ID é obrigatório');
    });

    it('lança se COGNITO_CLIENT_ID ausente', () => {
      expect(() =>
        resolverConfigAuth({ NODE_ENV: 'production', COGNITO_USER_POOL_ID: 'pool-123' }),
      ).toThrow('COGNITO_CLIENT_ID é obrigatório');
    });

    it('não lança com ambas as vars obrigatórias presentes', () => {
      expect(() =>
        resolverConfigAuth({
          COGNITO_USER_POOL_ID: 'sa-east-1_ABC',
          COGNITO_CLIENT_ID: 'client-id',
        }),
      ).not.toThrow();
    });
  });
});
