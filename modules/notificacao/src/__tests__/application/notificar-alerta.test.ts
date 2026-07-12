import { describe, expect, it, vi } from 'vitest';
import { AlertaId, ClienteFinalId, CriterioId, TenantId } from '@radar/kernel';
import { NotificarAlertaUseCase } from '../../application/use-cases/notificar-alerta.js';
import { CanalIndisponivelError } from '../../domain/errors/index.js';
import type {
  AlertaRepository,
  ClienteFinalGateway,
  EventPublisher,
  IdProvider,
  NotificacaoRepository,
  Notifier,
  PreferenciaRepository,
} from '../../application/ports.js';
import type { AlertaResumoDTO } from '../../application/dtos.js';
import { UsuarioId } from '../../domain/entities/notificacao.js';

const noop = new AbortController().signal;

const alertaUrgente: AlertaResumoDTO = {
  id: AlertaId('alerta-001'),
  objeto: 'Serviços de TI',
  orgao: 'Prefeitura SP',
  uf: 'SP',
  prazoProposta: new Date('2026-07-08'),
  aderencia: 0.8,
  diasAtePrazo: 3,
  criterioId: CriterioId('criterio-001'),
  criterioNome: 'Serviços de TI',
};

/** Nem prazo (10 > 3) nem aderência (0.5 < 0.8) cruzam o limiar — não crítico sob a condição OU. */
const alertaNaoUrgente: AlertaResumoDTO = {
  ...alertaUrgente,
  diasAtePrazo: 10,
  aderencia: 0.5,
};

/** Prazo longe mas aderência alta — crítico só por causa da condição OU (P-81). */
const alertaAltaAderenciaSemUrgencia: AlertaResumoDTO = {
  ...alertaUrgente,
  diasAtePrazo: 30,
  aderencia: 0.8,
};

function criarDeps(overrides?: {
  jaNotificado?: boolean;
  alerta?: AlertaResumoDTO | null;
  enviarOk?: boolean;
  clienteFinalEncontrado?: boolean;
}) {
  const {
    jaNotificado = false,
    alerta = alertaUrgente,
    enviarOk = true,
    clienteFinalEncontrado = true,
  } = overrides ?? {};

  const alertas: AlertaRepository = {
    porId: vi.fn().mockResolvedValue(alerta),
    pendentesDigest: vi.fn(),
  };
  const preferencias: PreferenciaRepository = {
    porUsuario: vi.fn().mockResolvedValue(null),
    salvar: vi.fn(),
  };
  const notificacoes: NotificacaoRepository = {
    salvar: vi.fn().mockResolvedValue(undefined),
    jaNotificado: vi.fn().mockResolvedValue(jaNotificado),
  };
  const notifier: Notifier = {
    enviar: enviarOk
      ? vi.fn().mockResolvedValue(undefined)
      : vi.fn().mockRejectedValue(new Error('falha de rede')),
  };
  const eventos: EventPublisher = { publicar: vi.fn().mockResolvedValue(undefined) };
  const ids: IdProvider = { gerar: vi.fn().mockReturnValue('notif-001') };
  const clienteFinalGateway: ClienteFinalGateway = {
    porId: clienteFinalEncontrado
      ? vi.fn().mockResolvedValue({ usuarioId: UsuarioId('usuario-001'), email: 'usuario@empresa.com' })
      : vi.fn().mockResolvedValue(null),
  };

  return { alertas, preferencias, notificacoes, notifier, eventos, ids, clienteFinalGateway };
}

const inputBase = {
  alertaId: AlertaId('alerta-001'),
  clienteFinalId: ClienteFinalId('cliente-001'),
  tenantId: TenantId('tenant-a'),
  alertaGeradoEm: new Date('2026-07-10T12:00:00.000Z'),
};

function criarUC(deps: ReturnType<typeof criarDeps>): NotificarAlertaUseCase {
  return new NotificarAlertaUseCase(
    deps.alertas,
    deps.preferencias,
    deps.notificacoes,
    deps.notifier,
    deps.eventos,
    deps.ids,
    deps.clienteFinalGateway,
  );
}

describe('NotificarAlertaUseCase', () => {
  describe('resolução de clienteFinal', () => {
    it('retorna silenciosamente quando clienteFinal não é encontrado', async () => {
      const deps = criarDeps({ clienteFinalEncontrado: false });
      await criarUC(deps).executar(inputBase, noop);

      expect(deps.notifier.enviar).not.toHaveBeenCalled();
      expect(deps.notificacoes.jaNotificado).not.toHaveBeenCalled();
    });

    it('usa o email resolvido pelo gateway para enviar', async () => {
      const deps = criarDeps();
      await criarUC(deps).executar(inputBase, noop);

      expect(deps.notifier.enviar).toHaveBeenCalledWith(
        expect.objectContaining({ destinatario: 'usuario@empresa.com' }),
      );
    });
  });

  describe('idempotência', () => {
    it('não envia quando já notificado anteriormente (jaNotificado = true)', async () => {
      const deps = criarDeps({ jaNotificado: true });
      await criarUC(deps).executar(inputBase, noop);

      expect(deps.notifier.enviar).not.toHaveBeenCalled();
      expect(deps.eventos.publicar).not.toHaveBeenCalled();
    });
  });

  describe('roteamento por urgência', () => {
    it('entrega imediatamente quando alerta é urgente (diasAtePrazo ≤ 3)', async () => {
      const deps = criarDeps({ alerta: alertaUrgente });
      await criarUC(deps).executar(inputBase, noop);

      expect(deps.notifier.enviar).toHaveBeenCalledOnce();
      expect(deps.eventos.publicar).toHaveBeenCalledOnce();

      const [evento] = (deps.eventos.publicar as ReturnType<typeof vi.fn>).mock.calls[0] as [
        { payload: { alertaGeradoEm: Date } },
      ];
      expect(evento.payload.alertaGeradoEm).toBe(inputBase.alertaGeradoEm);
    });

    it('não entrega imediatamente quando alerta não é urgente e preferência não é IMEDIATA', async () => {
      const deps = criarDeps({ alerta: alertaNaoUrgente });
      await criarUC(deps).executar(inputBase, noop);

      expect(deps.notifier.enviar).not.toHaveBeenCalled();
    });

    it('entrega imediatamente quando preferência é IMEDIATA mesmo sem urgência', async () => {
      const deps = criarDeps({ alerta: alertaNaoUrgente });
      (deps.preferencias.porUsuario as ReturnType<typeof vi.fn>).mockResolvedValue({
        usuarioId: UsuarioId('usuario-001'),
        canais: ['EMAIL'],
        frequencia: 'IMEDIATA',
      });
      await criarUC(deps).executar(inputBase, noop);

      expect(deps.notifier.enviar).toHaveBeenCalledOnce();
    });
  });

  describe('criticidade OU (P-81): prazo curto OU aderência alta', () => {
    it('entrega imediatamente quando aderência é alta mesmo com prazo longe (condição OU)', async () => {
      const deps = criarDeps({ alerta: alertaAltaAderenciaSemUrgencia });
      await criarUC(deps).executar(inputBase, noop);

      expect(deps.notifier.enviar).toHaveBeenCalledOnce();
    });

    it('respeita limiares customizados injetados no construtor', async () => {
      const deps = criarDeps({ alerta: alertaNaoUrgente }); // 10 dias, aderência 0.5
      const uc = new NotificarAlertaUseCase(
        deps.alertas,
        deps.preferencias,
        deps.notificacoes,
        deps.notifier,
        deps.eventos,
        deps.ids,
        deps.clienteFinalGateway,
        { diasAtePrazo: 15, aderencia: 0.9 }, // limiar de prazo mais frouxo que o padrão
      );
      await uc.executar(inputBase, noop);

      expect(deps.notifier.enviar).toHaveBeenCalledOnce();
    });
  });

  describe('falha de envio', () => {
    it('persiste notificacao com status FALHOU e relança como CanalIndisponivelError', async () => {
      const deps = criarDeps({ enviarOk: false });
      await expect(criarUC(deps).executar(inputBase, noop)).rejects.toThrow(CanalIndisponivelError);
      expect(deps.notificacoes.salvar).toHaveBeenCalledOnce();
    });

    it('não publica evento quando envio falha', async () => {
      const deps = criarDeps({ enviarOk: false });
      await criarUC(deps).executar(inputBase, noop).catch(() => {});
      expect(deps.eventos.publicar).not.toHaveBeenCalled();
    });
  });

  describe('alerta não encontrado', () => {
    it('retorna silenciosamente quando porId retorna null', async () => {
      const deps = criarDeps({ alerta: null });
      await expect(criarUC(deps).executar(inputBase, noop)).resolves.toBeUndefined();
      expect(deps.notifier.enviar).not.toHaveBeenCalled();
    });
  });
});
