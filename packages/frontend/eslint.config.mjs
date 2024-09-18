import eslintPluginImport from "eslint-plugin-import";
import baseConfig from "../../eslint.base.mjs";
import globals from "globals";

export default [
  ...baseConfig,
  {
    plugins: {
      "import": eslintPluginImport,
    },

    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
  },
];
