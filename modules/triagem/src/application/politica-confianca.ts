/**
 * Limiar de confiança PADRÃO do gate da Triagem (P-19 · docs/10 §4 · arq/17 §6).
 *
 * A estrutura da política já está fixada (arq/17 §6): opera por campo, com `is_critico`
 * (docs/10 §5.2) definindo onde a régua é dura, e a confiança agregada = MÍNIMO dos campos
 * críticos (`ExtracaoEdital.confiancaGlobal`). O domínio mantém `limiar` como PARÂMETRO
 * (`Confianca.suficiente` / `ExtracaoEdital.suficiente` / `CampoExtraido.exibivelComoFato`)
 * de propósito — "o código já expõe o limiar como parâmetro para permitir a calibração sem
 * mudar a estrutura" (arq/17 §6). Falta apenas o VALOR — este é P-19.
 *
 * Este é o valor PROVISÓRIO de lançamento e a FONTE ÚNICA dele: a composição-root injeta em
 * `TriarEditalInput.limiarConfianca` (wiring do worker, RAD-31/Bento) e os testes referenciam
 * este símbolo, em vez de literais mágicos espalhados.
 *
 * VALOR `[A VALIDAR]` → P-18 / A16 §2.4: 0.7 é um corte conservador de lançamento, NÃO uma
 * calibração. Recalibrar varrendo o limiar no gold set — escolher o menor corte que ainda
 * garante recall ≥ 95% nos campos críticos (docs/10 §5). Os campos críticos NUMÉRICOS
 * (`valorEstimado`, `dataAberturaPropostas`) podem exigir corte mais estrito, pelo guardrail
 * "zero alucinação em campo numérico" (docs/10 §5 / docs/08 §4) — refinamento por classe é
 * calibração de gold set, não mudança de estrutura. Co-propriedade QA/Quésia (A16).
 */
export const LIMIAR_CONFIANCA_PADRAO = 0.7;
