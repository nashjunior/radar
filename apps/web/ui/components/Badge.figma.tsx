import figma from '@figma/code-connect';
import { Badge } from './Badge';

figma.connect(
  Badge,
  'https://www.figma.com/design/SAbjXOQO4gFAH4syq7VdQf?node-id=40-56',
  {
    props: {
      type: figma.enum('Tipo', {
        info:    'info',
        sucesso: 'sucesso',
        alerta:  'alerta',
        erro:    'erro',
        neutro:  'neutro',
      }),
      size: figma.enum('Tamanho', {
        sm: 'sm',
        md: 'md',
      }),
      children: figma.string('Rótulo'),
    },
    example: ({ type, size, children }) => (
      <Badge type={type} size={size}>{children}</Badge>
    ),
  },
);
