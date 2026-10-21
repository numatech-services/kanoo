// Configuration ESLint (format « flat », ESLint ≥ 9) — choix expliqués dans eslint.notes.md.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  { ignores: ["node_modules/", ".next/", "mobile/", "public/sw.js", "next-env.d.ts", "kanoo-deploy-*.zip"] },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": "error",
      "@typescript-eslint/ban-ts-comment": "warn",
      "react/no-unescaped-entities": "off",
      // Convention de chargement de l'application (voir eslint.notes.md).
      "react-hooks/set-state-in-effect": "off",
      // Logos en data-URI enregistrés en base : next/image n'apporte rien (voir eslint.notes.md).
      "@next/next/no-img-element": "off",
    },
  },
];

export default config;
