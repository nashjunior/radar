import { createContext, useContext } from 'react';
import type { UseCases } from '@/infra/container';

const UseCasesContext = createContext<UseCases | null>(null);

export { UseCasesContext };

export function useUseCases(): UseCases {
  const ctx = useContext(UseCasesContext);
  if (!ctx) throw new Error('useUseCases deve ser usado dentro de UseCasesContext.Provider');
  return ctx;
}
