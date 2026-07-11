// Re-exporta do módulo canônico em src/ para compatibilidade com importadores de scripts/.
// A implementação vive em src/application/calibracao-limiar.ts.
export {
  calibrar,
  varreLimiar,
} from '../src/application/calibracao-limiar.js';
export type {
  CampoRotulado,
  EditalRotulado,
  GoldSet,
  PontoLimiar,
  ResultadoCalibracao,
} from '../src/application/calibracao-limiar.js';
