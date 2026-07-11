/** Gateway HTTP para GET /api/alertas. */
import type { AlertasApiGateway } from '@/application/ports';
import type { AlertaCardItem } from '@/domain/alerta-card';
import { SessaoExpiradaError, AcessoNegadoError } from '@/application/errors';

interface AlertaDTO {
  id: string;
  editalId: string;
  /** 0–1 — converter para 0–100 ao mapear para AlertaCardItem. */
  aderencia: number;
  relevante: boolean | null;
  proveniencia?: { fonte: string; baseLegal: string; dataColeta: string };
  modalidade?: string;
  titulo?: string;
  orgao?: string;
  valorEstimado?: number | null;
  dataAbertura?: string;
}

export class AlertasHttpGateway implements AlertasApiGateway {
  constructor(
    private readonly baseUrl: string = '',
    private readonly getToken: () => Promise<string | null>,
  ) {}

  private async headers(): Promise<Record<string, string>> {
    const token = await this.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async listar(signal: AbortSignal): Promise<AlertaCardItem[]> {
    const res = await fetch(`${this.baseUrl}/api/alertas`, {
      headers: await this.headers(),
      signal,
    });

    if (res.status === 401) throw new SessaoExpiradaError();
    if (res.status === 403) throw new AcessoNegadoError();
    if (!res.ok) throw new Error(`[AlertasHttpGateway] HTTP ${res.status}`);

    const dtos = (await res.json()) as AlertaDTO[];
    return dtos.map(dtoParaCardItem);
  }
}

function dtoParaCardItem(dto: AlertaDTO): AlertaCardItem {
  return {
    alertaId: dto.id,
    editalId: dto.editalId,
    modalidade: dto.modalidade ?? '',
    titulo: dto.titulo ?? '',
    orgao: dto.orgao ?? '',
    valorEstimado: dto.valorEstimado ?? null,
    dataAbertura: dto.dataAbertura ?? null,
    aderencia: Math.round(dto.aderencia * 100),
    relevante: dto.relevante,
    ...(dto.proveniencia !== undefined
      ? {
          proveniencia: {
            fonte: dto.proveniencia.fonte,
            dataColeta: dto.proveniencia.dataColeta,
            baseLegal: dto.proveniencia.baseLegal,
          },
        }
      : {}),
  };
}
