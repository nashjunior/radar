/** @figma nodeId=34:4 fileKey=SAbjXOQO4gFAH4syq7VdQf */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

const BASE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--radar-space-2)',
  fontFamily: 'var(--radar-font-sans)',
  fontWeight: 500,
  borderRadius: 'var(--radar-radius-md)',
  border: '1px solid transparent',
  cursor: 'pointer',
  transition: 'background-color 0.15s, border-color 0.15s, opacity 0.15s',
  whiteSpace: 'nowrap',
};

const SIZE_STYLES: Record<Size, React.CSSProperties> = {
  sm: { fontSize: '0.75rem', padding: '4px 12px', height: 32 },
  md: { fontSize: 'var(--radar-font-size-sm)', padding: '8px 16px', height: 40 },
  lg: { fontSize: 'var(--radar-font-size-base)', padding: '12px 24px', height: 48 },
};

const VARIANT_STYLES: Record<Variant, React.CSSProperties> = {
  primary: {
    background: 'var(--radar-color-action-primary)',
    color: 'var(--radar-color-text-onPrimary)',
    borderColor: 'var(--radar-color-action-primary)',
  },
  secondary: {
    background: 'transparent',
    color: 'var(--radar-color-action-primary)',
    borderColor: 'var(--radar-color-action-primary)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--radar-color-text-default)',
    borderColor: 'transparent',
  },
  danger: {
    background: 'var(--radar-color-status-nogo)',
    color: 'var(--radar-color-text-onPrimary)',
    borderColor: 'var(--radar-color-status-nogo)',
  },
};

export function Button({ variant = 'primary', size = 'md', style, disabled, children, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled}
      style={{
        ...BASE,
        ...SIZE_STYLES[size],
        ...VARIANT_STYLES[variant],
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
    >
      {children}
    </button>
  );
}
