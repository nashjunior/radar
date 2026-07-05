/**
 * Gateway stub — retorna dados de demonstração enquanto o backend de Triagem
 * (Bento/Iara, A17) não expõe o contrato real. [A VALIDAR — P-TBD trocar por TriagemHttpGateway]
 */
import { EditalId as mkEditalId, PerfilId as mkPerfilId } from '@radar/kernel';
import type { EditalId, PerfilId, TenantId } from '@radar/kernel';
import type { TriagemGateway } from '@/application/ports';
import type { TriagemViewModel } from '@/domain/triagem-view-model';

export class TriagemStubGateway implements TriagemGateway {
  async buscarPorEdital(
    input: { tenantId: TenantId; editalId: EditalId; perfilId: PerfilId },
    signal: AbortSignal,
  ): Promise<TriagemViewModel | null> {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, 600);
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(signal.reason);
      });
    });

    return {
      editalId: mkEditalId(input.editalId),
      perfilId: mkPerfilId(input.perfilId),
      aderencia: 0.92,
      recomendacao: 'go',
      confiancaIA: 0.94,
      paginasEdital: 42,
      camposAnalise: [
        {
          titulo: '📋 Objeto',
          conteudo:
            'Aquisição de 120 computadores desktop com especificações mínimas definidas no Termo de Referência (Anexo I), destinados à modernização do parque tecnológico das unidades administrativas do FNDE.',
          fonte: 'Edital §1.1, Anexo I TR §2',
        },
        {
          titulo: '📋 Requisitos de habilitação',
          conteudo:
            '• Certidão Negativa de Débitos (CND) federal, estadual e municipal\n• Balanço patrimonial dos últimos 3 exercícios\n• Comprovação de capacidade técnica: fornecimento de ≥ 50 unidades similares em contrato único\n• Registro no SICAF',
          fonte: 'Edital §8.1 a §8.5',
        },
        {
          titulo: '⏱ Prazos críticos',
          conteudo:
            '• Envio de propostas: até 10/07/2026 às 13h59\n• Sessão de disputa: 10/07/2026 às 14h\n• Prazo de entrega dos equipamentos: 30 dias após assinatura do contrato',
          fonte: 'Edital §5.2, §11.1',
        },
      ],
      checklist: [
        { ok: true,  texto: 'Objeto compatível com CNAE 4751-2' },
        { ok: true,  texto: 'Valor dentro da faixa configurada' },
        { ok: true,  texto: 'Região: DF (inclusa no radar)' },
        { ok: false, texto: 'Capacidade técnica: verificar comprovante ≥ 50 unidades em contrato único' },
        { ok: true,  texto: 'SICAF ativo — atualizado em 03/2026' },
      ],
    };
  }
}
