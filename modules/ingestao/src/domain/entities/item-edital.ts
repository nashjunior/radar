import { ValorMonetario } from '../value-objects/valor-monetario.js';

/** Item/lote de um edital. */
export class ItemEdital {
  private constructor(
    readonly numeroItem: number,
    readonly descricao: string,
    readonly quantidade: number,
    readonly valorUnitarioEstimado: ValorMonetario | null,
  ) {}

  static criar(props: {
    numeroItem: number;
    descricao: string;
    quantidade: number;
    valorUnitarioEstimado?: number | string | null;
  }): ItemEdital {
    const valor =
      props.valorUnitarioEstimado != null
        ? ValorMonetario.criar(props.valorUnitarioEstimado)
        : null;
    return new ItemEdital(props.numeroItem, props.descricao, props.quantidade, valor);
  }
}
