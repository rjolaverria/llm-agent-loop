import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Test files simulate loosely-typed provider SDK payloads, where `any` is a
  // pragmatic simplification. Keep the rule strict for the library source.
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  // Disable ESLint rules that conflict with Prettier's formatting.
  prettierConfig,
);
