/**
 * Container de DI mínimo para o front.
 * Compõe os use cases com seus gateways concretos.
 * Stub ativo enquanto o backend de Triagem (Bento/Iara, A17) não expõe contrato real.
 */
import { GetTriagemUseCase } from '@/application/use-cases/get-triagem';
import { TriagemStubGateway } from '@/infra/api/triagem-stub-gateway';

const triagemGateway = new TriagemStubGateway();

export const useCases = {
  getTriagem: new GetTriagemUseCase(triagemGateway),
} as const;

export type UseCases = typeof useCases;
