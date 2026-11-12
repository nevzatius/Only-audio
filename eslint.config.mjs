// @eslint/js kurulu değil (yeni paket eklememek için); temel kurallar elle listelendi.
const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
  'no-redeclare': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-unreachable': 'error',
  'no-const-assign': 'error',
  'no-cond-assign': 'error',
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-fallthrough': 'error',
  'no-self-assign': 'error',
  'no-unsafe-finally': 'error',
  'no-prototype-builtins': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'prefer-const': 'error',
  'no-var': 'error',
};

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  location: 'readonly',
  sessionStorage: 'readonly',
  localStorage: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  MutationObserver: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  HTMLElement: 'readonly',
  HTMLVideoElement: 'readonly',
  Event: 'readonly',
  CustomEvent: 'readonly',
  globalThis: 'readonly',
  chrome: 'readonly',
};

export default [
  { ignores: ['node_modules/**', 'test-results/**', 'playwright-report/**'] },
  { rules },
  {
    files: ['extension/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'script',
      globals: browserGlobals,
    },
  },
  {
    // ES modülü olarak yüklenenler: service worker, paylaşılan kod, popup.
    files: [
      'extension/background/**/*.js',
      'extension/shared/**/*.js',
      'extension/popup/**/*.js',
    ],
    languageOptions: { sourceType: 'module' },
  },
];
