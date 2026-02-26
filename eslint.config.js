const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['node_modules/**', '.wwebjs_auth/**', '.wwebjs_cache/**'],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      'no-redeclare': ['error', { builtinGlobals: false }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
];
