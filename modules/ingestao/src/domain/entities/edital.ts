import type { EditalId } from '@radar/kernel';
import { Cnpj } from '../value-objects/cnpj.js';
import { Modalidade } from '../value-objects/modalidade.js';
import { NumeroControlePncp } from '../value-objects/numero-controle-pncp.js';
import { Proveniencia } from '../value-objects/proveniencia.js';
import { ValorMonetario } from '../value-objects/valor-monetario.js';
import { IdentificadorCompraInvalidoError } from '../errors/index.js';
import { ItemEdital } from './item-edital.js';

/** Órgão contratante, com CNPJ validado. */
export interface EditalOrgao {
  readonly cnpj: Cnpj;
  readonly nome: string;
  readonly uf: string;
  readonly municipio: string;
}

export interface CriarEditalProps {
  id: EditalId;
  numeroControlePncp: string;
  /** Ano/sequencial da compra no PNCP — chave do endpoint de detalhe/arquivos (A02 §2). */
  anoCompra: number;
  sequencialCompra: number;
  modalidadeCodigo: number;
  modalidadeNome: string;
  faseAtual: string;
  objeto: string;
  /** number (JSON/API) ou string ("1234567.89" vindo do Postgres numeric) — ambos aceitos. */
  valorEstimado: number | string | null;
  prazoProposta: Date | null;
  dataPublicacao: Date;
  dataAtualizacao: Date;
  /** CNPJ como string — validado e convertido para VO dentro de `criar()`. */
  orgao: {
    cnpj: string;
    nome: string;
    uf: string;
    municipio: string;
  };
  proveniencia: { fonte: string; baseLegal: string; coletadoEm: Date };
  itens: ReadonlyArray<{
    numeroItem: number;
    descricao: string;
    quantidade: number;
    valorUnitarioEstimado?: number | string | null;
  }>;
}

/**
 * Agregado raiz do contexto Ingestão & Catálogo (docs/13, §3).
 * Imutável — mudanças de fase via `atualizarFase`.
 * Invariante: upsert idempotente por `numeroControlePncp` (A02, §3).
 */
export class Edital {
  private constructor(
    readonly id: EditalId,
    readonly numeroControlePncp: NumeroControlePncp,
    readonly anoCompra: number,
    readonly sequencialCompra: number,
    readonly modalidade: Modalidade,
    readonly faseAtual: string,
    readonly objeto: string,
    readonly valorEstimado: ValorMonetario | null,
    readonly prazoProposta: Date | null,
    readonly dataPublicacao: Date,
    readonly dataAtualizacao: Date,
    readonly orgao: EditalOrgao,
    readonly proveniencia: Proveniencia,
    readonly itens: readonly ItemEdital[],
  ) {}

  static criar(props: CriarEditalProps): Edital {
    if (!Number.isInteger(props.anoCompra) || props.anoCompra <= 0) {
      throw new IdentificadorCompraInvalidoError('anoCompra', props.anoCompra);
    }
    if (!Number.isInteger(props.sequencialCompra) || props.sequencialCompra <= 0) {
      throw new IdentificadorCompraInvalidoError('sequencialCompra', props.sequencialCompra);
    }
    const orgao: EditalOrgao = {
      cnpj: Cnpj.criar(props.orgao.cnpj),
      nome: props.orgao.nome,
      uf: props.orgao.uf,
      municipio: props.orgao.municipio,
    };
    return new Edital(
      props.id,
      NumeroControlePncp.criar(props.numeroControlePncp),
      props.anoCompra,
      props.sequencialCompra,
      Modalidade.criar(props.modalidadeCodigo, props.modalidadeNome),
      props.faseAtual,
      props.objeto,
      props.valorEstimado != null ? ValorMonetario.criar(props.valorEstimado) : null,
      props.prazoProposta,
      props.dataPublicacao,
      props.dataAtualizacao,
      orgao,
      Proveniencia.criar(props.proveniencia),
      props.itens.map(i => ItemEdital.criar(i)),
    );
  }

  /** Retorna nova instância com a fase atualizada — evento `edital.fase-mudou`. */
  atualizarFase(novaFase: string, dataAtualizacao: Date): Edital {
    return new Edital(
      this.id,
      this.numeroControlePncp,
      this.anoCompra,
      this.sequencialCompra,
      this.modalidade,
      novaFase,
      this.objeto,
      this.valorEstimado,
      this.prazoProposta,
      this.dataPublicacao,
      dataAtualizacao,
      this.orgao,
      this.proveniencia,
      this.itens,
    );
  }
}
