import { DomainError } from '@radar/kernel';

export interface ErroSeguroParaLog {
  readonly tipo: string;
  readonly code?: string;
}

export function erroSeguroParaLog(err: unknown): ErroSeguroParaLog {
  if (err instanceof DomainError) {
    return { tipo: err.name, code: err.code };
  }

  if (err instanceof Error) {
    return { tipo: err.name };
  }

  return { tipo: typeof err };
}
