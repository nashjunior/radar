import { describe, expect, it } from 'vitest';
import { comCorrelacao } from '../contexto-correlacao.js';
import { criarLogger } from '../logger.js';
import { traceIdValido } from '../trace-context.js';

function capturar() {
  const linhas: Array<{ linha: string; nivel: string }> = [];
  const logger = criarLogger('worker:teste', (linha, nivel) => linhas.push({ linha, nivel }));
  return { logger, linhas };
}

describe('logger JSON Lines (A18 §4)', () => {
  it('emite um JSON com os campos do contrato', () => {
    const { logger, linhas } = capturar();

    comCorrelacao('abc123', () => logger.info('edital.ingerido', 'processado', { tenantId: 'tenant-1', duracaoMs: 42 }));

    expect(linhas).toHaveLength(1);
    const registro = JSON.parse(linhas[0]!.linha);
    expect(registro).toMatchObject({
      nivel: 'info',
      correlationId: 'abc123',
      contexto: 'worker:teste',
      evento: 'edital.ingerido',
      msg: 'processado',
      tenantId: 'tenant-1',
      duracaoMs: 42,
    });
    expect(typeof registro.ts).toBe('string');
  });

  it('gera um correlationId válido quando chamado fora de qualquer escopo (ex.: log de boot)', () => {
    const { logger, linhas } = capturar();

    logger.info('worker.iniciado', 'sem requisição em andamento');

    const registro = JSON.parse(linhas[0]!.linha);
    expect(traceIdValido(registro.correlationId)).toBe(true);
  });

  it('roteia warn/error para o sink com nivel correspondente', () => {
    const { logger, linhas } = capturar();

    logger.warn('algo', 'mensagem de warn');
    logger.error('algo', 'mensagem de error');

    expect(linhas.map((l) => l.nivel)).toEqual(['warn', 'error']);
  });

  it('não regride a redação — CPF/CNPJ/e-mail/Bearer em campo aninhado saem [REDACTED]', () => {
    const { logger, linhas } = capturar();

    comCorrelacao('abc123', () =>
      logger.error('triagem.falhou', 'erro ao processar', {
        detalhe: { cpfCliente: '123.456.789-00', cnpj: '12.345.678/0001-90', email: 'pessoa@example.com' },
        authorization: 'Bearer abc.def.ghi',
      }),
    );

    const linha = linhas[0]!.linha;
    expect(linha).not.toContain('123.456.789-00');
    expect(linha).not.toContain('12.345.678/0001-90');
    expect(linha).not.toContain('pessoa@example.com');
    expect(linha).not.toContain('abc.def.ghi');
    expect(linha).toContain('[REDACTED]');
  });

  it('só inclui no registro os campos fixos do contrato mais os que o call site passou', () => {
    const { logger, linhas } = capturar();

    logger.debug('triagem.concluida', 'apenas ids', { editalId: 'edital-1', tenantId: 'tenant-1' });

    const registro = JSON.parse(linhas[0]!.linha);
    expect(Object.keys(registro).sort()).toEqual(
      ['contexto', 'correlationId', 'editalId', 'evento', 'msg', 'nivel', 'tenantId', 'ts'].sort(),
    );
  });
});
