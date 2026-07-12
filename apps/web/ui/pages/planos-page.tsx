/** @figma nodeId=RAD-251-planos fileKey=SAbjXOQO4gFAH4syq7VdQf */
import { Button } from '@/ui/components';
import { useIniciarCheckout } from '@/ui/hooks/use-iniciar-checkout';

interface PlanosPageProps {
  onBack: () => void;
}

interface Plano {
  id: string;
  nome: string;
  descricao: string;
  cotaMensal: number;
  destaque?: boolean;
}

const PLANOS: Plano[] = [
  {
    id: 'starter',
    nome: 'Starter',
    descricao: 'Ideal para empresas iniciando o monitoramento de licitações.',
    cotaMensal: 10,
  },
  {
    id: 'profissional',
    nome: 'Profissional',
    descricao: 'Para equipes que participam ativamente de licitações.',
    cotaMensal: 50,
    destaque: true,
  },
  {
    id: 'enterprise',
    nome: 'Enterprise',
    descricao: 'Consultorias e órgãos com alto volume de análises.',
    cotaMensal: 200,
  },
];

export function PlanosPage({ onBack }: PlanosPageProps) {
  const { estado, iniciar } = useIniciarCheckout();
  const carregando = estado.status === 'loading';

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--radar-space-4)', marginBottom: 'var(--radar-space-8)' }}>
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--radar-color-action-primary)',
            fontFamily: 'var(--radar-fontFamily-sans)',
            fontSize: 'var(--radar-fontSize-sm)',
            padding: 0,
          }}
        >
          ← Voltar
        </button>
        <h1 style={{ margin: 0, fontSize: 'var(--radar-fontSize-2xl)', color: 'var(--radar-color-text-default)', fontFamily: 'var(--radar-fontFamily-sans)' }}>
          Planos
        </h1>
      </div>

      <p style={{ marginBottom: 'var(--radar-space-8)', color: 'var(--radar-color-text-muted)', fontFamily: 'var(--radar-fontFamily-sans)', fontSize: 'var(--radar-fontSize-base)' }}>
        Trial de 14 dias sem cartão. Após o trial, escolha o plano que melhor se encaixa na sua operação.
        O checkout é hospedado pelo gateway de pagamento — os dados do seu cartão nunca passam pelo Radar.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--radar-space-6)' }}>
        {PLANOS.map((plano) => (
          <div
            key={plano.id}
            style={{
              background: 'var(--radar-color-bg-surface)',
              border: plano.destaque
                ? `2px solid var(--radar-color-action-primary)`
                : '1px solid var(--radar-color-border-default)',
              borderRadius: 'var(--radar-radius-lg)',
              padding: 'var(--radar-space-6)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--radar-space-4)',
            }}
          >
            {plano.destaque && (
              <span
                style={{
                  alignSelf: 'flex-start',
                  background: 'var(--radar-color-action-primary)',
                  color: 'var(--radar-color-text-onPrimary)',
                  fontSize: 'var(--radar-fontSize-xs)',
                  fontFamily: 'var(--radar-fontFamily-sans)',
                  fontWeight: 600,
                  padding: '2px var(--radar-space-2)',
                  borderRadius: 'var(--radar-radius-sm)',
                }}
              >
                Recomendado
              </span>
            )}
            <div>
              <h2 style={{ margin: '0 0 var(--radar-space-2)', fontSize: 'var(--radar-fontSize-lg)', fontFamily: 'var(--radar-fontFamily-sans)', color: 'var(--radar-color-text-default)' }}>
                {plano.nome}
              </h2>
              <p style={{ margin: 0, color: 'var(--radar-color-text-muted)', fontFamily: 'var(--radar-fontFamily-sans)', fontSize: 'var(--radar-fontSize-sm)', lineHeight: 1.5 }}>
                {plano.descricao}
              </p>
            </div>
            <div style={{ color: 'var(--radar-color-text-muted)', fontFamily: 'var(--radar-fontFamily-sans)', fontSize: 'var(--radar-fontSize-sm)' }}>
              {plano.cotaMensal} triagens/mês
            </div>
            <Button
              variant={plano.destaque ? 'primary' : 'secondary'}
              disabled={carregando}
              onClick={iniciar}
              style={{ width: '100%' }}
            >
              {carregando ? 'Redirecionando...' : 'Assinar'}
            </Button>
          </div>
        ))}
      </div>

      {estado.status === 'erro' && (
        <p style={{ marginTop: 'var(--radar-space-4)', color: 'var(--radar-color-feedback-erro-fg)', fontFamily: 'var(--radar-fontFamily-sans)', fontSize: 'var(--radar-fontSize-sm)' }}>
          {estado.mensagem}
        </p>
      )}

      <p style={{ marginTop: 'var(--radar-space-8)', color: 'var(--radar-color-text-muted)', fontFamily: 'var(--radar-fontFamily-sans)', fontSize: 'var(--radar-fontSize-xs)' }}>
        Aceitamos cartão, PIX e boleto. PIX é confirmado em segundos; boleto pode levar até 3 dias úteis.
        O acesso ao plano só é liberado após a confirmação do pagamento pelo gateway.
      </p>
    </div>
  );
}
