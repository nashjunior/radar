import figma from '@figma/code-connect';
import { StatCard } from './StatCard';

figma.connect(
  StatCard,
  'https://www.figma.com/design/SAbjXOQO4gFAH4syq7VdQf?node-id=39-90',
  {
    props: {
      label:         figma.string('Rótulo'),
      value:         figma.string('Valor'),
      trend:         figma.string('Tendência'),
      trendPositive: figma.boolean('Tendência positiva'),
    },
    example: ({ label, value, trend, trendPositive }) => (
      <StatCard label={label} value={value} trend={trend} trendPositive={trendPositive} />
    ),
  },
);
