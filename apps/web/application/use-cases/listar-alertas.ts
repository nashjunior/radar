import type { AlertaCardItem } from '@/domain/alerta-card.js';
import type { AlertasApiGateway } from '@/application/ports.js';

export class ListarAlertasUseCase {
  constructor(private readonly alertas: AlertasApiGateway) {}

  async executar(signal: AbortSignal): Promise<AlertaCardItem[]> {
    return this.alertas.listar(signal);
  }
}
