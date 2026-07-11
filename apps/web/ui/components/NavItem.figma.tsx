import figma from '@figma/code-connect';
import { NavItem } from './NavItem';

figma.connect(
  NavItem,
  'https://www.figma.com/design/SAbjXOQO4gFAH4syq7VdQf?node-id=42-231',
  {
    props: {
      label:  figma.string('Rótulo'),
      active: figma.boolean('Ativo'),
    },
    example: ({ label, active }) => (
      <NavItem label={label} active={active} />
    ),
  },
);
