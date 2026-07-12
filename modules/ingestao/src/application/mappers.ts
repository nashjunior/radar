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

/**
 * Teto do único campo de texto livre do payload de `edital.ingerido` — `objeto` vem do PNCP,
 * fonte não confiável (docs/05), sem limite de tamanho conhecido na origem. No payload da fila
 * ele serve só ao matching por palavra-chave (docs/13 §4-5, P-97), que não precisa do texto
 * integral; o valor completo permanece no DB da Ingestão via `editalParaDTO`/repositório — quem
 * precisar do texto do edital usa a referência (claim-check), nunca o payload de fila. Truncagem
 * explícita (não silenciosa) aqui é o único guard de tamanho antes da publicação: mantém o
 * payload muito abaixo do teto duro do SQS (`infra/terraform/modules/queue/main.tf`,
 * `max_message_size = 262144` bytes), mesmo somado aos demais campos escalares do evento.
 */
export const OBJETO_MAX_CHARS = 5_000;
const OBJETO_SUFIXO_TRUNCADO = '…[truncado]';

/** Trunca `objeto` no limite acima, com marcador explícito de que houve corte. */
export function truncarObjetoParaFila(objeto: string): string {
  if (objeto.length <= OBJETO_MAX_CHARS) return objeto;
  return objeto.slice(0, OBJETO_MAX_CHARS - OBJETO_SUFIXO_TRUNCADO.length) + OBJETO_SUFIXO_TRUNCADO;
}

/** Constrói o evento `edital.ingerido` a partir do agregado (Published Language, A03 §3). */
export function paraEventoEditalIngerido(edital: Edital): EditalIngerido {
  return new EditalIngerido({
    editalId: edital.id,
    numeroControlePncp: edital.numeroControlePncp.valor,
    modalidadeCodigo: edital.modalidade.codigo,
    faseAtual: edital.faseAtual,
    dataAtualizacao: edital.dataAtualizacao,
    objeto: truncarObjetoParaFila(edital.objeto),
    orgaoUf: edital.orgao.uf,
    valorEstimado: edital.valorEstimado?.valor ?? null,
    dataPublicacao: edital.dataPublicacao,
    prazoProposta: edital.prazoProposta,
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
