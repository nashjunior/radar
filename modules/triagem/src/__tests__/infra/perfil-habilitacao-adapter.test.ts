import { describe, expect, it } from 'vitest';
import { ClienteFinalId, PerfilId } from '@radar/kernel';
import { PerfilHabilitacaoAdapter } from '../../infra/adapters/perfil-habilitacao-adapter.js';
import type { PerfilSource } from '../../infra/adapters/perfil-habilitacao-adapter.js';

const signal = new AbortController().signal;

function fonteComRaw(raw: Awaited<ReturnType<PerfilSource['buscar']>>) {
  const chamadas: { id: string; signal: AbortSignal }[] = [];
  const fonte: PerfilSource = {
    async buscar(id, s) {
      chamadas.push({ id, signal: s });
      return raw;
    },
  };
  return { fonte, chamadas };
}

const rawBase = {
  id: 'perfil-1',
  clienteFinalId: 'cliente-1',
  habJuridica: ['mei'],
  habFiscal: ['certidao-pgfn'],
  habTecnica: ['atestado-capacidade'],
  habEconomica: ['balanco-patrimonial'],
};

describe('PerfilHabilitacaoAdapter.porId', () => {
  it('retorna null quando a fonte não encontra o perfil', async () => {
    const { fonte } = fonteComRaw(null);
    const adapter = new PerfilHabilitacaoAdapter(fonte);

    const resultado = await adapter.porId(PerfilId('perfil-x'), signal);

    expect(resultado).toBeNull();
  });

  it('mapeia os campos de habilitação do raw para PerfilHabilitacao', async () => {
    const { fonte } = fonteComRaw(rawBase);
    const adapter = new PerfilHabilitacaoAdapter(fonte);

    const resultado = await adapter.porId(PerfilId('perfil-1'), signal);

    expect(resultado).not.toBeNull();
    expect(resultado!.habJuridica).toEqual(['mei']);
    expect(resultado!.habFiscal).toEqual(['certidao-pgfn']);
    expect(resultado!.habTecnica).toEqual(['atestado-capacidade']);
    expect(resultado!.habEconomica).toEqual(['balanco-patrimonial']);
  });

  it('aplica branded IDs para id e clienteFinalId', async () => {
    const { fonte } = fonteComRaw(rawBase);
    const adapter = new PerfilHabilitacaoAdapter(fonte);

    const resultado = await adapter.porId(PerfilId('perfil-1'), signal);

    expect(resultado!.id).toBe('perfil-1');
    expect(resultado!.clienteFinalId).toBe('cliente-1');
  });

  it('arrays vazios de habilitação são mapeados para arrays vazios', async () => {
    const raw = { ...rawBase, habJuridica: [], habFiscal: [], habTecnica: [], habEconomica: [] };
    const { fonte } = fonteComRaw(raw);
    const adapter = new PerfilHabilitacaoAdapter(fonte);

    const resultado = await adapter.porId(PerfilId('perfil-1'), signal);

    expect(resultado!.habJuridica).toEqual([]);
    expect(resultado!.habFiscal).toEqual([]);
  });

  it('propaga o id do perfil e o AbortSignal à fonte', async () => {
    const ac = new AbortController();
    const { fonte, chamadas } = fonteComRaw(null);
    const adapter = new PerfilHabilitacaoAdapter(fonte);

    await adapter.porId(PerfilId('perfil-abc'), ac.signal);

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.id).toBe('perfil-abc');
    expect(chamadas[0]!.signal).toBe(ac.signal);
  });
});
