import { describe, expect, it, vi } from 'vitest';
import { CircuitBreaker } from '../../infra/adapters/circuit-breaker.js';
import { BreakerAbertoError } from '../../domain/errors/index.js';
import { PipelineBreakerEstadoMudou } from '../../application/events.js';
import type { EventPublisher } from '../../application/ports.js';

const configBase = {
  nome: 'PNCP',
  limiarFalhas: 3,
  timeoutAberturaMs: 60_000,
  limiarSucessosSonda: 2,
};

function criarPublisher() {
  const publicar = vi.fn<EventPublisher['publicar']>().mockResolvedValue(undefined);
  return { publicar };
}

function criarSignal() {
  return new AbortController().signal;
}

describe('CircuitBreaker', () => {
  describe('estado FECHADO (normal)', () => {
    it('executa fn e retorna resultado quando fechado', async () => {
      const cb = new CircuitBreaker(configBase);
      const resultado = await cb.executar(() => Promise.resolve(42), criarSignal());
      expect(resultado).toBe(42);
      expect(cb.estadoAtual).toBe('FECHADO');
    });

    it('propaga erro da fn sem abrir o breaker antes de atingir o limiar', async () => {
      const cb = new CircuitBreaker(configBase);
      const fn = vi.fn().mockRejectedValue(new Error('falha'));

      for (let i = 0; i < configBase.limiarFalhas - 1; i++) {
        await expect(cb.executar(fn, criarSignal())).rejects.toThrow('falha');
      }
      expect(cb.estadoAtual).toBe('FECHADO');
    });

    it('rejeita com AbortError quando signal já está abortado', async () => {
      const cb = new CircuitBreaker(configBase);
      const ctrl = new AbortController();
      ctrl.abort();
      await expect(cb.executar(() => Promise.resolve(1), ctrl.signal)).rejects.toThrow();
    });
  });

  describe('abertura do breaker (FECHADO → ABERTO)', () => {
    it('abre após limiarFalhas falhas consecutivas', async () => {
      const cb = new CircuitBreaker(configBase);
      const fn = vi.fn().mockRejectedValue(new Error('timeout'));

      for (let i = 0; i < configBase.limiarFalhas; i++) {
        await expect(cb.executar(fn, criarSignal())).rejects.toThrow('timeout');
      }
      expect(cb.estadoAtual).toBe('ABERTO');
    });

    it('lança BreakerAbertoError quando breaker está aberto', async () => {
      const cb = new CircuitBreaker(configBase);
      const fn = vi.fn().mockRejectedValue(new Error('timeout'));

      for (let i = 0; i < configBase.limiarFalhas; i++) {
        await expect(cb.executar(fn, criarSignal())).rejects.toThrow();
      }

      await expect(cb.executar(() => Promise.resolve(1), criarSignal())).rejects.toBeInstanceOf(
        BreakerAbertoError,
      );
    });

    it('emite PipelineBreakerEstadoMudou na transição FECHADO→ABERTO', async () => {
      const publisher = criarPublisher();
      const cb = new CircuitBreaker(configBase, publisher);
      const fn = vi.fn().mockRejectedValue(new Error('boom'));

      for (let i = 0; i < configBase.limiarFalhas; i++) {
        await expect(cb.executar(fn, criarSignal())).rejects.toThrow();
      }

      await vi.waitFor(() => expect(publisher.publicar).toHaveBeenCalled());

      const [evento] = publisher.publicar.mock.calls[0] as [PipelineBreakerEstadoMudou, AbortSignal];
      expect(evento).toBeInstanceOf(PipelineBreakerEstadoMudou);
      expect(evento.payload.estadoAnterior).toBe('FECHADO');
      expect(evento.payload.estadoAtual).toBe('ABERTO');
      expect(evento.payload.breaker).toBe('PNCP');
    });

    it('reseta contadorFalhas após sucesso — não abre com falhas não-consecutivas', async () => {
      const cb = new CircuitBreaker(configBase);
      const falha = vi.fn().mockRejectedValue(new Error('x'));
      const sucesso = vi.fn().mockResolvedValue('ok');

      for (let i = 0; i < configBase.limiarFalhas - 1; i++) {
        await expect(cb.executar(falha, criarSignal())).rejects.toThrow();
      }
      await cb.executar(sucesso, criarSignal()); // reseta o contador
      for (let i = 0; i < configBase.limiarFalhas - 1; i++) {
        await expect(cb.executar(falha, criarSignal())).rejects.toThrow();
      }

      expect(cb.estadoAtual).toBe('FECHADO'); // ainda não atingiu o limiar de novo
    });
  });

  describe('probe e fechamento (ABERTO → MEIO_ABERTO → FECHADO)', () => {
    it('transiciona para MEIO_ABERTO após timeoutAberturaMs e fecha após sondas bem-sucedidas', async () => {
      let agora = 0;
      const cb = new CircuitBreaker(configBase, undefined, () => agora);

      const falha = vi.fn().mockRejectedValue(new Error('down'));
      for (let i = 0; i < configBase.limiarFalhas; i++) {
        await expect(cb.executar(falha, criarSignal())).rejects.toThrow();
      }
      expect(cb.estadoAtual).toBe('ABERTO');

      // Avança o tempo além do timeout de abertura
      agora = configBase.timeoutAberturaMs + 1;

      const sucesso = vi.fn().mockResolvedValue('ok');
      await cb.executar(sucesso, criarSignal()); // primeira sonda → MEIO_ABERTO
      expect(cb.estadoAtual).toBe('MEIO_ABERTO');

      await cb.executar(sucesso, criarSignal()); // segunda sonda → FECHADO (limiarSucessosSonda=2)
      expect(cb.estadoAtual).toBe('FECHADO');
    });

    it('reabre o breaker se sonda falhar em MEIO_ABERTO', async () => {
      let agora = 0;
      const cb = new CircuitBreaker(configBase, undefined, () => agora);

      const falha = vi.fn().mockRejectedValue(new Error('erro'));
      for (let i = 0; i < configBase.limiarFalhas; i++) {
        await expect(cb.executar(falha, criarSignal())).rejects.toThrow();
      }

      agora = configBase.timeoutAberturaMs + 1;
      await expect(cb.executar(falha, criarSignal())).rejects.toThrow(); // sonda falha → ABERTO de novo
      expect(cb.estadoAtual).toBe('ABERTO');
    });

    it('emite eventos nas transições ABERTO→MEIO_ABERTO e MEIO_ABERTO→FECHADO', async () => {
      let agora = 0;
      const publisher = criarPublisher();
      const cb = new CircuitBreaker(configBase, publisher, () => agora);

      const falha = vi.fn().mockRejectedValue(new Error('err'));
      for (let i = 0; i < configBase.limiarFalhas; i++) {
        await expect(cb.executar(falha, criarSignal())).rejects.toThrow();
      }

      agora = configBase.timeoutAberturaMs + 1;
      const sucesso = vi.fn().mockResolvedValue('ok');
      await cb.executar(sucesso, criarSignal()); // ABERTO → MEIO_ABERTO
      await cb.executar(sucesso, criarSignal()); // MEIO_ABERTO → FECHADO

      await vi.waitFor(() => expect(publisher.publicar).toHaveBeenCalledTimes(3));

      const estados = publisher.publicar.mock.calls.map(
        ([e]) => (e as PipelineBreakerEstadoMudou).payload.estadoAtual,
      );
      expect(estados).toEqual(['ABERTO', 'MEIO_ABERTO', 'FECHADO']);
    });
  });

  describe('guardrails de config', () => {
    it('lança RangeError se limiarFalhas <= 0', () => {
      expect(() => new CircuitBreaker({ ...configBase, limiarFalhas: 0 })).toThrow(RangeError);
    });

    it('lança RangeError se timeoutAberturaMs <= 0', () => {
      expect(() => new CircuitBreaker({ ...configBase, timeoutAberturaMs: 0 })).toThrow(RangeError);
    });

    it('lança RangeError se limiarSucessosSonda <= 0', () => {
      expect(() => new CircuitBreaker({ ...configBase, limiarSucessosSonda: 0 })).toThrow(
        RangeError,
      );
    });
  });
});
