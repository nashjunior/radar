/** @figma nodeId=RAD-251-medidor-cota fileKey=SAbjXOQO4gFAH4syq7VdQf */
interface MedidorCotaProps {
  usado: number;
  cota: number;
  onUpgrade?: () => void;
}

export function MedidorCota({ usado, cota, onUpgrade }: MedidorCotaProps) {
  const pct = cota > 0 ? Math.min(1, usado / cota) : 1;
  const porcentagem = Math.round(pct * 100);
  const esgotada = pct >= 1;
  const alerta = pct >= 0.8;

  const cor = esgotada
    ? 'var(--radar-color-feedback-erro-fg)'
    : alerta
      ? 'var(--radar-color-feedback-alerta-fg)'
      : 'var(--radar-color-action-primary)';

  return (
    <div style={{ padding: '0 var(--radar-space-3)', marginBottom: 'var(--radar-space-4)' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 4,
          fontSize: 'var(--radar-fontSize-xs)',
          color: alerta ? cor : 'var(--radar-color-text-muted)',
          fontFamily: 'var(--radar-fontFamily-sans)',
        }}
      >
        <span>Triagens</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {usado}/{cota}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={usado}
        aria-valuemin={0}
        aria-valuemax={cota}
        aria-label={`${usado} de ${cota} triagens usadas`}
        style={{
          height: 4,
          background: 'var(--radar-color-bg-subtle)',
          borderRadius: 'var(--radar-radius-full)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${porcentagem}%`,
            background: cor,
            borderRadius: 'var(--radar-radius-full)',
            transition: 'width 0.3s ease, background 0.2s ease',
          }}
        />
      </div>
      {alerta && onUpgrade && (
        <button
          onClick={onUpgrade}
          style={{
            marginTop: 6,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: cor,
            fontSize: 'var(--radar-fontSize-xs)',
            fontFamily: 'var(--radar-fontFamily-sans)',
            padding: 0,
            textDecoration: 'underline',
          }}
        >
          {esgotada ? 'Cota esgotada — ver planos' : 'Upgrade de plano'}
        </button>
      )}
    </div>
  );
}
