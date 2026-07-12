import { describe, expect, it, vi } from 'vitest';
import { CircuitBreakerPncpGateway } from '../../infra/adapters/circuit-breaker-pncp-gateway.js';
import { CircuitBreaker } from '../../infra/adapters/circuit-breaker.js';
import { BreakerAbertoError } from '../../domain/errors/index.js';
import type { ContratacaoData, PncpGateway } from '../../application/ports.js';

const configBase = {
  nome: 'PNCP',
  limiarFalhas: 1,
  timeoutAberturaMs: 60_000,
  limiarSucessosSonda: 1,
};

function criarSignal() {
  return new AbortController().signal;
}

function contratacaoFake(): ContratacaoData {
  return {
    numeroControlePncp: '1/2026',
    anoCompra: 2026,
    sequencialCompra: 1,
    modalidadeCodigo: 6,
    modalidadeNome: 'Pregão',
    faseAtual: 'Publicada',
    objeto: 'objeto',
    valorEstimado: null,
    prazoProposta: null,
    dataPublicacao: new Date(),
    dataAtualizacao: new Date(),
    orgao: { cnpj: '00000000000000', nome: 'Órgão', uf: 'SP', municipio: 'São Paulo' },
    itens: [],
  };
}

describe('CircuitBreakerPncpGateway', () => {
  describe('breaker fechado', () => {
    it('itera as páginas de buscarContratacoesPorPublicacao repassando o resultado do inner', async () => {
      const pagina1 = [contratacaoFake()];
      const pagina2 = [contratacaoFake()];
      const inner: Pick<PncpGateway, 'buscarContratacoesPorPublicacao'> = {
        async *buscarContratacoesPorPublicacao() {
          yield pagina1;
          yield pagina2;
        },
      };
      const gateway = new CircuitBreakerPncpGateway(
        inner as PncpGateway,
        new CircuitBreaker(configBase),
      );

      const paginas: ContratacaoData[][] = [];
      for await (const pagina of gateway.buscarContratacoesPorPublicacao(
        6,
        { inicio: new Date(), fim: new Date() },
        criarSignal(),
      )) {
        paginas.push(pagina);
      }

      expect(paginas).toEqual([pagina1, pagina2]);
    });

    it('delega buscarContratacaoPorNumero ao inner e retorna o resultado', async () => {
      const resultado = contratacaoFake();
      const buscarContratacaoPorNumero = vi.fn().mockResolvedValue(resultado);
      const gateway = new CircuitBreakerPncpGateway(
        { buscarContratacaoPorNumero } as unknown as PncpGateway,
        new CircuitBreaker(configBase),
      );

      const identificador = { cnpj: '00000000000000', anoCompra: 2026, sequencialCompra: 1 };
      const signal = criarSignal();
      const retorno = await gateway.buscarContratacaoPorNumero(identificador, signal);

      expect(retorno).toBe(resultado);
      expect(buscarContratacaoPorNumero).toHaveBeenCalledWith(identificador, signal);
    });
  });

  describe('breaker aberto', () => {
    it('lança BreakerAbertoError sem chamar o inner em buscarContratacaoPorNumero', async () => {
      const breaker = new CircuitBreaker(configBase);
      await expect(
        breaker.executar(() => Promise.reject(new Error('falha PNCP')), criarSignal()),
      ).rejects.toThrow('falha PNCP');
      expect(breaker.estadoAtual).toBe('ABERTO');

      const buscarContratacaoPorNumero = vi.fn();
      const gateway = new CircuitBreakerPncpGateway(
        { buscarContratacaoPorNumero } as unknown as PncpGateway,
        breaker,
      );

      await expect(
        gateway.buscarContratacaoPorNumero(
          { cnpj: '00000000000000', anoCompra: 2026, sequencialCompra: 1 },
          criarSignal(),
        ),
      ).rejects.toBeInstanceOf(BreakerAbertoError);
      expect(buscarContratacaoPorNumero).not.toHaveBeenCalled();
    });

    it('lança BreakerAbertoError na próxima página sem chamar inner.next() de novo', async () => {
      const breaker = new CircuitBreaker(configBase);
      await expect(
        breaker.executar(() => Promise.reject(new Error('falha PNCP')), criarSignal()),
      ).rejects.toThrow('falha PNCP');
      expect(breaker.estadoAtual).toBe('ABERTO');

      const next = vi.fn();
      const buscarContratacoesPorPublicacao = vi.fn().mockReturnValue({ next });
      const gateway = new CircuitBreakerPncpGateway(
        { buscarContratacoesPorPublicacao } as unknown as PncpGateway,
        breaker,
      );

      const iterador = gateway.buscarContratacoesPorPublicacao(
        6,
        { inicio: new Date(), fim: new Date() },
        criarSignal(),
      );

      await expect(iterador.next()).rejects.toBeInstanceOf(BreakerAbertoError);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
