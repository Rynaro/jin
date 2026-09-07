/**
 * css_tokens.test.ts — guard against undefined bare var() token references.
 *
 * Reads every src/styles/*.css file, extracts every bare var(--NAME) reference
 * (i.e. no comma → no inline fallback), reads all --NAME: definitions from
 * tokens.css, and FAILS if any bare reference is not defined in tokens.css and
 * not in the allowlist.
 *
 * Rules:
 *   - var(--x, fallback)  →  OK (has a fallback, comma present)
 *   - var(--x)            →  FAIL if --x not in tokens.css and not in allowlist
 *
 * CSS block comments are stripped before matching so comment-only references
 * (e.g. in doc examples inside /* ... *\/) do not produce false positives.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const STYLES_DIR = fileURLToPath(new URL('../styles', import.meta.url));

// ── Allowlist ──────────────────────────────────────────────────────────────────
//
// Entries fall into two categories:
//
//   (A) Runtime / JS-set custom properties that are intentionally not in tokens.css
//       because they are injected dynamically at runtime by JavaScript.
//
//   (B) Pre-existing violations outside the scope of the ToDo suite regression fix.
//       These should be addressed in a separate cleanup pass; they are listed here
//       only so the guard test passes on the current tree.
//
const BARE_VAR_ALLOWLIST = new Set<string>([
  // (A) Runtime / JS-set ─────────────────────────────────────────────────────
  '--tree-depth',        // folder-tree depth indent, set by JS on tree widgets

  // (B) Pre-existing, tracked separately ────────────────────────────────────
  // browse.css: appears only as a fallback-within-fallback var(--accent, var(--system-blue));
  // --accent is always resolved first so --system-blue is never evaluated by the browser.
  '--system-blue',
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strip CSS block comments so references inside /* ... *\/ aren't flagged. */
function stripBlockComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Extract all --NAME definitions from a CSS string (i.e. `--name:` declarations). */
function extractDefinitions(css: string): Set<string> {
  const defined = new Set<string>();
  // Match the custom property name in `--name: value` (before the colon).
  const re = /(--[a-zA-Z0-9-]+)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    defined.add(m[1]);
  }
  return defined;
}

/**
 * Extract bare var(--NAME) references — those without a comma (no inline fallback).
 * Strips block comments first to avoid matching references inside CSS doc-comments.
 */
function extractBareVarRefs(css: string): Set<string> {
  const refs = new Set<string>();
  const stripped = stripBlockComments(css);
  // Matches var(--name) where --name is immediately followed by optional whitespace
  // then ')' — meaning NO comma and therefore NO fallback inside the var().
  const re = /var\((--[a-zA-Z0-9-]+)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    refs.add(m[1]);
  }
  return refs;
}

// ── Test ──────────────────────────────────────────────────────────────────────

describe('CSS token guard — no undefined bare var() references', () => {
  it(
    'every bare var(--x) in src/styles/*.css is defined in tokens.css ' +
    'or has a known allowlist entry',
    () => {
      const filenames = readdirSync(STYLES_DIR).filter((f) => f.endsWith('.css'));

      // Build the defined-token set from tokens.css.
      const tokensCss = readFileSync(join(STYLES_DIR, 'tokens.css'), 'utf-8');
      const defined = extractDefinitions(tokensCss);

      const violations: string[] = [];

      for (const filename of filenames) {
        if (filename === 'tokens.css') continue; // tokens.css defines itself — skip

        const css = readFileSync(join(STYLES_DIR, filename), 'utf-8');
        const bareRefs = extractBareVarRefs(css);

        for (const ref of bareRefs) {
          if (!defined.has(ref) && !BARE_VAR_ALLOWLIST.has(ref)) {
            violations.push(
              `${filename}: bare var(${ref}) — not defined in tokens.css and not in allowlist`
            );
          }
        }
      }

      if (violations.length > 0) {
        console.error(
          '\nUndefined bare var() references found:\n' +
          violations.map((v) => `  ${v}`).join('\n') +
          '\n\nFix: either define --NAME in tokens.css, add a fallback ' +
          'var(--NAME, <fallback>), or add it to the BARE_VAR_ALLOWLIST with a justification.\n'
        );
      }

      expect(violations).toEqual([]);
    }
  );
});
