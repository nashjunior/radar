/**
 * DoD RAD-251: testa os 3 estados críticos de assinatura.
 * trial próximo do fim, cota cheia (402 → ModalUpgrade), inadimplente.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { BannerAssinatura } from '@/ui/components/BannerAssinatura';
import { ModalUpgrade } from '@/ui/components/ModalUpgrade';
import type { AssinaturaViewModel } from '@/domain/assinatura';

function makeAssinatura(overrides: Partial<AssinaturaViewModel> = {}): AssinaturaViewModel {
  return {
    estado: 'trial',
    plano: { codigo: 'starter', cota: 10 },
    usoReservado: 0,
    usoConfirmado: 0,
    diasRestantes: 3,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Estado 1: Trial próximo do fim
// ---------------------------------------------------------------------------
describe('BannerAssinatura — trial', () => {
  it('exibe banner de alerta quando trial expira em ≤7 dias', () => {
    render(
      <BannerAssinatura
        assinatura={makeAssinatura({ estado: 'trial', diasRestantes: 3 })}
        onVerPlanos={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Trial expira em/)).toBeTruthy();
    expect(screen.getByText(/Ver planos/)).toBeTruthy();
  });

  it('não exibe banner quando trial expira em >7 dias', () => {
    const { container } = render(
      <BannerAssinatura
        assinatura={makeAssinatura({ estado: 'trial', diasRestantes: 10 })}
        onVerPlanos={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('chama onVerPlanos ao clicar em "Ver planos"', async () => {
    const onVerPlanos = vi.fn();
    render(
      <BannerAssinatura
        assinatura={makeAssinatura({ estado: 'trial', diasRestantes: 3 })}
        onVerPlanos={onVerPlanos}
      />,
    );
    screen.getByText('Ver planos').click();
    expect(onVerPlanos).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Estado 2: Cota esgotada (402 → ModalUpgrade)
// ---------------------------------------------------------------------------
describe('ModalUpgrade — cota cheia', () => {
  it('exibe modal com dados de cota e botão de upgrade', () => {
    render(
      <ModalUpgrade
        cota={10}
        usado={10}
        upgradeDisponivel={true}
        onVerPlanos={vi.fn()}
        onFechar={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/Cota de triagens esgotada/)).toBeTruthy();
    expect(screen.getByText(/10 de 10/)).toBeTruthy();
    expect(screen.getByText(/Ver planos/)).toBeTruthy();
  });

  it('oculta botão de upgrade quando upgradeDisponivel=false', () => {
    render(
      <ModalUpgrade
        cota={10}
        usado={10}
        upgradeDisponivel={false}
        onVerPlanos={vi.fn()}
        onFechar={vi.fn()}
      />,
    );
    expect(screen.queryByText('Ver planos')).toBeNull();
    expect(screen.getByText(/Aguarde o próximo ciclo/)).toBeTruthy();
  });

  it('chama onFechar ao clicar em "Fechar"', () => {
    const onFechar = vi.fn();
    render(
      <ModalUpgrade
        cota={10}
        usado={10}
        upgradeDisponivel={true}
        onVerPlanos={vi.fn()}
        onFechar={onFechar}
      />,
    );
    screen.getByText('Fechar').click();
    expect(onFechar).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Estado 3: Inadimplente
// ---------------------------------------------------------------------------
describe('BannerAssinatura — inadimplente', () => {
  it('exibe banner de erro com CTA de regularizar', () => {
    render(
      <BannerAssinatura
        assinatura={makeAssinatura({ estado: 'inadimplente', diasRestantes: 0 })}
        onVerPlanos={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Pagamento pendente/)).toBeTruthy();
    expect(screen.getByText('Regularizar')).toBeTruthy();
  });

  it('chama onVerPlanos ao clicar em "Regularizar"', () => {
    const onVerPlanos = vi.fn();
    render(
      <BannerAssinatura
        assinatura={makeAssinatura({ estado: 'inadimplente', diasRestantes: 0 })}
        onVerPlanos={onVerPlanos}
      />,
    );
    screen.getByText('Regularizar').click();
    expect(onVerPlanos).toHaveBeenCalledOnce();
  });

  it('banner de erro para estado suspensa sem CTA', () => {
    render(
      <BannerAssinatura
        assinatura={makeAssinatura({ estado: 'suspensa', diasRestantes: 0 })}
        onVerPlanos={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/suspensa/)).toBeTruthy();
    expect(screen.queryByText(/Regularizar/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// http-client: 402 → CotaExcedidaError
// ---------------------------------------------------------------------------
describe('fetchApi — 402 → CotaExcedidaError', () => {
  it('lança CotaExcedidaError com dados do corpo JSON', async () => {
    const { fetchApi } = await import('@/infra/api/http-client');
    const { CotaExcedidaError } = await import('@/application/errors');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ cota: 10, usado: 10, upgradeDisponivel: true }), { status: 402 }),
    ));

    const err = await fetchApi('/api/triagem/123/solicitar', () => Promise.resolve(null))
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CotaExcedidaError);
    const cotaErr = err as InstanceType<typeof CotaExcedidaError>;
    expect(cotaErr.cota).toBe(10);
    expect(cotaErr.usado).toBe(10);
    expect(cotaErr.upgradeDisponivel).toBe(true);

    vi.unstubAllGlobals();
  });
});
