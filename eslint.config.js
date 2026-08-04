// eslint.config.js
import { FlatCompat } from "@eslint/eslintrc";
import globals from "globals";

// ⚠️ нужно вызвать через new
const compat = new FlatCompat({
  baseDirectory: process.cwd(),
  recommendedConfig: true,
});

export default [
  ...compat.extends("eslint:recommended"),
  ...compat.extends("plugin:@typescript-eslint/recommended"),
  ...compat.extends("plugin:import/errors"),
  ...compat.extends("plugin:import/warnings"),
  ...compat.extends("plugin:import/typescript"),

  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      "no-trailing-spaces": "error",
      // ESLint core no-unused-vars misclassifies TS type imports and
      // interface parameters as unused. Rely on the TS-aware variant
      // below instead, which understands TS type positions.
      "no-unused-vars": "off",
      // Allow unused vars starting with _ (matches frontend convention:
      // callback params in types, destructuring drops, catch-block errs).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "max-len": [
        "error",
        {
          code: 130,
          ignoreComments: true,
          ignoreStrings: false,
          ignoreTemplateLiterals: false,
          ignoreUrls: true,
        },
      ],
      quotes: ["error", "single", { allowTemplateLiterals: true }],
      semi: ["error", "always"],
      "comma-dangle": ["error", "always-multiline"],
      "import/no-unresolved": [
        "error",
        {
          ignore: ["\\.js$"],
        },
      ],
      "import/extensions": [
        "error",
        "ignorePackages",
        {
          js: "never",
          jsx: "never",
          ts: "never",
          tsx: "never",
        },
      ],
      "import/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling"],
          pathGroups: [
            { pattern: "@/**", group: "internal", position: "after" },
          ],
          pathGroupsExcludedImportTypes: ["builtin"],
          "newlines-between": "never",
        },
      ],
    },
    settings: {
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
          project: "./tsconfig.json",
        },
        node: {
          extensions: [".js", ".jsx", ".ts", ".tsx"],
        },
      },
    },
  },
  {
    files: ["**/*.ts"],
    rules: {
      "no-trailing-spaces": "error",
      quotes: ["error", "single", { allowTemplateLiterals: true }],
      semi: ["error", "always"],
      indent: [
        "error",
        2,
        {
          SwitchCase: 1,
          VariableDeclarator: 1,
          outerIIFEBody: 1,
          FunctionDeclaration: { parameters: 1, body: 1 },
          FunctionExpression: { parameters: 1, body: 1 },
          CallExpression: { arguments: 1 },
          ArrayExpression: 1,
          ObjectExpression: 1,
          ImportDeclaration: 1,
          flatTernaryExpressions: false,
          ignoreComments: false,
          ignoredNodes: ["PropertyDefinition[decorators.length>0]"],
        },
      ],
    },
  },
  // Turns off ESLint stylistic rules that conflict with Prettier (indent, etc.).
  // Without this, `eslint --fix` and `prettier --write` fight.
  ...compat.extends("prettier"),
  // Re-enable project rules that prettier turns off but we still want.
  // (max-len: prettier won't wrap long comments/strings the way we require;
  // quotes stays off — prettier singleQuote + avoidEscape handles them.)
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js"],
    rules: {
      "max-len": [
        "error",
        {
          code: 130,
          ignoreComments: true,
          ignoreStrings: false,
          ignoreTemplateLiterals: false,
          ignoreUrls: true,
        },
      ],
    },
  },
];
