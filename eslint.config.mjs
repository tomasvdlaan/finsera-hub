import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Module boundary rules (spec §2). The full dependency graph is enforced by
    // dependency-cruiser (`pnpm boundaries`); this catches the obvious cases in-editor.
    files: ['apps/api/src/modules/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/modules/*/*'],
              message:
                'Modules must not import from other modules. Use the other module’s exported service token (declared in its manifest) or core services.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/api/src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/modules/**'],
              message:
                'Core must never import from modules — the core learns about modules only through manifests at bootstrap.',
            },
          ],
        },
      ],
    },
  },
);
