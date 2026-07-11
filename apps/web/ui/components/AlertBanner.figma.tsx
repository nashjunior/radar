import figma from '@figma/code-connect';
import { AlertBanner } from './AlertBanner';

figma.connect(
  AlertBanner,
  'https://www.figma.com/design/SAbjXOQO4gFAH4syq7VdQf?node-id=40-46',
  {
    props: {
      type: figma.enum('Tipo', {
        info:    'info',
        sucesso: 'sucesso',
        alerta:  'alerta',
        erro:    'erro',
      }),
      title:    figma.string('Título'),
      children: figma.string('Mensagem'),
    },
    example: ({ type, title, children }) => (
      <AlertBanner type={type} title={title}>{children}</AlertBanner>
    ),
  },
);
