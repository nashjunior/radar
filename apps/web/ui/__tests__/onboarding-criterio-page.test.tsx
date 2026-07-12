/**
 * Testa o wizard de onboarding de critérios (RAD-312):
 * — Passo 1: seleção de segmento, pré-população de palavras-chave, botão Avançar
 * — Passo 2: edição de palavras-chave, link "sem filtro de UF", POST correto (sem segmento no body)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { OnboardingCriterioPage, SEGMENTOS_ONBOARDING } from '@/ui/pages/onboarding-criterio-page';

const mockSalvar = vi.fn();
let mockEstado: { status: string; mensagem?: string } = { status: 'idle' };

vi.mock('@/ui/hooks/use-definir-criterio', () => ({
  useDefinirCriterio: () => ({ estado: mockEstado, salvar: mockSalvar }),
}));

beforeEach(() => {
  mockSalvar.mockReset();
  mockEstado = { status: 'idle' };
});

function renderWizard(onConcluido = vi.fn()) {
  return render(<OnboardingCriterioPage onConcluido={onConcluido} />);
}

/** Navega até o passo 2 selecionando o segmento indicado e clicando em Avançar. */
async function chegarNoPasso2(segIdx = 0) {
  renderWizard();
  fireEvent.click(screen.getByText(SEGMENTOS_ONBOARDING[segIdx]!.nome));
  fireEvent.click(screen.getByRole('button', { name: /avançar →/i }));
  await waitFor(() => screen.getByText(/confirme seu primeiro critério/i));
}

describe('Passo 1 — seleção de segmento', () => {
  it('mostra os 6 cards de segmento', () => {
    renderWizard();
    for (const seg of SEGMENTOS_ONBOARDING) {
      expect(screen.getByText(seg.nome)).toBeTruthy();
    }
  });

  it('botão Avançar está desabilitado sem seleção', () => {
    renderWizard();
    const btn = screen.getByRole('button', { name: /avançar →/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('habilita Avançar após selecionar um segmento', () => {
    renderWizard();
    fireEvent.click(screen.getByText(SEGMENTOS_ONBOARDING[0]!.nome));
    const btn = screen.getByRole('button', { name: /avançar →/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('pré-popula as palavras-chave do segmento selecionado no passo 2', async () => {
    const seg = SEGMENTOS_ONBOARDING[0]!;
    await chegarNoPasso2(0);
    const inputs = screen.getAllByRole('textbox');
    const palavrasInput = inputs[0] as HTMLInputElement;
    expect(palavrasInput.value).toBe(seg.palavras.join(', '));
  });
});

describe('Passo 2 — confirmação de critério', () => {
  it('mostra o badge com o segmento selecionado', async () => {
    await chegarNoPasso2(0);
    expect(screen.getByText(SEGMENTOS_ONBOARDING[0]!.nome)).toBeTruthy();
  });

  it('"Sem filtro de UF" limpa o campo de UF', async () => {
    await chegarNoPasso2();
    const inputs = screen.getAllByRole('textbox');
    const ufInput = inputs[1] as HTMLInputElement;
    fireEvent.change(ufInput, { target: { value: 'SP' } });
    expect(ufInput.value).toBe('SP');

    fireEvent.click(screen.getByText(/sem filtro de uf/i));
    expect(ufInput.value).toBe('');
  });

  it('POST envia apenas palavrasChave (sem segmento, sem faixaValorCodigo)', async () => {
    const onConcluido = vi.fn();
    mockSalvar.mockResolvedValue(undefined);
    render(<OnboardingCriterioPage onConcluido={onConcluido} />);

    fireEvent.click(screen.getByText(SEGMENTOS_ONBOARDING[0]!.nome));
    fireEvent.click(screen.getByRole('button', { name: /avançar →/i }));
    await waitFor(() => screen.getByRole('button', { name: /criar meu radar/i }));

    fireEvent.click(screen.getByRole('button', { name: /criar meu radar/i }));

    await waitFor(() => {
      expect(mockSalvar).toHaveBeenCalledWith({
        palavrasChave: [...SEGMENTOS_ONBOARDING[0]!.palavras],
      });
      const call = mockSalvar.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(call).not.toHaveProperty('segmento');
      expect(call).not.toHaveProperty('faixaValorCodigo');
    });
  });

  it('POST envia regiaoUf quando UF é preenchida', async () => {
    mockSalvar.mockResolvedValue(undefined);
    render(<OnboardingCriterioPage onConcluido={vi.fn()} />);

    fireEvent.click(screen.getByText(SEGMENTOS_ONBOARDING[0]!.nome));
    fireEvent.click(screen.getByRole('button', { name: /avançar →/i }));
    await waitFor(() => screen.getAllByRole('textbox'));

    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[1]!, { target: { value: 'MG' } });
    fireEvent.click(screen.getByRole('button', { name: /criar meu radar/i }));

    await waitFor(() => {
      expect(mockSalvar.mock.calls[0]?.[0]).toHaveProperty('regiaoUf', 'MG');
    });
  });

  it('POST NÃO envia regiaoUf quando UF está vazia', async () => {
    mockSalvar.mockResolvedValue(undefined);
    render(<OnboardingCriterioPage onConcluido={vi.fn()} />);

    fireEvent.click(screen.getByText(SEGMENTOS_ONBOARDING[0]!.nome));
    fireEvent.click(screen.getByRole('button', { name: /avançar →/i }));
    await waitFor(() => screen.getByRole('button', { name: /criar meu radar/i }));

    fireEvent.click(screen.getByRole('button', { name: /criar meu radar/i }));

    await waitFor(() => {
      expect(mockSalvar.mock.calls[0]?.[0]).not.toHaveProperty('regiaoUf');
    });
  });

  it('Voltar retorna ao passo 1', async () => {
    await chegarNoPasso2(1);
    fireEvent.click(screen.getByText(/← voltar/i));
    expect(screen.getByRole('button', { name: /avançar →/i })).toBeTruthy();
    expect(screen.getByText(/qual é o segmento/i)).toBeTruthy();
  });

  it('chama onConcluido após salvar com sucesso', async () => {
    const onConcluido = vi.fn();
    mockSalvar.mockResolvedValue(undefined);
    render(<OnboardingCriterioPage onConcluido={onConcluido} />);

    fireEvent.click(screen.getByText(SEGMENTOS_ONBOARDING[0]!.nome));
    fireEvent.click(screen.getByRole('button', { name: /avançar →/i }));
    await waitFor(() => screen.getByRole('button', { name: /criar meu radar/i }));
    fireEvent.click(screen.getByRole('button', { name: /criar meu radar/i }));

    await waitFor(() => expect(onConcluido).toHaveBeenCalled());
  });
});
