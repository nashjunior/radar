import { AlertaId, CriterioId } from '@radar/kernel';
import type { AlertaIdProvider, CriterioIdProvider } from '../../application/ports.js';

/** Gera CriterioIds usando crypto.randomUUID() (Node ≥ 19 / Web Crypto). */
export class CryptoCriterioIdProvider implements CriterioIdProvider {
  gerar(): CriterioId {
    return CriterioId(crypto.randomUUID());
  }
}

/** Gera AlertaIds usando crypto.randomUUID() (Node ≥ 19 / Web Crypto). */
export class CryptoAlertaIdProvider implements AlertaIdProvider {
  gerar(): AlertaId {
    return AlertaId(crypto.randomUUID());
  }
}
