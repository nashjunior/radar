/** Gateway HTTP para GET /api/alertas. */
import type { AlertasApiGateway } from '@/application/ports';
import type { AlertaCardItem } from '@/domain/alerta-card';
import { fetchApi } from './http-client';

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

  async listar(signal: AbortSignal): Promise<AlertaCardItem[]> {
    const res = await fetchApi(`${this.baseUrl}/api/alertas`, this.getToken, { signal });
    const dtos = (await res!.json()) as AlertaDTO[];
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
