/**
 * stylelint-plugin-jin.js — custom stylelint rules for jin-gui token discipline.
 *
 * Exports: array of rule definition objects (stylelint v16 plugin format).
 * Each item: { ruleName, rule, messages, meta }
 *
 * Rules:
 *   jin/no-raw-hex-in-components — disallows raw hex color values in any CSS
 *     file that is NOT tokens.css. Only the token definition file may contain
 *     raw hex; all component CSS must use var(--...) references.
 */

import stylelint from 'stylelint';

const { utils } = stylelint;

// ── jin/no-raw-hex-in-components ─────────────────────────────────────────────

const ruleName = 'jin/no-raw-hex-in-components';

const messages = utils.ruleMessages(ruleName, {
  rejected: (value) =>
    `Raw hex color "${value}" found. Use a CSS custom property (var(--...)) from tokens.css instead.`,
});

const meta = {
  url: 'https://github.com/jin-gui/jin-gui',
  fixable: false,
};

/** #RGB, #RRGGBB, #RGBA, #RRGGBBAA — requires no trailing hex digit */
const HEX_PATTERN = /#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])/;

/**
 * rule — the rule function. Takes `primary` (true/false/null).
 * Returns a PostCSS root walker.
 */
function rule(primary) {
  return (root, result) => {
    const validOptions = utils.validateOptions(result, ruleName, {
      actual: primary,
      possible: [true, false],
    });
    if (!validOptions || !primary) return;

    // tokens.css is the one file allowed to define raw color values
    const filePath = root.source?.input?.file ?? '';
    if (filePath.endsWith('tokens.css')) return;

    root.walkDecls((decl) => {
      if (HEX_PATTERN.test(decl.value)) {
        utils.report({
          message: messages.rejected(decl.value),
          node: decl,
          result,
          ruleName,
        });
      }
    });
  };
}

// ── Plugin export: array of rule definition objects ──────────────────────────
// stylelint v16 resolves `pluginFunctions[ruleDef.ruleName] = ruleDef.rule`

export default [
  {
    ruleName,
    rule,
    messages,
    meta,
  },
];
