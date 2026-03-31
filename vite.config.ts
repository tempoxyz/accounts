import { defineConfig } from 'vp'

export default defineConfig({
  devtools: {
    enabled: true,
  },
  lint: {
    ignorePatterns: ['package.json', 'dialog', 'embed/**'],
  },
  fmt: {
    semi: false,
    singleQuote: true,
    trailingComma: 'all',
    tabWidth: 2,
    printWidth: 100,
    ignorePatterns: ['package.json', 'dialog', 'embed/**'],
    experimentalSortImports: {
      groups: [
        ['value-builtin', 'value-external', 'type-import', 'value-internal', 'type-internal'],
        [
          'value-parent',
          'value-sibling',
          'value-index',
          'type-parent',
          'type-sibling',
          'type-index',
        ],
        'unknown',
      ],
    },
  },
})
