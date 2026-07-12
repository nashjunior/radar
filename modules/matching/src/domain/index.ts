export { Alerta } from './entities/alerta.js';
export type { CriarAlertaParams } from './entities/alerta.js';
export { CriterioDeMonitoramento } from './entities/criterio-de-monitoramento.js';
export type {
  CriarCriterioParams,
  EditalParaCasamento,
} from './entities/criterio-de-monitoramento.js';
export {
  AcessoNegadoError,
  AderenciaMatchingInvalidaError,
  AlertaNaoEncontradoError,
  CriterioInvalidoError,
  FaixaValorInvalidaError,
  PalavrasChaveVaziaError,
} from './errors/index.js';
export { AderenciaMatching } from './value-objects/aderencia-matching.js';
export { FaixaValor } from './value-objects/faixa-valor.js';
export { PalavrasChave } from './value-objects/palavras-chave.js';
export { PrazoCritico, DIAS_ATE_PRAZO_CRITICO_PADRAO } from './value-objects/prazo-critico.js';
