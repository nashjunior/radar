import { EditalId } from '@radar/kernel';
import type { IdProvider } from '../../application/ports.js';

/** Gera EditalIds usando crypto.randomUUID() (Node ≥ 19 / Web Crypto). */
export class CryptoIdProvider implements IdProvider {
  gerar(): EditalId {
    return EditalId(crypto.randomUUID());
  }
}
