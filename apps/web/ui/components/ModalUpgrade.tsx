/** @figma nodeId=RAD-251-modal-upgrade fileKey=SAbjXOQO4gFAH4syq7VdQf */
import { Button } from './Button.js';

interface ModalUpgradeProps {
  cota: number;
  usado: number;
  upgradeDisponivel: boolean;
  onVerPlanos: () => void;
  onFechar: () => void;
}

/** Modal exibido quando o back retorna HTTP 402 (cota de triagens esgotada). */
export function ModalUpgrade({ cota, usado, upgradeDisponivel, onVerPlanos, onFechar }: ModalUpgradeProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-upgrade-titulo"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}
    >
      <div
        style={{
          background: 'var(--radar-color-bg-surface)',
          borderRadius: 'var(--radar-radius-lg)',
          padding: 'var(--radar-space-8)',
          maxWidth: 400,
          width: '100%',
          margin: '0 var(--radar-space-4)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
        }}
      >
        <h2
          id="modal-upgrade-titulo"
          style={{
            margin: '0 0 var(--radar-space-3)',
            fontSize: 'var(--radar-fontSize-lg)',
            fontFamily: 'var(--radar-fontFamily-sans)',
            color: 'var(--radar-color-text-default)',
          }}
        >
          Cota de triagens esgotada
        </h2>
        <p
          style={{
            margin: '0 0 var(--radar-space-6)',
            color: 'var(--radar-color-text-muted)',
            fontFamily: 'var(--radar-fontFamily-sans)',
            fontSize: 'var(--radar-fontSize-sm)',
            lineHeight: 1.6,
          }}
        >
          Você usou {usado} de {cota} triagens neste ciclo.{' '}
          {upgradeDisponivel
            ? 'Para continuar analisando editais, faça upgrade do seu plano.'
            : 'Aguarde o próximo ciclo de faturamento para solicitar novas triagens.'}
        </p>
        <div style={{ display: 'flex', gap: 'var(--radar-space-3)', justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onFechar}>Fechar</Button>
          {upgradeDisponivel && (
            <Button variant="primary" onClick={onVerPlanos}>Ver planos</Button>
          )}
        </div>
      </div>
    </div>
  );
}
