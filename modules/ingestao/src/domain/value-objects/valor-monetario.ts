import { DomainError } from '@radar/kernel';

class ValorMonetarioInvalidoError extends DomainError {
  readonly code = 'VALOR_MONETARIO_INVALIDO' as const;
  constructor(entrada: number | string) {
    super(`valor monetário inválido: '${entrada}' (deve ser decimal não-negativo e finito)`);
  }
}

/**
 * VO de valor monetário em reais (BRL).
 *
 * Representação interna: string decimal exata, sem perda de precisão.
 * Aceita `number | string` na entrada:
 *   - `number`: vindo do JSON da API PNCP (precisão limitada ao float 64-bit da fonte).
 *   - `string`: vindo do PostgreSQL (`numeric` → pg devolve string) — preserva precisão total.
 *
 * Invariantes: não-negativo, finito, formato decimal válido.
 */
export class ValorMonetario {
  private constructor(
    /** Representação decimal exata (ex.: "1234567.8900"). */
    private readonly _repr: string,
  ) {}

  static criar(entrada: number | string): ValorMonetario {
    const str =
      typeof entrada === 'number'
        ? // Converte float para string; notação científica é aceita e normalizada
          (Number.isFinite(entrada) ? String(entrada) : null)
        : entrada.trim();

    if (str === null || str === '') {
      throw new ValorMonetarioInvalidoError(entrada);
    }

    // Aceita inteiro ou decimal com ponto (ex.: "0", "123", "1234.56", "0.0015")
    if (!/^\d+(\.\d+)?$/.test(str)) {
      throw new ValorMonetarioInvalidoError(entrada);
    }

    const n = parseFloat(str);
    if (!isFinite(n) || n < 0) {
      throw new ValorMonetarioInvalidoError(entrada);
    }

    return new ValorMonetario(str);
  }

  /**
   * Representação decimal exata — usar ao persistir em colunas `numeric` no PostgreSQL.
   * Evita a conversão de volta para float antes de gravar.
   */
  get representacaoDecimal(): string {
    return this._repr;
  }

  /**
   * Valor como `number` (float 64-bit).
   * Pode perder precisão para strings com muitos dígitos significativos.
   * Usar apenas para cálculos aproximados ou exibição.
   */
  get valor(): number {
    return parseFloat(this._repr);
  }

  /** Igualdade por valor numérico (ignora zeros à direita: "1.00" == "1.0"). */
  equals(other: ValorMonetario): boolean {
    return parseFloat(this._repr) === parseFloat(other._repr);
  }

  toString(): string {
    return this._repr;
  }
}
