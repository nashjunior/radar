import { CanalInvalidoError } from '../errors/index.js';

export type CanalTipo = 'EMAIL' | 'WEBHOOK' | 'IN_APP';

const CANAIS_VALIDOS: CanalTipo[] = ['EMAIL', 'WEBHOOK', 'IN_APP'];

export class Canal {
  private constructor(readonly tipo: CanalTipo) {}

  static criar(tipo: string): Canal {
    if (!(CANAIS_VALIDOS as string[]).includes(tipo))
      throw new CanalInvalidoError(tipo);
    return new Canal(tipo as CanalTipo);
  }

  get ehEmail(): boolean {
    return this.tipo === 'EMAIL';
  }

  equals(other: Canal): boolean {
    return this.tipo === other.tipo;
  }

  toString(): string {
    return this.tipo;
  }
}
