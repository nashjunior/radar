/**
 * Limiar de confiança PADRÃO do gate da Triagem (P-19 · docs/10 §4 · arq/17 §6).
 *
 * A estrutura da política já está fixada (arq/17 §6): opera por campo, com `is_critico`
 * (docs/10 §5.2) definindo onde a régua é dura, e a confiança agregada = MÍNIMO dos campos
 * críticos (`ExtracaoEdital.confiancaGlobal`). O domínio mantém `limiar` como PARÂMETRO
 * (`Confianca.suficiente` / `ExtracaoEdital.suficiente` / `CampoExtraido.exibivelComoFato`)
 * de propósito — "o código já expõe o limiar como parâmetro para permitir a calibração sem
 * mudar a estrutura" (arq/17 §6).
 *
 * Este é a FONTE ÚNICA do valor: a composição-root injeta em `TriarEditalInput.limiarConfianca`
 * (wiring do worker, RAD-31/Bento) e os testes referenciam este símbolo.
 *
 * VALOR CALIBRADO (P-19 · RAD-139 · 2026-07-08):
 *   Protocolo A16 §2.4 executado com gold set sintético de 30 editais
 *   (scripts/fixtures/gold-set-rotulado-sintetico.json · scripts/calibrar-limiar-gold-set.ts):
 *     — recall@0,70 = 95,4% ≥ 95% ✓
 *     — recall@0,71 = 91,9%  < 95% ✗  → 0,70 é o maior corte válido
 *     — zero alucinação numérica @0,70 ✓ (todos erros numéricos tinham conf < 0,70)
 *     — sem corte separado por classe numérica necessário
 *   Recalibrar quando gold set REAL (P-18/P-84/P-85) estiver disponível:
 *     `pnpm --filter @radar/triagem calibrar:limiar [gold-set-rotulado.json]`
 */
export const LIMIAR_CONFIANCA_PADRAO = 0.7;
