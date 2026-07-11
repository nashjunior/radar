/**
 * @radar/pncp-mock — mock/fixtures do PNCP para stress tests (P-32 / RAD-166).
 *
 * Nunca usa a API pública do PNCP (regra dura A04 §4).
 *
 * Exportações:
 *   - Fixtures: tipos de wire format + geradores com perfil P-31
 *   - MockPncpGateway: implementação in-process (sem HTTP)
 *   - PncpMockServer: servidor HTTP leve para testes do adaptador HTTP
 */

// Fixtures & wire format
export type { PncpPaginaRaw, PncpContratacaoRaw, OpcoesGeracao } from './fixtures.js';
export {
  MODALIDADES,
  PERFIL_DIA_UTIL_PUBLICACAO,
  VOLUME_ATUALIZACOES_DIA_UTIL,
  TAMANHO_PAGINA_MAX,
  gerarContratacaoRaw,
  gerarPagina,
  paginaVazia,
} from './fixtures.js';

// Mock gateway (in-process)
export type { ContratacaoData, ArquivoPncpData, CenarioErro, MockPncpConfig } from './mock-gateway.js';
export {
  MockPncpGateway,
  MockHttpError,
  criarGatewayDiaUtil,
  criarGatewaySmoke,
  criarGatewaySigiloso,
  MODALIDADES_DOMINANTES,
  TODOS_MODALIDADES,
} from './mock-gateway.js';

// Mock server (HTTP)
export type { CenarioErroServidor, PncpMockServerConfig, ServidorIniciado } from './mock-server.js';
export { PncpMockServer, criarServidorMock } from './mock-server.js';
