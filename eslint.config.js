import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/", ".firebase/"] },
  js.configs.recommended,
  {
    // ブラウザで動く画面・共通ロジック
    files: ["public/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser },
    },
    rules: {
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      // 日本語コメント/文字列の全角スペースは許可
      "no-irregular-whitespace": [
        "error",
        {
          skipComments: true,
          skipStrings: true,
          skipTemplates: true,
        },
      ],
    },
  },
  {
    // Node の標準テストランナー
    files: ["tests/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
];
