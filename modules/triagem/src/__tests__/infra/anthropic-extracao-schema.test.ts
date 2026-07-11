import { describe, expect, it } from 'vitest';
import { EditalId } from '@radar/kernel';
import {
  CATEGORIAS,
  FERRAMENTA_EXTRACAO,
  INSTRUCAO_EXTRACAO,
  SEVERIDADES,
  interpretarSaidaExtracao,
  montarRequisicaoExtracao,
} from '../../infra/adapters/anthropic-llm-gateway.js';
import {
  FERRAMENTA_SCHEMA,
  MAX_TOKENS_EXTRACAO,
  extrairToolInput,
  paramsExtracao,
} from '../../infra/adapters/anthropic-extracao-schema.js';
import { SaidaLlmInvalidaError } from '../../domain/errors/index.js';
import type { EntradaExtracaoDTO } from '../../application/dtos.js';

const ENTRADA: EntradaExtracaoDTO = {
  editalId: EditalId('edital-1'),
  texto: 'Objeto: aquisição de notebooks.',
  temTextoSelecionavel: true,
  anexos: [],
  paginas: 3,
};

describe('anthropic-extracao-schema — peças compartilhadas síncrono ↔ lote', () => {
  it('paramsExtracao força tool use com o MESMO model/system/schema da inferência', () => {
    const params = paramsExtracao(montarRequisicaoExtracao(ENTRADA));
    expect(typeof params.model).toBe('string');
    expect(params.max_tokens).toBe(MAX_TOKENS_EXTRACAO);
    expect(params.system).toBe(INSTRUCAO_EXTRACAO);
    expect(params.tools[0]).toBe(FERRAMENTA_SCHEMA);
    expect(params.tool_choice).toEqual({ type: 'tool', name: FERRAMENTA_EXTRACAO });
    expect(params.messages[0]!.content).toContain('<edital_nao_confiavel>');
  });

  it('o schema da ferramenta não diverge do vocabulário do validador (fonte única)', () => {
    const schema = FERRAMENTA_SCHEMA.input_schema as Record<string, any>;
    expect(FERRAMENTA_SCHEMA.name).toBe(FERRAMENTA_EXTRACAO);
    expect(schema['properties'].requisitos.items.properties.categoria.enum).toEqual([...CATEGORIAS]);
    expect(schema['properties'].riscos.items.properties.severidade.enum).toEqual([...SEVERIDADES]);
  });

  it('extrairToolInput devolve o input do bloco tool_use da ferramenta', () => {
    const input = { objeto: 'x' };
    const bruto = extrairToolInput(
      { content: [{ type: 'tool_use', name: FERRAMENTA_EXTRACAO, input }] },
      FERRAMENTA_EXTRACAO,
    );
    expect(bruto).toBe(input);
  });

  it('extrairToolInput rejeita resposta sem o tool_use esperado (camada 3)', () => {
    expect(() =>
      extrairToolInput({ content: [{ type: 'text' }] }, FERRAMENTA_EXTRACAO),
    ).toThrow(SaidaLlmInvalidaError);
  });

  it('round-trip: input conforme o schema → interpretarSaidaExtracao produz o agregado', () => {
    const bruto = extrairToolInput(
      {
        content: [
          {
            type: 'tool_use',
            name: FERRAMENTA_EXTRACAO,
            input: {
              objeto: {
                valor: 'Aquisição de notebooks',
                confianca: 0.9,
                citacao: { pagina: 1, secao: null, trecho: 'aquisição de notebooks' },
              },
              valorEstimado: { valor: null, confianca: 0.8, citacao: null },
              dataAberturaPropostas: { valor: null, confianca: 0.7, citacao: null },
              requisitos: [],
              riscos: [],
            },
          },
        ],
      },
      FERRAMENTA_EXTRACAO,
    );
    const extracao = interpretarSaidaExtracao(bruto, ENTRADA);
    expect(extracao.editalId).toBe(EditalId('edital-1'));
    expect(extracao.objeto.valor).toBe('Aquisição de notebooks');
    expect(extracao.paginas).toBe(3);
  });
});
