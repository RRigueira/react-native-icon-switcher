import { fixupConfigRules } from '@eslint/compat';
import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import prettier from 'eslint-plugin-prettier';
import { defineConfig } from 'eslint/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default defineConfig([
  {
    extends: fixupConfigRules(compat.extends('@react-native', 'prettier')),
    plugins: { prettier },
    rules: {
      'react/react-in-jsx-scope': 'off',
      'prettier/prettier': 'error',
    },
  },
  {
    files: ['jest/**/*.{js,cjs}'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        module: 'writable',
        require: 'readonly',
        exports: 'writable',
      },
    },
    rules: {
      'no-undef': 'off',
    },
  },
  {
    // The config plugin and sync CLI run in Node at build time.
    files: ['plugin/src/**/*.ts'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
      },
    },
  },
  {
    ignores: [
      'node_modules/',
      'lib/',
      'plugin/build/',
      'coverage/',
      'android/build/',
      'example/ios/',
      'example/android/',
      'example/dist/',
      'example-bare/ios/',
      'example-bare/android/',
    ],
  },
]);
