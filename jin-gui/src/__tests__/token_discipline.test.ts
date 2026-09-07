/**
 * token_discipline.test.ts — VG-GUI-5 token discipline checks.
 *
 * Headless-verifiable assertions that the CSS design system:
 *   1. Defines required semantic token names in tokens.css
 *   2. Contains NO raw hex colors in any CSS file other than tokens.css
 *   3. Does NOT reference SF Pro / San Francisco font files (license)
 *   4. Has @fontsource/inter installed (OFL font bundled for Linux)
 *   5. Has correct light/dark token variants defined
 *
 * These are the headless gates for VG-GUI-5. Visual correctness
 * (glass rendering, reflow, contrast ratios on-screen) is owner-verified.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

// Resolve paths relative to this test file
// __tests__/ is one level below src/, which is one below jin-gui/
const STYLES_DIR = fileURLToPath(new URL('../styles', import.meta.url));
const PKG_FILE = fileURLToPath(new URL('../../package.json', import.meta.url));

/** Hex color pattern: #RGB, #RRGGBB, #RGBA, #RRGGBBAA */
const HEX_PATTERN = /#[0-9a-fA-F]{3,8}\b/;

function readStyleFile(name: string): string {
  return readFileSync(join(STYLES_DIR, name), 'utf-8');
}

function getStyleFileNames(): string[] {
  return readdirSync(STYLES_DIR).filter((f) => f.endsWith('.css'));
}

function getComponentStyleFiles(): string[] {
  return getStyleFileNames()
    .filter((f) => f !== 'tokens.css')
    .map((f) => join(STYLES_DIR, f));
}

// ── Token presence ────────────────────────────────────────────────────────────

describe('VG-GUI-5: tokens.css defines required semantic tokens', () => {
  const tokens = readStyleFile('tokens.css');

  it('defines --label (primary label)', () => expect(tokens).toContain('--label:'));
  it('defines --label-secondary', () => expect(tokens).toContain('--label-secondary:'));
  it('defines --bg-base', () => expect(tokens).toContain('--bg-base:'));
  it('defines --bg-secondary', () => expect(tokens).toContain('--bg-secondary:'));
  it('defines --bg-elevated', () => expect(tokens).toContain('--bg-elevated:'));
  it('defines --separator', () => expect(tokens).toContain('--separator:'));
  it('defines --separator-opaque', () => expect(tokens).toContain('--separator-opaque:'));
  it('defines --accent (systemBlue)', () => expect(tokens).toContain('--accent:'));
  it('defines --system-red', () => expect(tokens).toContain('--system-red:'));
  it('defines --system-green', () => expect(tokens).toContain('--system-green:'));
  it('defines --system-orange', () => expect(tokens).toContain('--system-orange:'));
  it('defines --system-yellow', () => expect(tokens).toContain('--system-yellow:'));
  it('defines --fill-primary', () => expect(tokens).toContain('--fill-primary:'));

  it('defines all 11 HIG text style size tokens', () => {
    const styles = [
      '--text-large-title-size',
      '--text-title1-size',
      '--text-title2-size',
      '--text-title3-size',
      '--text-headline-size',
      '--text-body-size',
      '--text-callout-size',
      '--text-subheadline-size',
      '--text-footnote-size',
      '--text-caption1-size',
      '--text-caption2-size',
    ];
    for (const token of styles) {
      expect(tokens).toContain(token);
    }
  });

  it('defines body text as 17pt (1.0625rem) matching the HIG baseline', () => {
    expect(tokens).toContain('--text-body-size: 1.0625rem');
  });

  it('defines a semantic display voice while keeping reading sizes scalable', () => {
    expect(tokens).toContain('--font-display:');
    expect(tokens).toContain('--display-title-size: 1.5rem');
    for (const token of [
      '--document-title-size',
      '--document-title-line',
      '--prose-h1-size',
      '--prose-h1-line',
      '--prose-h2-size',
      '--prose-h2-line',
      '--prose-h3-size',
      '--prose-h3-line',
      '--editor-text-size',
      '--editor-text-line',
    ]) {
      expect(tokens).toMatch(new RegExp(`${token}: [0-9.]+rem`));
    }
  });

  it('defines --font-text (system SF + Inter fallback)', () => {
    expect(tokens).toContain('--font-text:');
    expect(tokens).toContain('-apple-system');
    expect(tokens).toContain('Inter');
  });

  it('defines --dynamic-type-scale token', () => {
    expect(tokens).toContain('--dynamic-type-scale:');
  });

  it('defines adaptive on-ink and contrast-safe dark seal roles', () => {
    expect(tokens).toContain('--ink-on: #fbfaf8');
    expect(tokens).toContain('--ink-on: #151619');
    expect(tokens).toContain('--seal: #a83a2b');
    expect(tokens).toContain('--seal-strong: #8f2d21');
  });

  it('defines all spacing tokens (8pt grid)', () => {
    for (const token of ['--space-1: 8px', '--space-2: 16px', '--space-4: 32px']) {
      expect(tokens).toContain(token);
    }
  });

  it('defines corner radius tokens', () => {
    expect(tokens).toContain('--radius-md:');
    expect(tokens).toContain('--radius-capsule:');
    expect(tokens).toContain('--hit-target:');
  });

  it('defines motion tokens', () => {
    expect(tokens).toContain('--duration-fast:');
    expect(tokens).toContain('--duration-base:');
    expect(tokens).toContain('--ease-standard:');
  });

  it('has distinct dark-mode override block (two dark tiers)', () => {
    expect(tokens).toContain('prefers-color-scheme: dark');
    expect(tokens).toContain('[data-appearance="dark"]');
  });

  it('dark mode defines elevated tiers distinct from base', () => {
    expect(tokens).toContain('--bg-elevated-2:');
    expect(tokens).toContain('--bg-elevated-3:');
  });
});

// ── No raw hex in component CSS ───────────────────────────────────────────────

describe('VG-GUI-5: no raw hex in component CSS files', () => {
  it('component CSS files contain no raw hex color values', () => {
    const files = getComponentStyleFiles();
    const violations: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, i) => {
        // Strip inline comments before checking
        const stripped = line.replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, '');
        if (HEX_PATTERN.test(stripped)) {
          violations.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }

    if (violations.length > 0) {
      console.error('Raw hex found in component CSS:\n' + violations.join('\n'));
    }
    expect(violations).toHaveLength(0);
  });

  it('tokens.css IS allowed to contain hex values (sanity check)', () => {
    const content = readStyleFile('tokens.css');
    expect(HEX_PATTERN.test(content)).toBe(true);
  });
});

// ── Font licensing ────────────────────────────────────────────────────────────

describe('VG-GUI-5: font licensing — Inter bundled, SF Pro not', () => {
  it('@fontsource/inter is in dependencies (OFL font bundled for Linux)', () => {
    const pkg = JSON.parse(readFileSync(PKG_FILE, 'utf-8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(allDeps).toHaveProperty('@fontsource/inter');
  });

  it('no CSS file bundles SF Pro font files via @font-face src (Apple license violation)', () => {
    // Using "SF Pro Text" in a font-family STACK is legal (uses the OS-provided font).
    // Bundling SF Pro font files (src: url(...SFPro...)) is the violation.
    const files = getStyleFileNames().map((f) => join(STYLES_DIR, f));
    for (const file of files) {
      const content = readFileSync(file, 'utf-8').toLowerCase();
      // Check for @font-face blocks that bundle SF Pro — the tell is a url() pointing to an SF file
      expect(content).not.toMatch(/src:\s*url\([^)]*sf[_-]?pro/);
      expect(content).not.toMatch(/src:\s*url\([^)]*sanfrancisco/);
    }
  });

  it('tokens.css font stack includes Inter for Linux fallback', () => {
    const content = readStyleFile('tokens.css').toLowerCase();
    expect(content).toContain('inter');
  });
});

// ── a11y dual-fallback structure ─────────────────────────────────────────────

describe('VG-GUI-6: a11y fallbacks are present in a11y.css', () => {
  const a11y = readStyleFile('a11y.css');

  it('has prefers-reduced-transparency media query', () => {
    expect(a11y).toContain('prefers-reduced-transparency');
  });

  it('has [data-reduce-transparency] manual toggle', () => {
    expect(a11y).toContain('[data-reduce-transparency="1"]');
  });

  it('has prefers-contrast media query', () => {
    expect(a11y).toContain('prefers-contrast');
  });

  it('has [data-increase-contrast] manual toggle', () => {
    expect(a11y).toContain('[data-increase-contrast="1"]');
  });

  it('has prefers-reduced-motion media query', () => {
    expect(a11y).toContain('prefers-reduced-motion');
  });

  it('has [data-reduce-motion] manual toggle', () => {
    expect(a11y).toContain('[data-reduce-motion="1"]');
  });

  it('reduced-transparency fallback sets backdrop-filter to none', () => {
    expect(a11y).toContain('backdrop-filter: none');
  });

  it('has .sr-only visually-hidden utility', () => {
    expect(a11y).toContain('.sr-only');
  });

  it('has a forced-colors fallback for ink states and decorations', () => {
    expect(a11y).toContain('@media (forced-colors: active)');
    expect(a11y).toContain('background: Highlight');
  });
});

// ── Style file completeness ───────────────────────────────────────────────────

describe('Design system file completeness', () => {
  it('all required CSS modules exist', () => {
    const required = [
      'tokens.css',
      'typography.css',
      'materials.css',
      'a11y.css',
      'spacing.css',
      'motion.css',
      'layout.css',
      'index.css',
    ];
    const existing = getStyleFileNames();
    for (const name of required) {
      expect(existing).toContain(name);
    }
  });

  it('index.css imports all required modules', () => {
    const index = readStyleFile('index.css');
    const required = [
      'tokens.css',
      'typography.css',
      'spacing.css',
      'materials.css',
      'a11y.css',
      'motion.css',
      'layout.css',
    ];
    for (const name of required) {
      expect(index).toContain(name);
    }
  });
});
