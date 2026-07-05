import { AcessoNegadoError } from '@radar/kernel';
import type { ClienteFinalId, EditalId, PerfilId, TenantId } from '@radar/kernel';
import type { ExtracaoEdital } from '../../domain/extracao-edital.js';
import type { Triagem } from '../../domain/triagem.js';
import type { CampoExtraido } from '../../domain/value-objects/campo-extraido.js';
import type { CampoAnaliseDTO, TriagemLeituraDTO } from '../dtos.js';
import type { ExtracaoRepository, TriagemRepository } from '../ports.js';

export interface ConsultarTriagemInput {
  tenantId: TenantId;
  editalId: EditalId;
  perfilId: PerfilId;
  clienteFinalId: ClienteFinalId;
}

/**
 * Trigger: BFF, `GET /api/triagem/:editalId` (RAD-31/RAD-42, docs/98 P-86). É o CAMINHO DE LEITURA
 * SÍNCRONO — distinto do fluxo assíncrono comando/worker: NÃO chama o LLM, apenas projeta o que já foi
 * triado. Serve o `TriagemLeituraDTO` (A17 §4.2), NÃO o `TriagemDTO`/`riscos[]` de comando.
 *
 * Chave (tenantId, editalId, perfilId). No MVP single-tenant (P-25) o BFF resolve o perfil ativo do
 * cliente antes de chamar (a URL só traz editalId + x-tenant-id); quando >1 perfil por cliente virar
 * realidade, `perfilId` migra para query param no contrato REST — [A VALIDAR] → docs/98 P-90.
 */
export class ConsultarTriagemUseCase {
  constructor(
    private readonly triagens: TriagemRepository,
    private readonly extracoes: ExtracaoRepository,
  ) {}

  async executar(
    input: ConsultarTriagemInput,
    signal: AbortSignal, // obrigatório — convenção P-78 / A10 §1 (idem modules/ingestao)
  ): Promise<TriagemLeituraDTO | null> {
    const triagem = await this.triagens.porEditalEPerfil(
      input.tenantId,
      input.clienteFinalId,
      input.editalId,
      input.perfilId,
      signal,
    );
    if (triagem === null) return null; // sem triagem (ou fora do escopo do tenant) → BFF 404 → SPA null

    // Autorização POR OBJETO (P-51 / AB1), nunca por filtro de query: escopo divergente lança —
    // o BFF mapeia AcessoNegadoError → 403 e a SPA também devolve null (nunca vaza o motivo; §5.3).
    if (
      triagem.tenantId !== input.tenantId ||
      triagem.clienteFinalId !== input.clienteFinalId
    ) {
      throw new AcessoNegadoError();
    }

    // Extração é catálogo GLOBAL (P-45): reidrata confiança/páginas/campos + a lista COMPLETA de
    // requisitos — o checklist precisa dos ATENDIDOS, não só das lacunas guardadas em `triagem.riscos`.
    const extracao = await this.extracoes.porEdital(input.editalId, signal);
    if (extracao === null) return null; // triagem sem extração é estado inconsistente → ausente

    return projetarLeitura(triagem, extracao);
  }
}

/**
 * Projeção domínio → `TriagemLeituraDTO`. Regra-chave: os `riscos[]` do domínio NÃO aparecem no
 * contrato de leitura — viram `checklist.ok === false` (docs/10 §4). `camposAnalise` é a face de
 * apresentação dos `CampoExtraido`.
 */
export function projetarLeitura(triagem: Triagem, extracao: ExtracaoEdital): TriagemLeituraDTO {
  const lacunas = new Set(triagem.riscos.map((r) => r.descricao)); // "não atende: <requisito>"
  return {
    editalId: triagem.editalId,
    perfilId: triagem.perfilId,
    aderencia: triagem.aderencia.valor,
    recomendacao: triagem.recomendacao,
    confiancaIA: extracao.confiancaGlobal().valor,
    paginasEdital: extracao.paginas,
    camposAnalise: camposExibiveis(extracao),
    checklist: extracao.requisitos.map((req) => ({
      ok: !lacunas.has(`não atende: ${req.descricao}`),
      texto: req.descricao,
    })),
  };
}

/** Rótulos de apresentação dos campos analisados (docs/10 §5.2). */
const CAMPOS_ANALISE: ReadonlyArray<{
  titulo: string;
  campo: (e: ExtracaoEdital) => CampoExtraido<unknown>;
  render: (valor: unknown) => string;
}> = [
  { titulo: 'Objeto', campo: (e) => e.objeto, render: (v) => String(v) },
  {
    titulo: 'Valor estimado',
    campo: (e) => e.valorEstimado,
    render: (v) => (v === null ? 'não informado' : formatarBRL(v as number)),
  },
  {
    titulo: 'Abertura das propostas',
    campo: (e) => e.dataAberturaPropostas,
    render: (v) => (v === null ? 'não informado' : (v as Date).toISOString().slice(0, 10)),
  },
];

/**
 * `camposAnalise` = projeção dos `CampoExtraido`. `conteudo` = "verificar" quando o campo não é
 * exibível como fato (sem citação — §6, docs/10 §4); `fonte` = citação renderizada ("p. 12, seção
 * 5.1") ou "". O limiar de confiança já foi aplicado no write path (`ExtrairEdital`/`TriarEdital`,
 * RAD-30): no read path a ausência de citação utilizável é o sinal de "verificar".
 */
function camposExibiveis(extracao: ExtracaoEdital): CampoAnaliseDTO[] {
  return CAMPOS_ANALISE.map(({ titulo, campo, render }) => {
    const c = campo(extracao);
    return {
      titulo,
      conteudo: c.citacao !== null ? render(c.valor) : 'verificar',
      fonte: c.citacao !== null ? c.citacao.toString() : '',
    };
  });
}

function formatarBRL(valor: number): string {
  return `R$ ${valor.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
