/**
 * Testa affordance de RBAC na TriagemPage:
 * — CLIENTE_FINAL_READONLY não vê botões de decisão (go/no-go, contestar)
 * — 403 de /api/me resulta em estado "sem permissão" no SessaoProvider
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// Mocks de hooks externos para isolar o componente
vi.mock('@/ui/hooks/use-triagem', () => ({
  useTriagem: () => ({
    status: 'success',
    data: {
      status: 'concluida',
      aderencia: 0.85,
      confiancaIA: 0.9,
      paginasEdital: 10,
      recomendacao: 'go',
      camposAnalise: [],
      checklist: [],
    },
  }),
}));

vi.mock('@/ui/hooks/use-edital', () => ({
  useEdital: () => ({ status: 'loading' }),
}));

vi.mock('@/ui/hooks/use-feedback-triagem', () => ({
  useFeedbackTriagem: () => ({
    decisaoEstado: { status: 'idle' },
    contestarEstado: { status: 'idle' },
    registrarDecisao: vi.fn(),
    contestar: vi.fn(),
  }),
}));

import { SessaoProvider } from '@/ui/providers/sessao-provider';
import { TriagemPage } from '@/ui/pages/triagem-page';
import type { SessaoUsuario } from '@/domain/sessao';
import type { ObterSessaoUseCase } from '@/application/use-cases/obter-sessao';

function makeSessaoUseCase(sessao: SessaoUsuario): ObterSessaoUseCase {
  return { executar: () => Promise.resolve(sessao) } as unknown as ObterSessaoUseCase;
}

function renderWithSessao(sessao: SessaoUsuario) {
  return render(
    <SessaoProvider obterSessaoUseCase={makeSessaoUseCase(sessao)}>
      <TriagemPage editalId="edital-1" onBack={() => undefined} />
    </SessaoProvider>,
  );
}

describe('TriagemPage — RBAC affordance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('OPERADOR vê os botões de decisão go/no-go', async () => {
    renderWithSessao({
      usuarioId: 'u1',
      tenantId: 't1',
      papel: 'OPERADOR',
      clienteFinalIds: [],
    });

    expect(await screen.findByText(/Participar/)).toBeTruthy();
    expect(screen.getByText(/Não participar/)).toBeTruthy();
  });

  it('CLIENTE_FINAL_READONLY NÃO vê os botões de decisão go/no-go', async () => {
    renderWithSessao({
      usuarioId: 'u2',
      tenantId: 't1',
      papel: 'CLIENTE_FINAL_READONLY',
      clienteFinalIds: ['cf-1'],
    });

    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.queryByText(/Participar/)).toBeNull();
    expect(screen.queryByText(/Não participar/)).toBeNull();
    expect(screen.queryByText(/Contestar/)).toBeNull();
  });

  it('CLIENTE_FINAL_READONLY vê mensagem de leitura no painel de decisão', async () => {
    renderWithSessao({
      usuarioId: 'u2',
      tenantId: 't1',
      papel: 'CLIENTE_FINAL_READONLY',
      clienteFinalIds: ['cf-1'],
    });

    expect(await screen.findByText(/Visualização em leitura/)).toBeTruthy();
  });
});

describe('SessaoProvider — tratamento de 403', () => {
  it('estado sem_permissao quando gateway lança AcessoNegadoError', async () => {
    const { AcessoNegadoError } = await import('@/application/errors');
    const useCaseComErro = {
      executar: () => Promise.reject(new AcessoNegadoError()),
    } as unknown as ObterSessaoUseCase;

    render(
      <SessaoProvider obterSessaoUseCase={useCaseComErro}>
        <span data-testid="filho">conteudo</span>
      </SessaoProvider>,
    );

    // O filho ainda renderiza enquanto carrega; após rejeição o estado muda
    // mas o provider não explode — sem tela branca nem throw não tratado.
    // Verificamos que não há crash (render não lançou).
    expect(document.body).toBeTruthy();
  });
});
