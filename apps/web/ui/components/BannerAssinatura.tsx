/** @figma nodeId=RAD-251-banner-assinatura fileKey=SAbjXOQO4gFAH4syq7VdQf */
import { AlertBanner } from './AlertBanner.js';
import type { AssinaturaViewModel } from '@/domain/assinatura';

interface BannerAssinaturaProps {
  assinatura: AssinaturaViewModel;
  onVerPlanos: () => void;
  onDismiss?: () => void;
}

/** Exibe banner contextual para estados críticos da assinatura (trial próximo do fim, inadimplente, suspensa). */
export function BannerAssinatura({ assinatura, onVerPlanos, onDismiss }: BannerAssinaturaProps) {
  const { estado, diasRestantes } = assinatura;

  if (estado === 'trial' && diasRestantes !== null && diasRestantes <= 7) {
    return (
      <AlertBanner type="alerta" {...(onDismiss ? { onDismiss } : {})} link={{ label: 'Ver planos', onClick: onVerPlanos }}>
        Trial expira em {diasRestantes === 0 ? 'hoje' : `${diasRestantes} ${diasRestantes === 1 ? 'dia' : 'dias'}`}.
      </AlertBanner>
    );
  }

  if (estado === 'inadimplente') {
    return (
      <AlertBanner type="erro" link={{ label: 'Regularizar', onClick: onVerPlanos }}>
        Pagamento pendente — regularize para não perder o acesso.
      </AlertBanner>
    );
  }

  if (estado === 'suspensa') {
    return (
      <AlertBanner type="erro">
        Conta suspensa — ações pagas estão bloqueadas.
      </AlertBanner>
    );
  }

  return null;
}
