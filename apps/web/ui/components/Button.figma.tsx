import figma from '@figma/code-connect';
import { Button } from './Button';

figma.connect(
  Button,
  'https://www.figma.com/design/SAbjXOQO4gFAH4syq7VdQf?node-id=34-4',
  {
    props: {
      variant: figma.enum('Variante', {
        primary:   'primary',
        secondary: 'secondary',
        ghost:     'ghost',
        danger:    'danger',
      }),
      size: figma.enum('Tamanho', {
        sm: 'sm',
        md: 'md',
        lg: 'lg',
      }),
      children: figma.string('Rótulo'),
    },
    example: ({ variant, size, children }) => (
      <Button variant={variant} size={size}>{children}</Button>
    ),
  },
);
