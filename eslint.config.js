import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '.e2e-home/**', 'playwright-report/**', 'test-results/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            'eslint.config.js',
            'playwright.config.ts',
            'scripts/*.mjs',
            'e2e/*.ts',
            'e2e/*.mjs',
            'server/drizzle.config.ts',
            'server/test/*.mjs',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    rules: {
      // tight data plumbing around sqlite rows & canvas buffers makes these pragmatic
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-confusing-void-expression': 'off',
    },
  },
  {
    files: ['**/*.{js,mjs}'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', fetch: 'readonly', setTimeout: 'readonly' },
    },
  },
  // config/test plumbing: lint without type information (outside the workspaces' tsconfigs)
  {
    files: ['playwright.config.ts', 'e2e/**/*.ts', 'server/drizzle.config.ts'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
)
