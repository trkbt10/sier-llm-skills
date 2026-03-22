/**
 * @file ESLint flat config for the repository.
 */

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import jsdocPlugin from "eslint-plugin-jsdoc";
import eslintCommentsPlugin from "@eslint-community/eslint-plugin-eslint-comments";
import prettierConfig from "eslint-config-prettier";
// Local plugin and modularized rule groups
import customPlugin from "./eslint/plugins/custom/index.js";
import rulesJSDoc from "./eslint/rules/rules-jsdoc.js";
import rulesRestrictedSyntax from "./eslint/rules/rules-restricted-syntax.js";
import rulesCurly from "./eslint/rules/rules-curly.js";
import rulesNoTestImports from "./eslint/rules/rules-no-test-imports.js";
import rulesNoMocks from "./eslint/rules/rules-no-mocks.js";

export default tseslint.config(
  // Ignore patterns
  { ignores: ["node_modules/**", "dist/**", "build/**", "debug/**", "*.config.ts"] },

  // JS/TS recommended sets (Flat-compatible)
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended, prettierConfig],
  },

  // Project common rules
  {
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      import: importPlugin,
      jsdoc: jsdocPlugin,
      "@eslint-community/eslint-comments": eslintCommentsPlugin,
      "@typescript-eslint": tseslint.plugin,
      custom: customPlugin,
    },
    settings: {
      jsdoc: { mode: "typescript" },
    },
    rules: {
      "custom/ternary-length": "error",
      "custom/prefer-node-protocol": "error",
      "custom/no-as-outside-guard": "error",
      "custom/no-nested-try": "error",
      "custom/no-iife-in-anonymous": "error",
      "custom/no-cross-boundary-export": "error",
      "custom/no-reexport-outside-entry": "error",
      "custom/enforce-index-import": "error",
      // Spread from modular groups
      ...rulesJSDoc,
      ...rulesRestrictedSyntax,
      // /* 3. Prohibit relative parent import (../../ etc.) */
      // "import/no-relative-parent-imports": "error",
      ...rulesCurly,
      ...rulesNoTestImports,
      ...rulesNoMocks,
    },
  },

  // Tests-only: allow global test APIs so imports are unnecessary
  {
    files: [
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*.test.ts",
      "**/*.test.tsx",
      "spec/**/*.ts",
      "spec/**/*.tsx",
      "spec/**/*.js",
      "spec/**/*.jsx",
    ],
    languageOptions: {
      globals: {
        // Core
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        // Lifecycle
        beforeAll: "readonly",
        afterAll: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        // Suites/bench (Vitest-compatible)
        suite: "readonly",
        bench: "readonly",
      },
    },
  },

  // Internal ESLint plugin/rules: don't enforce custom rules on their own source
  {
    files: ["eslint/**"],
    rules: {
      "custom/ternary-length": "off",
      "custom/no-as-outside-guard": "off",
      "custom/no-nested-try": "off",
      "custom/no-iife-in-anonymous": "off",
      "custom/no-cross-boundary-export": "off",
      "custom/no-reexport-outside-entry": "off",
      "custom/enforce-index-import": "off",
    },
  },
);
