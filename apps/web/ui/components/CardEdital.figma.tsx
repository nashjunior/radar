import figma from '@figma/code-connect';
import { CardEdital } from './CardEdital';

figma.connect(
  CardEdital,
  'https://www.figma.com/design/SAbjXOQO4gFAH4syq7VdQf?node-id=8-49',
  {
    props: {
      status: figma.enum('Estado', {
        novo:     'novo',
        hoje:     'hoje',
        pncp:     'pncp',
        revisado: 'revisado',
      }),
    },
    example: ({ status }) => (
      <CardEdital
        data={{
          id: 'edital-1',
          modalidade: 'Pregão Eletrônico',
          titulo: 'Aquisição de equipamentos de informática',
          orgao: 'Min. da Educação',
          valor: 'R$ 85.000,00',
          prazo: '10/07 às 14h',
          aderencia: 92,
          status,
        }}
      />
    ),
  },
);
