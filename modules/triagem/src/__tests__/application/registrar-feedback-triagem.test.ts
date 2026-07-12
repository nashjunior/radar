import { describe, expect, it, vi } from 'vitest';
import { AcessoNegadoError, ClienteFinalId, EditalId, PerfilId, TenantId } from '@radar/kernel';
import { RegistrarFeedbackTriagemUseCase, TriagemNaoEncontradaError } from '../../application/use-cases/registrar-feedback-triagem.js';
import { Triagem } from '../../domain/triagem.js';
import { Aderencia } from '../../domain/value-objects/aderencia.js';
import type { EventPublisher, TriagemRepository } from '../../application/ports.js';

const noop = new AbortController().signal;

const EDITAL = EditalId('edital-001');
const PERFIL = PerfilId('perfil-001');
const TENANT = TenantId('global');
const CLIENTE = ClienteFinalId('cliente-001');

const BASE_INPUT = { editalId: EDITAL, perfilId: PERFIL, tenantId: TENANT, clienteFinalId: CLIENTE };

function triagemConcluida() {
  return Triagem.reconstituir({
    editalId: EDITAL,
    perfilId: PERFIL,
    tenantId: TENANT,
    clienteFinalId: CLIENTE,
    status: 'concluida',
    aderencia: Aderencia.criar(0.8),
    recomendacao: 'go',
    riscos: [],
  });
}

function repos(triagem: Triagem | null) {
  const publicar = vi.fn().mockResolvedValue(undefined);
  const triagens: TriagemRepository = {
    porEditalEPerfil: vi.fn().mockResolvedValue(triagem),
    salvar: vi.fn(),
    listarProcessandoPorEdital: vi.fn().mockResolvedValue([]),
  };
  const eventos: EventPublisher = { publicar };
  return { triagens, eventos, publicar };
}

describe('RegistrarFeedbackTriagemUseCase', () => {
  describe('aceita (UTI1)', () => {
    it('emite triagem.aceita com payload correto', async () => {
      const { triagens, eventos, publicar } = repos(triagemConcluida());
      const uc = new RegistrarFeedbackTriagemUseCase(triagens, eventos);

      await uc.executar({ ...BASE_INPUT, tipo: 'aceita' }, noop);

      expect(publicar).toHaveBeenCalledOnce();
      const [evento] = publicar.mock.calls[0]!;
      expect(evento.type).toBe('triagem.aceita');
      expect(evento.payload.editalId).toBe(EDITAL);
      expect(evento.payload.clienteFinalId).toBe(CLIENTE);
    });
  });

  describe('contestada (UTI1)', () => {
    it('emite triagem.contestada com motivo quando fornecido', async () => {
      const { triagens, eventos, publicar } = repos(triagemConcluida());
      const uc = new RegistrarFeedbackTriagemUseCase(triagens, eventos);

      await uc.executar({ ...BASE_INPUT, tipo: 'contestada', motivo: 'Objeto diverge do TR' }, noop);

      const [evento] = publicar.mock.calls[0]!;
      expect(evento.type).toBe('triagem.contestada');
      expect(evento.payload.motivo).toBe('Objeto diverge do TR');
    });

    it('emite triagem.contestada com motivo null quando omitido', async () => {
      const { triagens, eventos, publicar } = repos(triagemConcluida());
      const uc = new RegistrarFeedbackTriagemUseCase(triagens, eventos);

      await uc.executar({ ...BASE_INPUT, tipo: 'contestada', motivo: null }, noop);

      expect(publicar.mock.calls[0]![0].payload.motivo).toBeNull();
    });
  });

  describe('decisao (UTI2)', () => {
    it('emite triagem.decisao com go:true', async () => {
      const { triagens, eventos, publicar } = repos(triagemConcluida());
      const uc = new RegistrarFeedbackTriagemUseCase(triagens, eventos);

      await uc.executar({ ...BASE_INPUT, tipo: 'decisao', go: true }, noop);

      const [evento] = publicar.mock.calls[0]!;
      expect(evento.type).toBe('triagem.decisao');
      expect(evento.payload.go).toBe(true);
    });

    it('emite triagem.decisao com go:false', async () => {
      const { triagens, eventos, publicar } = repos(triagemConcluida());
      const uc = new RegistrarFeedbackTriagemUseCase(triagens, eventos);

      await uc.executar({ ...BASE_INPUT, tipo: 'decisao', go: false }, noop);

      expect(publicar.mock.calls[0]![0].payload.go).toBe(false);
    });
  });

  describe('autorização por objeto (P-51)', () => {
    it('lança AcessoNegadoError quando tenantId diverge', async () => {
      const outraTenant = Triagem.reconstituir({
        editalId: EDITAL, perfilId: PERFIL,
        tenantId: TenantId('outro-tenant'),
        clienteFinalId: CLIENTE,
        status: 'concluida',
        aderencia: Aderencia.criar(0.8),
        recomendacao: 'go', riscos: [],
      });
      const { triagens, eventos } = repos(outraTenant);
      const uc = new RegistrarFeedbackTriagemUseCase(triagens, eventos);

      await expect(uc.executar({ ...BASE_INPUT, tipo: 'aceita' }, noop)).rejects.toThrow(AcessoNegadoError);
    });

    it('lança AcessoNegadoError quando clienteFinalId diverge', async () => {
      const outroCliente = Triagem.reconstituir({
        editalId: EDITAL, perfilId: PERFIL, tenantId: TENANT,
        clienteFinalId: ClienteFinalId('cliente-999'),
        status: 'concluida',
        aderencia: Aderencia.criar(0.8),
        recomendacao: 'go', riscos: [],
      });
      const { triagens, eventos } = repos(outroCliente);
      const uc = new RegistrarFeedbackTriagemUseCase(triagens, eventos);

      await expect(uc.executar({ ...BASE_INPUT, tipo: 'aceita' }, noop)).rejects.toThrow(AcessoNegadoError);
    });
  });

  describe('triagem inexistente', () => {
    it('lança TriagemNaoEncontradaError (→ BFF 404) quando não há triagem', async () => {
      const { triagens, eventos } = repos(null);
      const uc = new RegistrarFeedbackTriagemUseCase(triagens, eventos);

      await expect(uc.executar({ ...BASE_INPUT, tipo: 'aceita' }, noop)).rejects.toThrow(TriagemNaoEncontradaError);
    });
  });

  describe('propagação de AbortSignal (P-78)', () => {
    it('repassa o signal ao repositório', async () => {
      const { triagens, eventos } = repos(triagemConcluida());
      const uc = new RegistrarFeedbackTriagemUseCase(triagens, eventos);

      await uc.executar({ ...BASE_INPUT, tipo: 'aceita' }, noop);

      expect(triagens.porEditalEPerfil).toHaveBeenCalledWith(TENANT, CLIENTE, EDITAL, PERFIL, noop);
    });

    it('repassa o signal ao publicar evento', async () => {
      const { triagens, eventos, publicar } = repos(triagemConcluida());
      const uc = new RegistrarFeedbackTriagemUseCase(triagens, eventos);

      await uc.executar({ ...BASE_INPUT, tipo: 'aceita' }, noop);

      expect(publicar).toHaveBeenCalledWith(expect.any(Object), noop);
    });
  });

  describe('comportamento com triagem em estado não-concluído (gap RAD-81)', () => {
    it('aceita feedback em triagem processando — sem guarda de status atual', async () => {
      // Documentação de gap: o use case não valida status antes de emitir evento.
      // Implicação: feedback sobre triagem ainda em processamento é aceito silenciosamente.
      // Se isso for indesejável, adicionar guarda de status aqui e atualizar este teste.
      const triagemPendente = Triagem.pendente(EDITAL, PERFIL, TENANT, CLIENTE);
      const { triagens, eventos, publicar } = repos(triagemPendente);
      const uc = new RegistrarFeedbackTriagemUseCase(triagens, eventos);

      await uc.executar({ ...BASE_INPUT, tipo: 'aceita' }, noop);

      expect(publicar).toHaveBeenCalledOnce();
    });
  });
});
