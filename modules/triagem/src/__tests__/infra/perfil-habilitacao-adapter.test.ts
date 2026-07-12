import { describe, expect, it } from 'vitest';
import { PerfilId } from '@radar/kernel';
import { PerfilHabilitacaoAdapter } from '../../infra/adapters/perfil-habilitacao-adapter.js';
import type { PerfilSource } from '../../infra/adapters/perfil-habilitacao-adapter.js';
import { Requisito } from '../../domain/value-objects/requisito.js';

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

  it('aplica branded IDs para id e clienteFinalId', async () => {
    const { fonte } = fonteComRaw(rawBase);
    const adapter = new PerfilHabilitacaoAdapter(fonte);

    const resultado = await adapter.porId(PerfilId('perfil-1'), signal);

    expect(resultado!.id).toBe('perfil-1');
    expect(resultado!.clienteFinalId).toBe('cliente-1');
  });

  it('habJuridica é propagado — confrontar com requisito juridica não gera risco', async () => {
    const { fonte } = fonteComRaw(rawBase);
    const adapter = new PerfilHabilitacaoAdapter(fonte);
    const resultado = await adapter.porId(PerfilId('perfil-1'), signal);

    // rawBase.habJuridica = ['mei'] → deve atender requisito 'mei'
    const req = Requisito.criar('juridica', 'mei', null);
    const { riscos } = resultado!.confrontar([req]);

    expect(riscos).toHaveLength(0);
  });

  it('arrays vazios de habilitação → confrontar com qualquer requisito gera risco', async () => {
    const raw = { ...rawBase, habJuridica: [], habFiscal: [], habTecnica: [], habEconomica: [] };
    const { fonte } = fonteComRaw(raw);
    const adapter = new PerfilHabilitacaoAdapter(fonte);
    const resultado = await adapter.porId(PerfilId('perfil-1'), signal);

    const req = Requisito.criar('juridica', 'certidao', null);
    const { riscos } = resultado!.confrontar([req]);

    expect(riscos).toHaveLength(1);
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
