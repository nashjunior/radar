import type { Edital } from '../domain/entities/edital.js';
import type { EditalDTO } from './dtos.js';
import { EditalFaseMudou, EditalIngerido } from './events.js';

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
    proveniencia: {
      fonte: edital.proveniencia.fonte,
      dataColeta: edital.proveniencia.coletadoEm.toISOString(),
      baseLegal: edital.proveniencia.baseLegal,
    },
  };
}

/** Constrói o evento `edital.ingerido` a partir do agregado (Published Language, A03 §3). */
export function paraEventoEditalIngerido(edital: Edital): EditalIngerido {
  return new EditalIngerido({
    editalId: edital.id,
    numeroControlePncp: edital.numeroControlePncp.valor,
    modalidadeCodigo: edital.modalidade.codigo,
    faseAtual: edital.faseAtual,
    dataAtualizacao: edital.dataAtualizacao,
    objeto: edital.objeto,
    orgaoUf: edital.orgao.uf,
    valorEstimado: edital.valorEstimado?.valor ?? null,
    dataPublicacao: edital.dataPublicacao,
    proveniencia: {
      fonte: edital.proveniencia.fonte,
      baseLegal: edital.proveniencia.baseLegal,
      dataColeta: edital.proveniencia.coletadoEm.toISOString(),
    },
  });
}

/** Constrói o evento `edital.fase-mudou` a partir do par (fase anterior, edital atual). */
export function paraEventoFaseMudou(anterior: Edital, atual: Edital): EditalFaseMudou {
  return new EditalFaseMudou({
    editalId: atual.id,
    numeroControlePncp: atual.numeroControlePncp.valor,
    faseAnterior: anterior.faseAtual,
    faseAtual: atual.faseAtual,
    dataAtualizacao: atual.dataAtualizacao,
  });
}
