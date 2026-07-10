import { describe, expect, it } from 'vitest';
import {
  CORPUS_ADVERSARIAL,
  INVARIANTES_RED_TEAM,
  avaliarCasoAdversarial,
} from '../../infra/red-team/corpus-injecao.js';

/**
 * Gate de RED-TEAM (P-72; A11 §4; A07 AB4–AB6/AB8; A16 §5 TC-AB4). Roda o corpus de editais
 * adversariais contra a defesa de injeção REAL e REPROVA O BUILD se a saída for subvertida. Roda no
 * CI Gate 4 (`pnpm turbo test`) hoje, sem depender do runner de eval da P-85 (que importa o MESMO
 * corpus/harness pelo barril `@radar/triagem/infra` — sem duplicação).
 *
 * DoD (três invariantes): a decisão go/no-go continua do usuário/domínio; citação obrigatória
 * (conteúdo inventado não vira fato); a classe crítica nunca vaza.
 */
describe('Red-team — corpus de editais adversariais (P-72 / A11 §4)', () => {
  it('o corpus cobre injeção DIRETA e INDIRETA e não pode encolher silenciosamente', () => {
    const categorias = new Set(CORPUS_ADVERSARIAL.map((c) => c.categoria));
    expect(categorias).toContain('direta');
    expect(categorias).toContain('indireta');
    // Cobre os vetores A07: AB4 (ignore), AB5 (exfiltra), AB6 (XSS), AB8 (numérico), forçar decisão.
    expect(CORPUS_ADVERSARIAL.length).toBeGreaterThanOrEqual(10);
    const ids = CORPUS_ADVERSARIAL.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length); // ids únicos
  });

  it.each(CORPUS_ADVERSARIAL.map((caso) => [caso.id, caso] as const))(
    'contém o ataque: %s',
    async (_id, caso) => {
      const veredicto = await avaliarCasoAdversarial(caso);
      // Mensagem rica: se subverter, o CI mostra EXATAMENTE a camada/invariante quebrada.
      expect(veredicto.violacoes, `[${caso.vetor}] ${caso.descricao}`).toEqual([]);
      expect(veredicto.contido).toBe(true);
    },
  );

  it('as três invariantes do DoD estão declaradas e são as verificadas pelo harness', () => {
    expect(Object.values(INVARIANTES_RED_TEAM)).toHaveLength(3);
  });
});
