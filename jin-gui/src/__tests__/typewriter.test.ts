// @vitest-environment jsdom
/**
 * typewriter.test.ts — anti-shallow, mutation-testable gates for the CM6
 * typewriter-scrolling extension (typewriter.ts).
 *
 * Gates covered:
 *   G-TYPEWRITER-TARGET — typewriterTarget pure decision table:
 *                          (collapsed+changed)→head; (range)→null; (no-change)→null
 *   G-CHOKEPOINT-COZY  — typewriter.ts imports only @codemirror/*; no innerHTML
 */

import { describe, it, expect } from 'vitest';
import { typewriterTarget } from '../lib/notes/typewriter';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── G-TYPEWRITER-TARGET ───────────────────────────────────────────────────────

describe('G-TYPEWRITER-TARGET — pure decision helper', () => {
  it('AC-COZY2.1: collapsed=true + selectionChanged=true → returns head', () => {
    const result = typewriterTarget({ selectionChanged: true, collapsed: true, head: 42 });
    expect(result).toBe(42);
  });

  it('AC-COZY2.2: collapsed=false (range) + selectionChanged=true → returns null', () => {
    // Range selection must NOT trigger centering (iA-Writer jumpiness caveat — R3)
    const result = typewriterTarget({ selectionChanged: true, collapsed: false, head: 42 });
    expect(result).toBeNull();
  });

  it('AC-COZY2.3: collapsed=true + selectionChanged=false (nothing changed) → returns null', () => {
    // No-op transaction (e.g. viewport redraw) must NOT scroll
    const result = typewriterTarget({ selectionChanged: false, collapsed: true, head: 42 });
    expect(result).toBeNull();
  });

  it('collapsed=false + selectionChanged=false → returns null (both guards fail)', () => {
    const result = typewriterTarget({ selectionChanged: false, collapsed: false, head: 0 });
    expect(result).toBeNull();
  });

  it('collapsed + changed with head=0 → returns 0 (boundary: head at doc start)', () => {
    const result = typewriterTarget({ selectionChanged: true, collapsed: true, head: 0 });
    expect(result).toBe(0);
  });

  it('collapsed + changed with large head → returns the exact head value', () => {
    const result = typewriterTarget({ selectionChanged: true, collapsed: true, head: 999999 });
    expect(result).toBe(999999);
  });

  it('dropping the collapsed guard: range+changed → still null (collapsed guard is load-bearing)', () => {
    // This tests that the guard is PRESENT: range must return null even when changed=true.
    // Mutation: removing `collapsed &&` would make this return 42 instead of null — FAIL.
    expect(typewriterTarget({ selectionChanged: true,  collapsed: false, head: 42 })).toBeNull();
  });

  it('dropping the changed guard: collapsed+unchanged → still null (changed guard is load-bearing)', () => {
    // Mutation: removing `selectionChanged &&` would make this return 42 — FAIL.
    expect(typewriterTarget({ selectionChanged: false, collapsed: true,  head: 42 })).toBeNull();
  });
});

// ── G-CHOKEPOINT-COZY ─────────────────────────────────────────────────────────

describe('G-CHOKEPOINT-COZY — typewriter.ts imports only @codemirror/*', () => {
  it('typewriter.ts has no innerHTML and no forbidden imports (markdown-it / dompurify)', () => {
    const src = readFileSync(
      resolve(__dirname, '../lib/notes/typewriter.ts'),
      'utf8',
    );

    // No .innerHTML assignment (same regex as G-LP-NO-INNERHTML in livePreview.test.ts)
    expect(/\.innerHTML\s*=/.test(src), 'typewriter.ts must not assign .innerHTML').toBe(false);

    // Every import statement must come from @codemirror/* (covers the markdown-it / dompurify check)
    const importedModules = [...src.matchAll(/^import .+ from ['"]([^'"]+)['"]/gm)].map(
      (m) => m[1],
    );
    expect(importedModules.length, 'typewriter.ts must have at least one import').toBeGreaterThan(0);
    for (const mod of importedModules) {
      expect(mod, `unexpected import in typewriter.ts: "${mod}"`).toMatch(/^@codemirror\//);
    }
    // Belt-and-suspenders: no actual import() call for forbidden packages
    expect(/from ['"]markdown-it['"]/.test(src)).toBe(false);
    expect(/from ['"]dompurify['"]/.test(src)).toBe(false);
  });
});
