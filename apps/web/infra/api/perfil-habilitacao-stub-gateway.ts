import type { PerfilHabilitacaoGateway, PerfilHabilitacaoDTO } from '@/application/ports.js';

/** Stub — retorna perfil vazio até RAD-109 publicar o endpoint real. */
export class PerfilHabilitacaoStubGateway implements PerfilHabilitacaoGateway {
  private stored: PerfilHabilitacaoDTO | null = null;

  async consultar(signal: AbortSignal): Promise<PerfilHabilitacaoDTO | null> {
    await delay(200, signal);
    return this.stored;
  }

  async salvar(input: PerfilHabilitacaoDTO, signal: AbortSignal): Promise<void> {
    await delay(300, signal);
    this.stored = { ...input };
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason);
    });
  });
}
