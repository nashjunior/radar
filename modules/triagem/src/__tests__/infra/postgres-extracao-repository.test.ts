import { describe, expect, it } from 'vitest';
import { EditalId } from '@radar/kernel';
import { PostgresExtracaoRepository } from '../../infra/adapters/postgres-extracao-repository.js';
import { ExtracaoEdital } from '../../domain/extracao-edital.js';
import { CampoExtraido } from '../../domain/value-objects/campo-extraido.js';
import { Citacao } from '../../domain/value-objects/citacao.js';
import { Confianca } from '../../domain/value-objects/confianca.js';
import { Requisito } from '../../domain/value-objects/requisito.js';
import { Risco } from '../../domain/value-objects/risco.js';

const signal = new AbortController().signal;

function criarDb(rows: object[]) {
  const chamadas: { sql: string; params: unknown[]; opts?: unknown }[] = [];
  return {
    chamadas,
    async query<R extends object>(_sql: string, _params: unknown[], opts?: unknown): Promise<{ rows: R[] }> {
      chamadas.push({ sql: _sql, params: _params, opts });
      return { rows: rows as R[] };
    },
  };
}

function campoObjeto(valor: string, conf = 0.9, critico = true) {
  return CampoExtraido.criar({ valor, confianca: Confianca.criar(conf), citacao: null, critico });
}

function campoValor(valor: number | null, conf = 0.8, critico = false) {
  return CampoExtraido.criar({ valor, confianca: Confianca.criar(conf), citacao: null, critico });
}

function campoData(valor: Date | null, conf = 0.85, critico = false) {
  return CampoExtraido.criar({ valor, confianca: Confianca.criar(conf), citacao: null, critico });
}

function extracao(props?: Partial<Parameters<typeof ExtracaoEdital.montar>[0]>) {
  return ExtracaoEdital.montar({
    editalId: EditalId('edital-1'),
    objeto: campoObjeto('Aquisição de materiais'),
    valorEstimado: campoValor(500000),
    dataAberturaPropostas: campoData(new Date('2026-08-01T00:00:00Z')),
    requisitos: [],
    riscosBrutos: [],
    paginas: 10,
    ...props,
  });
}

// JSON row shape as pg returns JSONB (already parsed)
function rowBase() {
  return {
    edital_id: 'edital-1',
    objeto: { valor: 'Aquisição de materiais', confianca: 0.9, citacao: null, critico: true },
    valor_estimado: { valor: 500000, confianca: 0.8, citacao: null, critico: false },
    data_abertura_propostas: { valor: '2026-08-01T00:00:00.000Z', confianca: 0.85, citacao: null, critico: false },
    requisitos: [],
    riscos_brutos: [],
    paginas: 10,
  };
}

describe('PostgresExtracaoRepository.porEdital', () => {
  it('retorna null quando o edital não existe', async () => {
    const db = criarDb([]);
    const repo = new PostgresExtracaoRepository(db);

    const resultado = await repo.porEdital(EditalId('edital-x'), signal);

    expect(resultado).toBeNull();
  });

  it('consulta pela chave edital_id', async () => {
    const db = criarDb([rowBase()]);
    const repo = new PostgresExtracaoRepository(db);

    await repo.porEdital(EditalId('edital-abc'), signal);

    const { sql, params } = db.chamadas[0]!;
    expect(sql).toMatch(/FROM extracao_edital/);
    expect(sql).toMatch(/WHERE edital_id = \$1/);
    expect(params[0]).toBe('edital-abc');
  });

  it('reconstrói objeto, valorEstimado e dataAberturaPropostas do JSON da row', async () => {
    const db = criarDb([rowBase()]);
    const repo = new PostgresExtracaoRepository(db);

    const resultado = await repo.porEdital(EditalId('edital-1'), signal);

    expect(resultado).not.toBeNull();
    expect(resultado!.objeto.valor).toBe('Aquisição de materiais');
    expect(resultado!.objeto.confianca.valor).toBe(0.9);
    expect(resultado!.valorEstimado.valor).toBe(500000);
    expect(resultado!.dataAberturaPropostas.valor).toEqual(new Date('2026-08-01T00:00:00Z'));
    expect(resultado!.paginas).toBe(10);
  });

  it('valorEstimado null → valor null no domínio', async () => {
    const row = { ...rowBase(), valor_estimado: { valor: null, confianca: 0.8, citacao: null, critico: false } };
    const db = criarDb([row]);
    const repo = new PostgresExtracaoRepository(db);

    const resultado = await repo.porEdital(EditalId('edital-1'), signal);

    expect(resultado!.valorEstimado.valor).toBeNull();
  });

  it('dataAberturaPropostas null → valor null no domínio', async () => {
    const row = {
      ...rowBase(),
      data_abertura_propostas: { valor: null, confianca: 0.85, citacao: null, critico: false },
    };
    const db = criarDb([row]);
    const repo = new PostgresExtracaoRepository(db);

    const resultado = await repo.porEdital(EditalId('edital-1'), signal);

    expect(resultado!.dataAberturaPropostas.valor).toBeNull();
  });

  it('reconstrói requisitos com citacao preenchida', async () => {
    const row = {
      ...rowBase(),
      requisitos: [
        { categoria: 'juridica', descricao: 'Certidão negativa', citacao: { pagina: 3, secao: '2.1', trecho: 'conforme lei' } },
      ],
    };
    const db = criarDb([row]);
    const repo = new PostgresExtracaoRepository(db);

    const resultado = await repo.porEdital(EditalId('edital-1'), signal);

    expect(resultado!.requisitos).toHaveLength(1);
    expect(resultado!.requisitos[0]!.categoria).toBe('juridica');
    expect(resultado!.requisitos[0]!.descricao).toBe('Certidão negativa');
    expect(resultado!.requisitos[0]!.citacao?.pagina).toBe(3);
    expect(resultado!.requisitos[0]!.citacao?.secao).toBe('2.1');
  });

  it('reconstrói riscos_brutos com citacao null', async () => {
    const row = {
      ...rowBase(),
      riscos_brutos: [{ descricao: 'Prazo apertado', severidade: 'alta', citacao: null }],
    };
    const db = criarDb([row]);
    const repo = new PostgresExtracaoRepository(db);

    const resultado = await repo.porEdital(EditalId('edital-1'), signal);

    expect(resultado!.riscosBrutos).toHaveLength(1);
    expect(resultado!.riscosBrutos[0]!.severidade).toBe('alta');
    expect(resultado!.riscosBrutos[0]!.citacao).toBeNull();
  });

  it('propaga AbortSignal ao db.query', async () => {
    const ac = new AbortController();
    const capturedOpts: unknown[] = [];
    const db = {
      async query<R extends object>(_sql: string, _params: unknown[], opts?: unknown): Promise<{ rows: R[] }> {
        capturedOpts.push(opts);
        return { rows: [] as R[] };
      },
    };
    const repo = new PostgresExtracaoRepository(db);

    await repo.porEdital(EditalId('edital-1'), ac.signal);

    expect(capturedOpts[0]).toEqual({ signal: ac.signal });
  });
});

describe('PostgresExtracaoRepository.salvar', () => {
  it('executa UPSERT ON CONFLICT (edital_id) DO UPDATE', async () => {
    const db = criarDb([]);
    const repo = new PostgresExtracaoRepository(db);

    await repo.salvar(extracao(), signal);

    const { sql } = db.chamadas[0]!;
    expect(sql).toMatch(/INSERT INTO extracao_edital/);
    expect(sql).toMatch(/ON CONFLICT \(edital_id\) DO UPDATE/);
  });

  it('passa editalId como $1', async () => {
    const db = criarDb([]);
    const repo = new PostgresExtracaoRepository(db);

    await repo.salvar(extracao({ editalId: EditalId('edital-99') }), signal);

    expect(db.chamadas[0]!.params[0]).toBe('edital-99');
  });

  it('serializa objeto como JSON com confiança e critico', async () => {
    const db = criarDb([]);
    const repo = new PostgresExtracaoRepository(db);

    await repo.salvar(extracao(), signal);

    const objetoJson = JSON.parse(db.chamadas[0]!.params[1] as string);
    expect(objetoJson.valor).toBe('Aquisição de materiais');
    expect(objetoJson.confianca).toBe(0.9);
    expect(objetoJson.critico).toBe(true);
    expect(objetoJson.citacao).toBeNull();
  });

  it('serializa valorEstimado null corretamente', async () => {
    const db = criarDb([]);
    const repo = new PostgresExtracaoRepository(db);

    await repo.salvar(extracao({ valorEstimado: campoValor(null) }), signal);

    const valorJson = JSON.parse(db.chamadas[0]!.params[2] as string);
    expect(valorJson.valor).toBeNull();
  });

  it('serializa dataAberturaPropostas como ISO string quando não é null', async () => {
    const db = criarDb([]);
    const repo = new PostgresExtracaoRepository(db);
    const data = new Date('2026-09-01T00:00:00Z');

    await repo.salvar(extracao({ dataAberturaPropostas: campoData(data) }), signal);

    const dataJson = JSON.parse(db.chamadas[0]!.params[3] as string);
    expect(dataJson.valor).toBe(data.toISOString());
  });

  it('serializa citacao no requisito (pagina, secao, trecho)', async () => {
    const db = criarDb([]);
    const repo = new PostgresExtracaoRepository(db);
    const citacao = Citacao.criar(5, 'certidão exigida', '3.2');
    const req = Requisito.criar('fiscal', 'Certidão fiscal', citacao);

    await repo.salvar(extracao({ requisitos: [req] }), signal);

    const requisitosJson = JSON.parse(db.chamadas[0]!.params[4] as string);
    expect(requisitosJson[0].citacao.pagina).toBe(5);
    expect(requisitosJson[0].citacao.secao).toBe('3.2');
    expect(requisitosJson[0].citacao.trecho).toBe('certidão exigida');
  });

  it('passa confiancaGlobal denormalizada como $7', async () => {
    const db = criarDb([]);
    const repo = new PostgresExtracaoRepository(db);
    const e = extracao();

    await repo.salvar(e, signal);

    expect(db.chamadas[0]!.params[6]).toBe(e.confiancaGlobal().valor);
  });

  it('propaga AbortSignal ao db.query', async () => {
    const ac = new AbortController();
    const capturedOpts: unknown[] = [];
    const db = {
      async query<R extends object>(_sql: string, _params: unknown[], opts?: unknown): Promise<{ rows: R[] }> {
        capturedOpts.push(opts);
        return { rows: [] as R[] };
      },
    };
    const repo = new PostgresExtracaoRepository(db);

    await repo.salvar(extracao(), ac.signal);

    expect(capturedOpts[0]).toEqual({ signal: ac.signal });
  });
});
