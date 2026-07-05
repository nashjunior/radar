import { DomainError } from '@radar/kernel';

/** Canal de entrega indisponível ou com falha persistente. */
export class CanalIndisponivelError extends DomainError {
  readonly code = 'CANAL_INDISPONIVEL' as const;
  constructor(canal: string) {
    super(`canal indisponível: ${canal}`);
  }
}

/** Preferência de notificação inválida. */
export class PreferenciaInvalidaError extends DomainError {
  readonly code = 'PREFERENCIA_INVALIDA' as const;
  constructor(detalhe: string) {
    super(`preferência inválida: ${detalhe}`);
  }
}

/** Tipo de canal de notificação desconhecido. */
export class CanalInvalidoError extends DomainError {
  readonly code = 'CANAL_INVALIDO' as const;
  constructor(tipo: string) {
    super(`tipo de canal desconhecido: ${tipo}`);
  }
}
