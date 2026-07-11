import { describe, expect, it, vi } from 'vitest';
import { AlertaId, CriterioId, TenantId } from '@radar/kernel';
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
import type {
  AlertaResumoDTO,
  DigestPendentesDTO,
  ExcedenteAgrupadoDTO,
  PreferenciaDTO,
} from '../../application/dtos.js';

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
    criterioId: CriterioId(`criterio-${id}`),
    criterioNome: `Critério ${id}`,
  };
}

function makeExcedente(criterioNome: string, quantidade: number): ExcedenteAgrupadoDTO {
  return {
    criterioId: CriterioId(`criterio-${criterioNome}`),
    criterioNome,
    orgao: 'Prefeitura SP',
    quantidade,
  };
}

function makePendentes(overrides: Partial<DigestPendentesDTO> = {}): DigestPendentesDTO {
  const selecionados = overrides.selecionados ?? [makeAlerta('a-001', 0.9)];
  const excedentes = overrides.excedentes ?? [];
  return {
    selecionados,
    excedentes,
    totalPendentes:
      overrides.totalPendentes ??
      selecionados.length + excedentes.reduce((n, e) => n + e.quantidade, 0),
  };
}

function makePref(frequencia: PreferenciaDTO['frequencia'] = 'DIARIA'): PreferenciaDTO {
  return { usuarioId: USUARIO, canais: ['EMAIL'], frequencia };
}

function makeDeps(
  opts: {
    preferencia?: PreferenciaDTO | null;
    pendentes?: DigestPendentesDTO;
    notifierFails?: boolean;
  } = {},
) {
  const pref = opts.preferencia !== undefined ? opts.preferencia : makePref();
  const pendentes = opts.pendentes ?? makePendentes();

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

function makeUC(
  deps: ReturnType<typeof makeDeps>,
  caps?: Record<'DIARIA' | 'SEMANAL', number>,
): EnviarDigestUseCase {
  return new EnviarDigestUseCase(
    deps.alertas,
    deps.preferencias,
    deps.notificacoes,
    deps.notifier,
    deps.eventos,
    deps.ids,
    caps,
  );
}

describe('EnviarDigestUseCase', () => {
  describe('skip early — sem envio', () => {
    it('retorna zeros quando não há preferência cadastrada', async () => {
      const deps = makeDeps({ preferencia: null });
      const dto = await makeUC(deps).executar(INPUT, noop);

      expect(dto).toEqual({ enviados: 0, agrupados: 0, total: 0 });
      expect(deps.notifier.enviar).not.toHaveBeenCalled();
    });

    it('retorna zeros quando usuário tem frequência IMEDIATA (digest não se aplica)', async () => {
      const deps = makeDeps({ preferencia: makePref('IMEDIATA') });
      const dto = await makeUC(deps).executar(INPUT, noop);

      expect(dto).toEqual({ enviados: 0, agrupados: 0, total: 0 });
      expect(deps.notifier.enviar).not.toHaveBeenCalled();
    });

    it('retorna zeros quando não há alertas pendentes no período', async () => {
      const deps = makeDeps({ pendentes: makePendentes({ selecionados: [], excedentes: [], totalPendentes: 0 }) });
      const dto = await makeUC(deps).executar(INPUT, noop);

      expect(dto).toEqual({ enviados: 0, agrupados: 0, total: 0 });
      expect(deps.notifier.enviar).not.toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    it('envia digest, salva Notificacao ENVIADA e emite NotificacaoEnviada', async () => {
      const deps = makeDeps();
      const dto = await makeUC(deps).executar(INPUT, noop);

      expect(dto).toEqual({ enviados: 1, agrupados: 0, total: 1 });
      expect(deps.notifier.enviar).toHaveBeenCalledOnce();
      expect(deps.notificacoes.salvar).toHaveBeenCalledOnce();
      const [notif] = (deps.notificacoes.salvar as ReturnType<typeof vi.fn>).mock.calls[0]! as [Notificacao];
      expect(notif.status).toBe('ENVIADA');
      expect(deps.eventos.publicar).toHaveBeenCalledOnce();
      const [evento] = (deps.eventos.publicar as ReturnType<typeof vi.fn>).mock.calls[0]! as [NotificacaoEnviada];
      expect(evento).toBeInstanceOf(NotificacaoEnviada);
      expect(evento.payload.tenantId).toBe(TENANT);
    });
  });

  describe('cap por frequência (P-81: 10 diário / 25 semanal)', () => {
    it('passa limite=10 ao repositório quando a preferência é DIARIA', async () => {
      const deps = makeDeps({ preferencia: makePref('DIARIA') });
      await makeUC(deps).executar(INPUT, noop);

      expect(deps.alertas.pendentesDigest).toHaveBeenCalledWith(
        { usuarioId: USUARIO, aPartirDe: INPUT.janela.inicio, limite: 10 },
        noop,
      );
    });

    it('passa limite=25 ao repositório quando a preferência é SEMANAL', async () => {
      const deps = makeDeps({ preferencia: makePref('SEMANAL') });
      await makeUC(deps).executar(INPUT, noop);

      expect(deps.alertas.pendentesDigest).toHaveBeenCalledWith(
        { usuarioId: USUARIO, aPartirDe: INPUT.janela.inicio, limite: 25 },
        noop,
      );
    });

    it('respeita caps customizados injetados no construtor', async () => {
      const deps = makeDeps({ preferencia: makePref('SEMANAL') });
      await makeUC(deps, { DIARIA: 5, SEMANAL: 12 }).executar(INPUT, noop);

      expect(deps.alertas.pendentesDigest).toHaveBeenCalledWith(
        { usuarioId: USUARIO, aPartirDe: INPUT.janela.inicio, limite: 12 },
        noop,
      );
    });

    it('reporta enviados = selecionados e agrupados = soma dos excedentes quando acima do cap', async () => {
      const selecionados = Array.from({ length: 10 }, (_, i) => makeAlerta(`a-${i}`, 0.5));
      const excedentes = [makeExcedente('Obras', 15)];
      const deps = makeDeps({
        pendentes: makePendentes({ selecionados, excedentes, totalPendentes: 25 }),
      });
      const dto = await makeUC(deps).executar(INPUT, noop);

      expect(dto).toEqual({ enviados: 10, agrupados: 15, total: 25 });
    });
  });

  describe('não reordena — usa a ordem devolvida pelo repositório (ordenação é responsabilidade do §3)', () => {
    it('mantém a ordem de `selecionados` no corpo do e-mail', async () => {
      const selecionados = [
        makeAlerta('primeiro', 0.2),
        makeAlerta('segundo', 0.9),
        makeAlerta('terceiro', 0.5),
      ];
      const deps = makeDeps({ pendentes: makePendentes({ selecionados }) });
      await makeUC(deps).executar(INPUT, noop);

      const corpo = (deps.notifier.enviar as ReturnType<typeof vi.fn>).mock.calls[0]![0].corpo as string;
      const posPrimeiro = corpo.indexOf('primeiro');
      const posSegundo = corpo.indexOf('segundo');
      const posTerceiro = corpo.indexOf('terceiro');
      expect(posPrimeiro).toBeLessThan(posSegundo);
      expect(posSegundo).toBeLessThan(posTerceiro);
    });
  });

  describe('excedente agrupado por critério/órgão (P-81) — nunca item a item', () => {
    it('inclui o excedente agregado no corpo, sem detalhar os itens individuais', async () => {
      const excedentes = [makeExcedente('Materiais de escritório', 7), makeExcedente('Obras', 3)];
      const deps = makeDeps({ pendentes: makePendentes({ excedentes, totalPendentes: 1 + 10 }) });
      await makeUC(deps).executar(INPUT, noop);

      const corpo = (deps.notifier.enviar as ReturnType<typeof vi.fn>).mock.calls[0]![0].corpo as string;
      expect(corpo).toContain('7 em "Materiais de escritório"');
      expect(corpo).toContain('3 em "Obras"');
      expect(corpo).toContain('10 alerta(s) além do limite');
    });

    it('não inclui rodapé de excedente quando não há excedente', async () => {
      const deps = makeDeps({ pendentes: makePendentes({ excedentes: [] }) });
      await makeUC(deps).executar(INPUT, noop);

      const corpo = (deps.notifier.enviar as ReturnType<typeof vi.fn>).mock.calls[0]![0].corpo as string;
      expect(corpo).not.toContain('além do limite');
    });
  });

  describe('falha do notifier', () => {
    it('salva Notificacao com status FALHOU e relança CanalIndisponivelError', async () => {
      const deps = makeDeps({ notifierFails: true });

      await expect(makeUC(deps).executar(INPUT, noop)).rejects.toThrow(CanalIndisponivelError);

      expect(deps.notificacoes.salvar).toHaveBeenCalledOnce();
      const [notif] = (deps.notificacoes.salvar as ReturnType<typeof vi.fn>).mock.calls[0]! as [Notificacao];
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
        { usuarioId: USUARIO, aPartirDe: INPUT.janela.inicio, limite: 10 },
        ac.signal,
      );
    });
  });
});
