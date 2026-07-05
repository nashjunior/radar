import type { IdProvider } from '../../application/ports.js';

export class CryptoIdProvider implements IdProvider {
  gerar(): string {
    return crypto.randomUUID();
  }
}
