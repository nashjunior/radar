import { describe, expect, it } from 'vitest';
import { traduzirEventoAsaas } from '../../infra/adapters/asaas-webhook-translator.js';

describe('traduzirEventoAsaas — tipo do provedor morre no adapter (P-107 (5)/(6))', () => {
  it('PAYMENT_CONFIRMED com payment.subscription ⇒ PagamentoConfirmado', () => {
    const comando = traduzirEventoAsaas({
      id: 'evt_1',
      event: 'PAYMENT_CONFIRMED',
      payment: { id: 'pay_1', subscription: 'sub_1', status: 'CONFIRMED' },
    });
    expect(comando).toEqual({ tipo: 'PagamentoConfirmado', eventoExternoId: 'evt_1', assinaturaExternaId: 'sub_1' });
  });

  it('PAYMENT_RECEIVED também vira PagamentoConfirmado', () => {
    const comando = traduzirEventoAsaas({
      id: 'evt_2',
      event: 'PAYMENT_RECEIVED',
      payment: { subscription: 'sub_2' },
    });
    expect(comando?.tipo).toBe('PagamentoConfirmado');
  });

  it('PAYMENT_OVERDUE ⇒ PagamentoFalhou', () => {
    const comando = traduzirEventoAsaas({
      id: 'evt_3',
      event: 'PAYMENT_OVERDUE',
      payment: { subscription: 'sub_3' },
    });
    expect(comando).toEqual({ tipo: 'PagamentoFalhou', eventoExternoId: 'evt_3', assinaturaExternaId: 'sub_3' });
  });

  it('SUBSCRIPTION_DELETED ⇒ AssinaturaCancelada, lendo subscription de nível raiz', () => {
    const comando = traduzirEventoAsaas({
      id: 'evt_4',
      event: 'SUBSCRIPTION_DELETED',
      subscription: 'sub_4',
    });
    expect(comando).toEqual({ tipo: 'AssinaturaCancelada', eventoExternoId: 'evt_4', assinaturaExternaId: 'sub_4' });
  });

  it('evento fora do catálogo ⇒ null, sem lançar', () => {
    expect(traduzirEventoAsaas({ id: 'evt_5', event: 'PAYMENT_CREATED', payment: { subscription: 'sub_5' } })).toBeNull();
  });

  it('payload sem id ⇒ null', () => {
    expect(traduzirEventoAsaas({ event: 'PAYMENT_CONFIRMED', payment: { subscription: 'sub_6' } })).toBeNull();
  });

  it('payload sem subscription (nem raiz nem payment) ⇒ null', () => {
    expect(traduzirEventoAsaas({ id: 'evt_7', event: 'PAYMENT_CONFIRMED', payment: {} })).toBeNull();
  });

  it('payload não-objeto (payload sem autoridade) ⇒ null, nunca lança', () => {
    expect(traduzirEventoAsaas(null)).toBeNull();
    expect(traduzirEventoAsaas('string maliciosa')).toBeNull();
    expect(traduzirEventoAsaas(42)).toBeNull();
    expect(traduzirEventoAsaas(['array'])).toBeNull();
  });
});
