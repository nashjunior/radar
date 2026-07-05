import StyleDictionary from 'style-dictionary';

/**
 * Formato customizado para style-dictionary v4 com suporte a tokens temáticos.
 *
 * Em v4, referências `{color.blue.100}` dentro de objetos `{light, dark}` são
 * resolvidas automaticamente — `token.$value` já contém o valor final (hex, px, etc.).
 *
 * Dois casos:
 *   1. `$value: { light, dark }` — token temático → :root com valor light,
 *      [data-theme='dark'] com valor dark.
 *   2. `$value: <primitivo>` — token plano → apenas :root.
 */
StyleDictionary.registerFormat({
  name: 'css/themed',
  format: ({ dictionary, platform }) => {
    const pfx = platform.prefix ? `${platform.prefix}-` : '';
    const rootLines = [];
    const darkLines = [];

    for (const token of dictionary.allTokens) {
      const cssVar = `--${pfx}${token.path.join('-')}`;
      const val = token.$value; // v4: valor resolvido (inclui refs aninhadas em {light,dark})

      if (val !== null && val !== undefined && typeof val === 'object' && 'light' in val && 'dark' in val) {
        rootLines.push(`  ${cssVar}: ${val.light};`);
        darkLines.push(`  ${cssVar}: ${val.dark};`);
      } else {
        rootLines.push(`  ${cssVar}: ${val};`);
      }
    }

    const blocks = [
      '/**\n * Do not edit directly, this file was auto-generated.\n */',
      ':root {',
      rootLines.join('\n'),
      '}',
    ];

    if (darkLines.length > 0) {
      blocks.push('', "[data-theme='dark'] {", darkLines.join('\n'), '}');
    }

    return blocks.join('\n') + '\n';
  },
});

/** @type {import('style-dictionary').Config} */
export default {
  source: ['tokens/**/*.json'],
  platforms: {
    css: {
      transformGroup: 'css',
      prefix: 'radar',
      buildPath: 'dist/css/',
      files: [
        {
          destination: 'tokens.css',
          format: 'css/themed',
        },
      ],
    },
    js: {
      transformGroup: 'js',
      buildPath: 'dist/js/',
      files: [
        {
          destination: 'tokens.mjs',
          format: 'javascript/esm',
        },
        {
          destination: 'tokens.d.ts',
          format: 'typescript/es6-declarations',
        },
      ],
    },
    scss: {
      transformGroup: 'scss',
      prefix: 'radar',
      buildPath: 'dist/scss/',
      files: [
        {
          destination: '_tokens.scss',
          format: 'scss/variables',
          options: { outputReferences: true },
        },
      ],
    },
  },
};
