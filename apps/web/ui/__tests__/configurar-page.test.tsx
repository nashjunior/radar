/**
 * RAD-326: testa ConfigurarPage alinhada ao Figma 12:2.
 * — chip de segmento preenche palavras-chave
 * — link "Brasil inteiro" limpa o campo de UF
 * — salvar aciona os dois use cases (criterios + preferências) via Promise.allSettled
 * — falha parcial exibe mensagem unificada sem dizer "salvo"
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ConfigurarPage } from '@/ui/pages/configurar-page';
import { SEGMENTOS_ONBOARDING } from '@/domain/segmentos';

const mockCriterioExecutar = vi.fn();
const mockPrefsExecutar = vi.fn();
const mockLogin = vi.fn();

vi.mock('@/ui/providers/use-cases-provider', () => ({
  useUseCases: () => ({
    definirCriterio: { executar: mockCriterioExecutar },
    salvarPreferenciasNotificacao: { executar: mockPrefsExecutar },
  }),
}));

vi.mock('@/ui/providers/auth-provider', () => ({
  useAuth: () => ({ login: mockLogin }),
}));

vi.mock('@/ui/hooks/use-sessao', () => ({
  useSessao: () => ({
    sessao: null,
    pode: () => true,
  }),
}));

beforeEach(() => {
  mockCriterioExecutar.mockReset().mockResolvedValue({});
  mockPrefsExecutar.mockReset().mockResolvedValue({});
  mockLogin.mockReset();
});

function renderPage() {
  return render(<ConfigurarPage />);
}

describe('Chips de segmento', () => {
  it('mostra os 6 chips de segmento', () => {
    renderPage();
    for (const seg of SEGMENTOS_ONBOARDING) {
      expect(screen.getByText(seg.nome)).toBeTruthy();
    }
  });

  it('clicar num chip preenche palavras-chave com as palavras do segmento', () => {
    renderPage();
    const seg = SEGMENTOS_ONBOARDING[0]!;
    fireEvent.click(screen.getByText(seg.nome));
    const input = screen.getByPlaceholderText(/equipamentos/i) as HTMLInputElement;
    expect(input.value).toBe(seg.palavras.join(', '));
  });

  it('chip fica marcado como aria-pressed após clique', () => {
    renderPage();
    const seg = SEGMENTOS_ONBOARDING[2]!;
    const btn = screen.getByRole('button', { name: new RegExp(seg.nome) });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('trocar chip atualiza palavras-chave para o novo segmento', () => {
    renderPage();
    const seg0 = SEGMENTOS_ONBOARDING[0]!;
    const seg1 = SEGMENTOS_ONBOARDING[1]!;
    fireEvent.click(screen.getByText(seg0.nome));
    fireEvent.click(screen.getByText(seg1.nome));
    const input = screen.getByPlaceholderText(/equipamentos/i) as HTMLInputElement;
    expect(input.value).toBe(seg1.palavras.join(', '));
  });
});

describe('Campos de critério', () => {
  it('"Sem filtro de UF / Brasil inteiro" limpa o campo de UF', () => {
    renderPage();
    const ufInput = screen.getByPlaceholderText(/selecione a uf/i) as HTMLInputElement;
    fireEvent.change(ufInput, { target: { value: 'SP' } });
    expect(ufInput.value).toBe('SP');

    fireEvent.click(screen.getByText(/sem filtro de uf/i));
    expect(ufInput.value).toBe('');
  });

  it('não mostra WhatsApp nos canais de notificação', () => {
    renderPage();
    expect(screen.queryByText('WhatsApp')).toBeNull();
  });

  it('não há campo de faixa de valor', () => {
    renderPage();
    expect(screen.queryByText(/faixa/i)).toBeNull();
    expect(screen.queryByText(/valor mín/i)).toBeNull();
  });
});

describe('Salvar — dois requests independentes', () => {
  it('salvar aciona use case de critérios e de preferências', async () => {
    renderPage();

    const seg = SEGMENTOS_ONBOARDING[0]!;
    fireEvent.click(screen.getByText(seg.nome));
    fireEvent.click(screen.getByRole('button', { name: /salvar configurações/i }));

    await waitFor(() => {
      expect(mockCriterioExecutar).toHaveBeenCalledWith(
        expect.objectContaining({ palavrasChave: [...seg.palavras] }),
        expect.any(AbortSignal),
      );
      expect(mockPrefsExecutar).toHaveBeenCalledWith(
        expect.objectContaining({ frequencia: 'IMEDIATA', canais: expect.arrayContaining(['EMAIL', 'IN_APP']) }),
        expect.any(AbortSignal),
      );
    });
  });

  it('não envia regiaoUf quando UF está vazia', async () => {
    renderPage();
    fireEvent.click(screen.getByText(SEGMENTOS_ONBOARDING[0]!.nome));
    fireEvent.click(screen.getByRole('button', { name: /salvar configurações/i }));

    await waitFor(() => {
      const call = mockCriterioExecutar.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(call).not.toHaveProperty('regiaoUf');
    });
  });

  it('envia regiaoUf quando UF está preenchida', async () => {
    renderPage();
    fireEvent.click(screen.getByText(SEGMENTOS_ONBOARDING[0]!.nome));
    fireEvent.change(screen.getByPlaceholderText(/selecione a uf/i), { target: { value: 'MG' } });
    fireEvent.click(screen.getByRole('button', { name: /salvar configurações/i }));

    await waitFor(() => {
      expect(mockCriterioExecutar.mock.calls[0]?.[0]).toHaveProperty('regiaoUf', 'MG');
    });
  });

  it('falha parcial em critérios mostra mensagem de erro sem dizer "salvo"', async () => {
    mockCriterioExecutar.mockRejectedValue(new Error('Erro de rede'));
    mockPrefsExecutar.mockResolvedValue({});
    renderPage();

    fireEvent.click(screen.getByText(SEGMENTOS_ONBOARDING[0]!.nome));
    fireEvent.click(screen.getByRole('button', { name: /salvar configurações/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/critérios não salvos/i);
      expect(screen.queryByText(/configurações salvas/i)).toBeNull();
    });
  });

  it('botão salvar fica desabilitado quando palavras-chave está vazia', () => {
    renderPage();
    const btn = screen.getByRole('button', { name: /salvar configurações/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('botão salvar fica habilitado após selecionar chip (preenche palavras-chave)', () => {
    renderPage();
    fireEvent.click(screen.getByText(SEGMENTOS_ONBOARDING[0]!.nome));
    const btn = screen.getByRole('button', { name: /salvar configurações/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('POST de preferências envia DIARIA ao selecionar Digest diário', async () => {
    renderPage();
    fireEvent.click(screen.getByText(SEGMENTOS_ONBOARDING[0]!.nome));
    fireEvent.click(screen.getByLabelText(/digest diário/i));
    fireEvent.click(screen.getByRole('button', { name: /salvar configurações/i }));

    await waitFor(() => {
      expect(mockPrefsExecutar.mock.calls[0]?.[0]).toHaveProperty('frequencia', 'DIARIA');
    });
  });
});
