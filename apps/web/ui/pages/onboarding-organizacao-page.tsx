/**
 * Tela de onboarding pós-login para usuários autenticados sem organização (SEM_ORGANIZACAO).
 * RAD-286 · P-109 L3: o tenant nasce aqui, não no IdP.
 * Não coleta CPF de sócio (LGPD, RAD-272).
 * E-mail exibido como leitura apenas — vem do token JWT via AuthProvider, não é digitado.
 */
import { useEffect, useState } from 'react';
import { Button, Input } from '@/ui/components';
import { useAuth } from '@/ui/providers/auth-provider';
import { useProvisionarOrganizacao } from '@/ui/hooks/use-provisionar-organizacao';
import { validarCnpjDv } from '@/domain/cnpj';

function mascararCnpj(valor: string): string {
  const d = valor.replace(/\D/g, '').slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

interface OnboardingOrganizacaoPageProps {
  onProvisionado: () => void;
}

export function OnboardingOrganizacaoPage({ onProvisionado }: OnboardingOrganizacaoPageProps) {
  const { estado: authEstado } = useAuth();
  const emailExibido = authEstado.status === 'autenticado' ? authEstado.email : null;

  const [cnpj, setCnpj] = useState('');
  const [razaoSocial, setRazaoSocial] = useState('');
  const [erroCnpjLocal, setErroCnpjLocal] = useState<string | undefined>();
  const { estado, provisionar } = useProvisionarOrganizacao();

  useEffect(() => {
    if (estado.status === 'concluido') onProvisionado();
  }, [estado, onProvisionado]);

  function handleCnpjChange(e: React.ChangeEvent<HTMLInputElement>) {
    setCnpj(mascararCnpj(e.target.value));
    setErroCnpjLocal(undefined);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const raw = cnpj.replace(/\D/g, '');
    if (!validarCnpjDv(raw)) {
      setErroCnpjLocal('CNPJ inválido — verifique os dígitos.');
      return;
    }
    provisionar({ cnpj: raw, razaoSocial: razaoSocial.trim() });
  }

  const enviando = estado.status === 'enviando';
  const erroCnpj = erroCnpjLocal ?? (estado.status === 'erro' && estado.campo === 'cnpj' ? estado.mensagem : undefined);
  const erroGeral = estado.status === 'erro' && estado.campo === null ? estado.mensagem : undefined;

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--radar-color-bg-canvas)',
        padding: 'var(--radar-space-8)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 480,
          background: 'var(--radar-color-bg-surface)',
          border: '1px solid var(--radar-color-border-default)',
          borderRadius: 'var(--radar-radius-lg)',
          padding: 'var(--radar-space-8)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--radar-space-6)',
        }}
      >
        <div>
          <h1
            style={{
              margin: '0 0 var(--radar-space-2)',
              fontSize: 'var(--radar-fontSize-2xl)',
              fontFamily: 'var(--radar-fontFamily-sans)',
              color: 'var(--radar-color-text-default)',
            }}
          >
            Bem-vindo ao Radar
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: 'var(--radar-fontSize-sm)',
              fontFamily: 'var(--radar-fontFamily-sans)',
              color: 'var(--radar-color-text-muted)',
              lineHeight: 1.6,
            }}
          >
            Para começar, informe os dados da sua organização. Criaremos sua conta e você terá acesso imediato.
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--radar-space-4)' }}>
          {emailExibido && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--radar-space-1)' }}>
              <span
                style={{
                  fontSize: 'var(--radar-fontSize-sm)',
                  fontWeight: 500,
                  color: 'var(--radar-color-text-default)',
                  fontFamily: 'var(--radar-fontFamily-sans)',
                }}
              >
                E-mail
              </span>
              <div
                style={{
                  height: 40,
                  padding: '0 var(--radar-space-3)',
                  borderRadius: 'var(--radar-radius-md)',
                  border: '1px solid var(--radar-color-border-default)',
                  background: 'var(--radar-color-bg-subtle)',
                  color: 'var(--radar-color-text-muted)',
                  fontFamily: 'var(--radar-fontFamily-sans)',
                  fontSize: 'var(--radar-fontSize-sm)',
                  display: 'flex',
                  alignItems: 'center',
                  opacity: 0.8,
                }}
              >
                {emailExibido}
              </div>
              <span
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--radar-color-text-muted)',
                  fontFamily: 'var(--radar-fontFamily-sans)',
                }}
              >
                E-mail da sua conta — não pode ser alterado aqui.
              </span>
            </div>
          )}

          <Input
            label="CNPJ"
            placeholder="00.000.000/0000-00"
            value={cnpj}
            onChange={handleCnpjChange}
            inputMode="numeric"
            autoComplete="off"
            required
            disabled={enviando}
            {...(erroCnpj ? { error: erroCnpj, inputState: 'error' as const } : { inputState: 'default' as const })}
          />

          <Input
            label="Razão social"
            placeholder="Nome da empresa conforme CNPJ"
            value={razaoSocial}
            onChange={(e) => setRazaoSocial(e.target.value)}
            required
            disabled={enviando}
            maxLength={200}
          />

          {erroGeral && (
            <p
              style={{
                margin: 0,
                fontSize: 'var(--radar-fontSize-sm)',
                color: 'var(--radar-color-feedback-erro-fg)',
                fontFamily: 'var(--radar-fontFamily-sans)',
              }}
            >
              {erroGeral}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            disabled={enviando || !cnpj || !razaoSocial.trim()}
            style={{ width: '100%', marginTop: 'var(--radar-space-2)' }}
          >
            {enviando ? 'Criando organização...' : 'Criar organização'}
          </Button>
        </form>

        <p
          style={{
            margin: 0,
            fontSize: 'var(--radar-fontSize-xs)',
            color: 'var(--radar-color-text-muted)',
            fontFamily: 'var(--radar-fontFamily-sans)',
            lineHeight: 1.5,
          }}
        >
          Seus dados são usados exclusivamente para identificar sua organização na plataforma.
          Não coletamos dados pessoais de sócios (LGPD).
        </p>
      </div>
    </div>
  );
}
