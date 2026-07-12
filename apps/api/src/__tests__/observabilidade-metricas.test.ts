import { describe, expect, it, vi } from 'vitest';
import { AlertaId, ClienteFinalId, CriterioId, EditalId, PerfilId, TenantId } from '@radar/kernel';
import { AlertaGerado, AlertaPrazoCriticoReconciliado } from '@radar/matching';
import { NotificacaoEnviada, NotificacaoId, UsuarioId } from '@radar/notificacao';
import { TriagemConcluida } from '@radar/triagem';
import { PipelineBreakerEstadoMudou, PipelineCicloConcluido } from '@radar/ingestao';
import {
  criarEventPublisherComMetricas,
  metricaDeAlertaGerado,
  metricaDeCicloFalhou,
  metricaDeNotificacaoEnviada,
  metricaDeAlertaPrazoCriticoReconciliado,
  metricaDePipelineBreakerEstadoMudou,
  metricaDePipelineCicloConcluido,
  metricaDeTriagemConcluida,
} from '../observabilidade-metricas.js';

const noop = new AbortController().signal;

function capturarConsoleLog() {
  const linhas: string[] = [];
  const original = console.log;
  console.log = (linha: string) => linhas.push(linha);
  return {
    linhas,
    restaurar: () => {
      console.log = original;
    },
  };
}

describe('metricaDeAlertaGerado (SLO frescor)', () => {
  it('emite alerta.frescor_ms = occurredAt - editalPublicadoEm', () => {
    const { linhas, restaurar } = capturarConsoleLog();
    try {
      const evento = new AlertaGerado({
        alertaId: AlertaId('alerta-1'),
        tenantId: TenantId('tenant-1'),
        clienteFinalId: ClienteFinalId('cliente-1'),
        criterioId: CriterioId('criterio-1'),
        editalId: EditalId('edital-1'),
        aderencia: 0.8,
        editalPublicadoEm: new Date(agora() - 5000),
        imediato: true,
      });

      metricaDeAlertaGerado(evento, 'prod');

      const registro = JSON.parse(linhas[0]!);
      expect(registro['alerta.frescor_ms']).toBeGreaterThanOrEqual(5000);
      expect(registro['alerta.frescor_ms']).toBeLessThan(5100);
      expect(registro.tenantId).toBe('tenant-1');
      expect(registro._aws.CloudWatchMetrics[0].Namespace).toBe('Radar/SLO');
    } finally {
      restaurar();
    }
  });
});

describe('metricaDeNotificacaoEnviada (SLO entrega imediata)', () => {
  it('emite notificacao.latencia_entrega_ms com dim imediato=true quando alertaGeradoEm presente', () => {
    const { linhas, restaurar } = capturarConsoleLog();
    try {
      const evento = new NotificacaoEnviada({
        notificacaoId: NotificacaoId('notif-1'),
        tenantId: TenantId('tenant-1'),
        usuarioId: UsuarioId('usuario-1'),
        alertaId: AlertaId('alerta-1'),
        canal: 'EMAIL',
        alertaGeradoEm: new Date(agora() - 1000),
      });

      metricaDeNotificacaoEnviada(evento, 'prod');

      expect(linhas).toHaveLength(1);
      const registro = JSON.parse(linhas[0]!);
      expect(registro.imediato).toBe('true');
      expect(registro['notificacao.latencia_entrega_ms']).toBeGreaterThanOrEqual(1000);
    } finally {
      restaurar();
    }
  });

  it('NÃO emite métrica quando alertaGeradoEm está ausente (caminho digest)', () => {
    const { linhas, restaurar } = capturarConsoleLog();
    try {
      const evento = new NotificacaoEnviada({
        notificacaoId: NotificacaoId('notif-2'),
        tenantId: TenantId('tenant-1'),
        usuarioId: UsuarioId('usuario-1'),
        alertaId: AlertaId('alerta-2'),
        canal: 'EMAIL',
      });

      metricaDeNotificacaoEnviada(evento, 'prod');

      expect(linhas).toHaveLength(0);
    } finally {
      restaurar();
    }
  });
});

describe('metricaDeTriagemConcluida (SLO triagem)', () => {
  it('emite triagem.latencia_ms quando solicitadaEm presente', () => {
    const { linhas, restaurar } = capturarConsoleLog();
    try {
      const evento = new TriagemConcluida({
        tenantId: TenantId('tenant-1'),
        clienteFinalId: ClienteFinalId('cliente-1'),
        editalId: EditalId('edital-1'),
        perfilId: PerfilId('perfil-1'),
        confianca: 0.9,
        aderencia: 0.7,
        recomendacao: 'go',
        riscos: [],
        solicitadaEm: new Date(agora() - 2000),
      });

      metricaDeTriagemConcluida(evento, 'prod');

      expect(linhas).toHaveLength(1);
      const registro = JSON.parse(linhas[0]!);
      expect(registro['triagem.latencia_ms']).toBeGreaterThanOrEqual(2000);
    } finally {
      restaurar();
    }
  });

  it('NÃO emite métrica quando solicitadaEm está ausente', () => {
    const { linhas, restaurar } = capturarConsoleLog();
    try {
      const evento = new TriagemConcluida({
        tenantId: TenantId('tenant-1'),
        clienteFinalId: ClienteFinalId('cliente-1'),
        editalId: EditalId('edital-1'),
        perfilId: PerfilId('perfil-1'),
        confianca: 0.9,
        aderencia: 0.7,
        recomendacao: 'go',
        riscos: [],
      });

      metricaDeTriagemConcluida(evento, 'prod');

      expect(linhas).toHaveLength(0);
    } finally {
      restaurar();
    }
  });
});

describe('metricaDePipelineCicloConcluido (SLO disponibilidade — 1/2)', () => {
  it('emite pipeline.ciclo.ok quando erros=0 e breaker fechado', () => {
    const { linhas, restaurar } = capturarConsoleLog();
    try {
      const evento = new PipelineCicloConcluido({
        regime: 'publicacao',
        modalidades: [6],
        janela: { inicio: '2026-07-10T00:00:00.000Z', fim: '2026-07-10T00:05:00.000Z' },
        ingeridos: 10,
        atualizados: 0,
        erros: 0,
        duracaoMs: 1200,
        breakerAberto: false,
      });

      metricaDePipelineCicloConcluido(evento, 'prod');

      const registro = JSON.parse(linhas[0]!);
      expect(registro['pipeline.ciclo.ok']).toBe(1);
      expect(registro['pipeline.ciclo.erro']).toBeUndefined();
    } finally {
      restaurar();
    }
  });

  it('emite pipeline.ciclo.erro quando há erros mesmo com breaker fechado', () => {
    const { linhas, restaurar } = capturarConsoleLog();
    try {
      const evento = new PipelineCicloConcluido({
        regime: 'publicacao',
        modalidades: [6],
        janela: { inicio: '2026-07-10T00:00:00.000Z', fim: '2026-07-10T00:05:00.000Z' },
        ingeridos: 5,
        atualizados: 0,
        erros: 3,
        duracaoMs: 1200,
        breakerAberto: false,
      });

      metricaDePipelineCicloConcluido(evento, 'prod');

      const registro = JSON.parse(linhas[0]!);
      expect(registro['pipeline.ciclo.erro']).toBe(1);
    } finally {
      restaurar();
    }
  });

  it('emite pipeline.ciclo.erro quando o breaker está aberto mesmo sem erros no ciclo', () => {
    const { linhas, restaurar } = capturarConsoleLog();
    try {
      const evento = new PipelineCicloConcluido({
        regime: 'publicacao',
        modalidades: [6],
        janela: { inicio: '2026-07-10T00:00:00.000Z', fim: '2026-07-10T00:05:00.000Z' },
        ingeridos: 0,
        atualizados: 0,
        erros: 0,
        duracaoMs: 50,
        breakerAberto: true,
      });

      metricaDePipelineCicloConcluido(evento, 'prod');

      const registro = JSON.parse(linhas[0]!);
      expect(registro['pipeline.ciclo.erro']).toBe(1);
    } finally {
      restaurar();
    }
  });
});

describe('metricaDePipelineBreakerEstadoMudou (SLO disponibilidade — 2/2)', () => {
  it('emite pipeline.breaker.aberto=1 quando estadoAtual é ABERTO', () => {
    const { linhas, restaurar } = capturarConsoleLog();
    try {
      const evento = new PipelineBreakerEstadoMudou({
        breaker: 'pncp',
        estadoAnterior: 'FECHADO',
        estadoAtual: 'ABERTO',
        contadorFalhas: 5,
      });

      metricaDePipelineBreakerEstadoMudou(evento, 'prod');

      const registro = JSON.parse(linhas[0]!);
      expect(registro['pipeline.breaker.aberto']).toBe(1);
    } finally {
      restaurar();
    }
  });

  it('emite pipeline.breaker.aberto=0 quando o estado volta a FECHADO', () => {
    const { linhas, restaurar } = capturarConsoleLog();
    try {
      const evento = new PipelineBreakerEstadoMudou({
        breaker: 'pncp',
        estadoAnterior: 'MEIO_ABERTO',
        estadoAtual: 'FECHADO',
        contadorFalhas: 0,
      });

      metricaDePipelineBreakerEstadoMudou(evento, 'prod');

      const registro = JSON.parse(linhas[0]!);
      expect(registro['pipeline.breaker.aberto']).toBe(0);
    } finally {
      restaurar();
    }
  });
});

describe('metricaDeAlertaPrazoCriticoReconciliado (SLO error budget zero)', () => {
  it('emite elegivel/coberto/perdido do payload já calculado pelo reconciliador', () => {
    const { linhas, restaurar } = capturarConsoleLog();
    try {
      const evento = new AlertaPrazoCriticoReconciliado({ elegivel: 10, coberto: 7, perdido: 3 });

      metricaDeAlertaPrazoCriticoReconciliado(evento, 'prod');

      expect(linhas).toHaveLength(1);
      const registro = JSON.parse(linhas[0]!);
      expect(registro['alerta.prazo_critico.elegivel']).toBe(10);
      expect(registro['alerta.prazo_critico.coberto']).toBe(7);
      expect(registro['alerta.prazo_critico.perdido']).toBe(3);
      expect(registro.tenantId).toBeUndefined();
    } finally {
      restaurar();
    }
  });
});

describe('metricaDeCicloFalhou (RAD-332 — aoFalhar de scheduler periódico)', () => {
  it('emite <contexto>.ciclo.falhou = 1 (mesma hierarquia de pipeline.ciclo.ok/erro)', () => {
    const { linhas, restaurar } = capturarConsoleLog();
    try {
      metricaDeCicloFalhou('alerta.prazo_critico', 'prod');

      expect(linhas).toHaveLength(1);
      const registro = JSON.parse(linhas[0]!);
      expect(registro['alerta.prazo_critico.ciclo.falhou']).toBe(1);
      expect(registro._aws.CloudWatchMetrics[0].Namespace).toBe('Radar/SLO');
      expect(registro.erro).toBeUndefined();
    } finally {
      restaurar();
    }
  });

  it('prefixo do nome varia por contexto (um scheduler não pisa no nome do outro)', () => {
    const { linhas, restaurar } = capturarConsoleLog();
    try {
      metricaDeCicloFalhou('pipeline', 'prod');

      const registro = JSON.parse(linhas[0]!);
      expect(registro['pipeline.ciclo.falhou']).toBe(1);
      expect(registro['alerta.prazo_critico.ciclo.falhou']).toBeUndefined();
    } finally {
      restaurar();
    }
  });

  it('quando erro é passado, vira campo de log redigido ({ tipo, code? }) — nunca message/stack', () => {
    const { linhas, restaurar } = capturarConsoleLog();
    try {
      metricaDeCicloFalhou('pipeline', 'prod', new RangeError('detalhe sensível do banco'));

      const registro = JSON.parse(linhas[0]!);
      expect(registro.erro).toEqual({ tipo: 'RangeError' });
      expect(JSON.stringify(registro)).not.toContain('detalhe sensível');
    } finally {
      restaurar();
    }
  });
});

describe('criarEventPublisherComMetricas — decorator', () => {
  it('emite a métrica E delega ao publisher interno, nessa ordem', async () => {
    const { linhas, restaurar } = capturarConsoleLog();
    try {
      const ordem: string[] = [];
      const original = console.log;
      console.log = (linha: string) => {
        ordem.push('metrica');
        linhas.push(linha);
      };
      const internoPublicar = vi.fn().mockImplementation(async () => {
        ordem.push('publicar');
      });
      const interno = { publicar: internoPublicar };
      const decorado = criarEventPublisherComMetricas(interno, 'prod');

      const evento = new AlertaGerado({
        alertaId: AlertaId('alerta-1'),
        tenantId: TenantId('tenant-1'),
        clienteFinalId: ClienteFinalId('cliente-1'),
        criterioId: CriterioId('criterio-1'),
        editalId: EditalId('edital-1'),
        aderencia: 0.8,
        editalPublicadoEm: new Date(),
        imediato: true,
      });

      await decorado.publicar(evento, noop);

      expect(internoPublicar).toHaveBeenCalledExactlyOnceWith(evento, noop);
      expect(ordem).toEqual(['metrica', 'publicar']);
      console.log = original;
    } finally {
      restaurar();
    }
  });

  it('eventos sem tradução de métrica (ex.: feedback.alerta) passam direto ao publisher, sem emitir nada', async () => {
    const { linhas, restaurar } = capturarConsoleLog();
    try {
      const internoPublicar = vi.fn().mockResolvedValue(undefined);
      const decorado = criarEventPublisherComMetricas({ publicar: internoPublicar }, 'prod');

      const eventoSemMetrica = { type: 'feedback.alerta', payload: { alertaId: 'a', relevante: true } };
      await decorado.publicar(eventoSemMetrica as never, noop);

      expect(linhas).toHaveLength(0);
      expect(internoPublicar).toHaveBeenCalledOnce();
    } finally {
      restaurar();
    }
  });

  it('propaga o AbortSignal ao publisher interno', async () => {
    const internoPublicar = vi.fn().mockResolvedValue(undefined);
    const decorado = criarEventPublisherComMetricas({ publicar: internoPublicar }, 'prod');
    const ac = new AbortController();

    await decorado.publicar({ type: 'feedback.alerta' } as never, ac.signal);

    expect(internoPublicar).toHaveBeenCalledWith(expect.anything(), ac.signal);
  });
});

function agora(): number {
  return new Date().getTime();
}
