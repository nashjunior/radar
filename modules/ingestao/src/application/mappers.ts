import type { Edital } from '../domain/entities/edital.js';
import type { EditalDTO } from './dtos.js';

/** Mapeia o agregado Edital para o DTO de saída. */
export function editalParaDTO(edital: Edital): EditalDTO {
  return {
    id: edital.id,
    numeroControlePncp: edital.numeroControlePncp.valor,
    modalidade: {
      codigo: edital.modalidade.codigo,
      nome: edital.modalidade.nome,
    },
    faseAtual: edital.faseAtual,
    objeto: edital.objeto,
    valorEstimado: edital.valorEstimado?.valor ?? null,
    prazoProposta: edital.prazoProposta?.toISOString() ?? null,
    dataPublicacao: edital.dataPublicacao.toISOString(),
    dataAtualizacao: edital.dataAtualizacao.toISOString(),
    orgao: {
      cnpj: edital.orgao.cnpj.valor,
      nome: edital.orgao.nome,
      uf: edital.orgao.uf,
      municipio: edital.orgao.municipio,
    },
    itens: edital.itens.map(i => ({
      numeroItem: i.numeroItem,
      descricao: i.descricao,
      quantidade: i.quantidade,
      valorUnitarioEstimado: i.valorUnitarioEstimado?.valor ?? null,
    })),
  };
}
