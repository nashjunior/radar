/** @figma fileKey=SAbjXOQO4gFAH4syq7VdQf */
import type { TextareaHTMLAttributes } from 'react';

type InputState = 'default' | 'focus' | 'error' | 'disabled';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  inputState?: InputState;
}

export function Textarea({ label, hint, error, inputState = 'default', style, ...props }: TextareaProps) {
  const hasError = inputState === 'error' || !!error;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--radar-space-1)' }}>
      {label && (
        <label style={{ fontSize: 'var(--radar-font-size-sm)', fontWeight: 500, color: 'var(--radar-color-text-default)' }}>
          {label}
        </label>
      )}
      <textarea
        {...props}
        disabled={inputState === 'disabled' || props.disabled}
        style={{
          height: 100,
          padding: 'var(--radar-space-2) var(--radar-space-3)',
          borderRadius: 'var(--radar-radius-md)',
          border: `1px solid ${hasError ? 'var(--radar-color-text-critical)' : 'var(--radar-color-border-default)'}`,
          background: inputState === 'disabled' ? 'var(--radar-color-bg-subtle)' : 'var(--radar-color-bg-surface)',
          color: 'var(--radar-color-text-default)',
          fontFamily: 'var(--radar-font-sans)',
          fontSize: 'var(--radar-font-size-sm)',
          outline: 'none',
          width: '100%',
          boxSizing: 'border-box',
          resize: 'vertical',
          opacity: inputState === 'disabled' ? 0.6 : 1,
          lineHeight: 1.5,
          ...style,
        }}
      />
      {(hint || error) && (
        <span style={{ fontSize: '0.75rem', color: hasError ? 'var(--radar-color-text-critical)' : 'var(--radar-color-text-muted)' }}>
          {error ?? hint}
        </span>
      )}
    </div>
  );
}
