/**
 * stylelint.config.js — CSS linting configuration for jin-gui (VG-GUI-5).
 *
 * Rules enforced:
 *   1. jin/no-raw-hex-in-components — raw hex only allowed in tokens.css
 *   2. color-named: never — no named colors in component CSS
 *   3. color-no-invalid-hex — catches malformed hex values
 *
 * tokens.css is excluded from rule 1 via overrides (it IS where tokens live).
 * index.css and main.css only contain @import — exempted from color rules.
 */

export default {
  plugins: ['./stylelint-plugin-jin.js'],

  rules: {
    // No hardcoded named colors — forces use of CSS custom properties
    'color-named': 'never',

    // Catch malformed hex strings early
    'color-no-invalid-hex': true,

    // Main VG-GUI-5 gate: no raw hex in component CSS (only tokens.css may define them)
    'jin/no-raw-hex-in-components': true,
  },

  overrides: [
    {
      // tokens.css is allowed to define raw hex — it IS the token source
      files: ['src/styles/tokens.css'],
      rules: {
        'jin/no-raw-hex-in-components': null,
        'color-named': null,
      },
    },
    {
      // Pure @import files — no color declarations at all, skip color rules
      files: ['src/styles/index.css', 'src/styles/main.css'],
      rules: {
        'jin/no-raw-hex-in-components': null,
        'color-named': null,
      },
    },
  ],
};
