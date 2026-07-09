import { describe, expect, it, vi } from 'vitest';
import { AlertaId, TenantId } from '@radar/kernel';
import {
  EnviarDigestUseCase,
  type EnviarDigestInput,
} from '../../application/use-cases/enviar-digest.js';
import { CanalIndisponivelError } from '../../domain/errors/index.js';
import { NotificacaoEnviada } from '../../application/events.js';
import { Notificacao, UsuarioId } from '../../domain/entities/notificacao.js';
import type {
  AlertaRepository,
  EventPublisher,
  IdProvider,
  Notifier,
  NotificacaoRepository,
  PreferenciaRepository,
} from '../../application/ports.js';
import type { AlertaResumoDTO, PreferenciaDTO } from '../../application/dtos.js';

const TENANT = TenantId('t-001');
const USUARIO = UsuarioId('u-001');
const EMAIL = 'usuario@exemplo.com.br';
const noop = new AbortController().signal;

const INPUT: EnviarDigestInput = {
  usuarioId: USUARIO,
  tenantId: TENANT,
  emailDestinatario: EMAIL,
  janela: { inicio: new Date('2024-01-01T00:00:00Z') },
};

function makeAlerta(id: string, aderencia: number): AlertaResumoDTO {
  return {
    id: AlertaId(id),
    objeto: `Objeto ${id}`,
    orgao: 'Prefeitura SP',
    uf: 'SP',
    prazoProposta: new Date('2024-06-01T00:00:00Z'),
    aderencia,
    diasAtePrazo: 30,
  };
}

function makePref(frequencia: PreferenciaDTO['frequencia'] = 'DIARIA'): PreferenciaDTO {
  return { usuarioId: USUARIO, canais: ['EMAIL'], frequencia };
}

function makeDeps(
  opts: {
    preferencia?: PreferenciaDTO | null;
    pendentes?: AlertaResumoDTO[];
    notifierFails?: boolean;
  } = {},
) {
  const pref = opts.preferencia !== undefined ? opts.preferencia : makePref();
  const pendentes = opts.pendentes ?? [makeAlerta('a-001', 0.9)];

  const preferencias: PreferenciaRepository = {
    porUsuario: vi.fn().mockResolvedValue(pref),
    salvar: vi.fn(),
  };
  const alertas: AlertaRepository = {
    porId: vi.fn(),
    pendentesDigest: vi.fn().mockResolvedValue(pendentes),
  };
  const notificacoes: NotificacaoRepository = {
    salvar: vi.fn().mockResolvedValue(undefined),
    jaNotificado: vi.fn(),
  };
  const notifier: Notifier = {
    enviar: opts.notifierFails
      ? vi.fn().mockRejectedValue(new Error('SES timeout'))
      : vi.fn().mockResolvedValue(undefined),
  };
  const eventos: EventPublisher = { publicar: vi.fn().mockResolvedValue(undefined) };
  const ids: IdProvider = { gerar: vi.fn().mockReturnValue('notif-001') };

  return { preferencias, alertas, notificacoes, notifier, eventos, ids };
}

function makeUC(deps: ReturnType<typeof makeDeps>): EnviarDigestUseCase {
  return new EnviarDigestUseCase(
    deps.alertas,
    deps.preferencias,
    deps.notificacoes,
    deps.notifier,
    deps.eventos,
    deps.ids,
  );
}

describe('EnviarDigestUseCase', () => {
  describe('skip early — sem envio', () => {
    it('retorna zeros quando não há preferência cadastrada', async () => {
      const deps = makeDeps({ preferencia: null });
      const dto = await makeUC(deps).executar(INPUT, noop);

      expect(dto).toEqual({ enviados: 0, agrupados: 0 });
      expect(deps.notifier.enviar).not.toHaveBeenCalled();
    });

    it('retorna zeros quando usuário tem frequência IMEDIATA (digest não se aplica)', async () => {
      const deps = makeDeps({ preferencia: makePref('IMEDIATA') });
      const dto = await makeUC(deps).executar(INPUT, noop);

      expect(dto).toEqual({ enviados: 0, agrupados: 0 });
      expect(deps.notifier.enviar).not.toHaveBeenCalled();
    });

    it('retorna zeros quando não há alertas pendentes no período', async () => {
      const deps = makeDeps({ pendentes: [] });
      const dto = await makeUC(deps).executar(INPUT, noop);

      expect(dto).toEqual({ enviados: 0, agrupados: 0 });
      expect(deps.notifier.enviar).not.toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    it('envia digest, salva Notificacao ENVIADA e emite NotificacaoEnviada', async () => {
      const deps = makeDeps();
      const dto = await makeUC(deps).executar(INPUT, noop);

      expect(dto).toEqual({ enviados: 1, agrupados: 1 });
      expect(deps.notifier.enviar).toHaveBeenCalledOnce();
      expect(deps.notificacoes.salvar).toHaveBeenCalledOnce();
      const [notif] = deps.notificacoes.salvar.mock.calls[0]! as [Notificacao];
      expect(notif.status).toBe('ENVIADA');
      expect(deps.eventos.publicar).toHaveBeenCalledOnce();
      const [evento] = deps.eventos.publicar.mock.calls[0]! as [NotificacaoEnviada];
      expect(evento).toBeInstanceOf(NotificacaoEnviada);
      expect(evento.payload.tenantId).toBe(TENANT);
    });

    it('reporta agrupados = total de pendentes e enviados = cap quando acima do cap', async () => {
      const muitos = Array.from({ length: 25 }, (_, i) =>
        makeAlerta(`a-${String(i).padStart(3, '0')}`, i / 25),
      );
      const deps = makeDeps({ pendentes: muitos });
      const dto = await makeUC(deps).executar(INPUT, noop);

      expect(dto.enviados).toBe(20);
      expect(dto.agrupados).toBe(25);
    });
  });

  describe('anti-fadiga — cap e ordenação', () => {
    it('seleciona os 20 de maior aderência quando há mais de 20 alertas', async () => {
      const pendentes = Array.from({ length: 25 }, (_, i) =>
        makeAlerta(`a-${i}`, i * 0.04),
      );
      const deps = makeDeps({ pendentes });
      await makeUC(deps).executar(INPUT, noop);

      const [, , , opts] = deps.notifier.enviar.mock.calls[0]! as [
        unknown, unknown, unknown, { corpo: string },
      ];
      // Os alertas de índice 24..5 têm maior aderência; o de menor (i=0) não deve aparecer
      expect(opts?.corpo ?? (deps.notifier.enviar.mock.calls[0] as {corpo: string}[])[0]?.corpo ?? '').not.toContain('a-0');
    });

    it('ordena digest por aderência decrescente (o de maior aderência aparece primeiro)', async () => {
      const pendentes = [
        makeAlerta('baixo', 0.2),
        makeAlerta('alto', 0.9),
        makeAlerta('medio', 0.5),
      ];
      const deps = makeDeps({ pendentes });
      await makeUC(deps).executar(INPUT, noop);

      const callArgs = deps.notifier.enviar.mock.calls[0]![0] as {corpo?: string} | {canal: unknown; destinatario: unknown; assunto: unknown; corpo: string; signal: AbortSignal};
      const corpo = 'corpo' in callArgs ? callArgs.corpo : '';
      // corpo é uma string com linhas — "alto" deve vir antes de "medio" e "baixo"
      const posAlto = corpo.indexOf('alto');
      const posMedio = corpo.indexOf('medio');
      const posBaixo = corpo.indexOf('baixo');
      expect(posAlto).toBeLessThan(posMedio);
      expect(posMedio).toBeLessThan(posBaixo);
    });
  });

  describe('falha do notifier', () => {
    it('salva Notificacao com status FALHOU e relança CanalIndisponivelError', async () => {
      const deps = makeDeps({ notifierFails: true });

      await expect(makeUC(deps).executar(INPUT, noop)).rejects.toThrow(CanalIndisponivelError);

      expect(deps.notificacoes.salvar).toHaveBeenCalledOnce();
      const [notif] = deps.notificacoes.salvar.mock.calls[0]! as [Notificacao];
      expect(notif.status).toBe('FALHOU');
      expect(deps.eventos.publicar).not.toHaveBeenCalled();
    });
  });

  describe('AbortSignal (P-78)', () => {
    it('propaga signal à consulta de preferências', async () => {
      const ac = new AbortController();
      const deps = makeDeps();
      await makeUC(deps).executar({ ...INPUT, janela: INPUT.janela }, ac.signal);

      expect(deps.preferencias.porUsuario).toHaveBeenCalledWith(USUARIO, ac.signal);
    });

    it('propaga signal à consulta de alertas pendentes', async () => {
      const ac = new AbortController();
      const deps = makeDeps();
      await makeUC(deps).executar(INPUT, ac.signal);

      expect(deps.alertas.pendentesDigest).toHaveBeenCalledWith(
        { usuarioId: USUARIO, aPartirDe: INPUT.janela.inicio },
        ac.signal,
      );
    });
  });
});
