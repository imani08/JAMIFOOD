import { createRequire } from 'node:module';
import { defineConfig, globalIgnores } from 'eslint/config';

const webRequire = createRequire(new URL('./apps/web/package.json', import.meta.url));
const nextPlugin = webRequire('@next/eslint-plugin-next');
const typescriptParser = webRequire('@typescript-eslint/parser');

export default defineConfig([
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    plugins: { '@next/next': nextPlugin },
    rules: nextPlugin.configs.recommended.rules,
  },
  globalIgnores([
    '**/.next/**',
    '**/dist/**',
    '**/node_modules/**',
    '**/*.tsbuildinfo',
    '**/*.backup.ts',
    '**/*.backup.tsx',
    '**/*.before-fix.tsx',
  ]),
]);
