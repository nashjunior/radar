import type { AnexoScanner } from '../../application/ports.js';

/**
 * Stub do scanner AV/malware para o MVP de dev.
 * Aprova todos os anexos como limpos sem escanear de fato.
 *
 * Substituir por implementação real (ClamAV, Lambda ou serviço equivalente)
 * antes do lançamento (P-104, pré-lançamento).
 */
export class StubAnexoScanner implements AnexoScanner {
  async escanear(_storageKey: string, _signal: AbortSignal): Promise<'limpo' | 'rejeitado'> {
    return 'limpo';
  }
}
