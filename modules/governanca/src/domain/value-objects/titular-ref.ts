import { DomainError } from '@radar/kernel';

/** Lançado quando titularRef contém PII bruto (CPF ou e-mail não hasheado). P-105/docs/05 §9. */
export class TitularRefPiiError extends DomainError {
  readonly code = 'TITULAR_REF_PII_DETECTADO' as const;
  constructor() {
    super(
      'titularRef não pode conter CPF ou e-mail bruto — use referência/hash opaco (P-105/docs/05 §9)',
    );
  }
}

/** Detecta CPF bruto: 000.000.000-00 ou 00000000000 (com ou sem pontuação). */
const CPF_BRUTO_RE = /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/;

/** Detecta e-mail bruto: contém '@'. Qualquer string com '@' é candidata a PII. */
const EMAIL_BRUTO_RE = /[^@\s]+@[^@\s]+\.[^@\s]+/;

/**
 * Value Object que representa uma referência opaca ao titular declarado.
 *
 * Invariante P-105: nunca armazena CPF bruto nem e-mail não hasheado.
 * O construtor privado garante que só instâncias validadas existam.
 */
export class TitularRef {
  private constructor(readonly value: string) {}

  static criar(raw: string): TitularRef {
    if (CPF_BRUTO_RE.test(raw) || EMAIL_BRUTO_RE.test(raw)) {
      throw new TitularRefPiiError();
    }
    return new TitularRef(raw);
  }

  toString(): string {
    return this.value;
  }
}
