import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

/* eslint-config-next 16 ships flat configs directly; FlatCompat wrapping it
   throws on a circular plugin reference. */
const config = [
  {
    ignores: [
      // Hand-written ES5 for maximum compatibility on brands' sites, and
      // intentionally outside the TypeScript program.
      "public/rovena.js",
      ".next/**",
      "node_modules/**",
    ],
  },
  ...coreWebVitals,
  ...typescript,
];

export default config;
