// ESLint: findet vor allem Tippfehler bei Namen (no-undef) und doppelte Methoden in der aufgeteilten Sim-Klasse.
const globals = require('globals');

module.exports = [
  { ignores: ['js/peerjs.min.js', 'node_modules/'] },
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser, module: 'readonly', Peer: 'readonly',
        // von den einzelnen Skripten auf window abgelegt
        SHARED: 'readonly', SimBase: 'readonly', StahlSim: 'readonly', NET: 'readonly', RELAY: 'readonly', SND: 'readonly', TANKART: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-redeclare': 'error',
      'no-dupe-class-members': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
    },
  },
  {
    files: ['test/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node } },
  },
];
