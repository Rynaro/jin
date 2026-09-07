// @vitest-environment jsdom
/**
 * appearance_controller.test.ts — unit tests for appearance state logic.
 *
 * Tests the pure state.ts module (applyToRoot, loadPrefs, savePrefs,
 * togglePref, clampTextScale). The Stimulus controller is a thin adapter
 * that delegates to these — testing the pure module covers the logic.
 *
 * VG-GUI-6: Verifies that each toggle correctly sets the corresponding
 * root data-attribute used by a11y.css.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyToRoot,
  loadPrefs,
  savePrefs,
  clampTextScale,
  togglePref,
  DEFAULT_PREFS,
  DYNAMIC_TYPE_STEPS,
  STORAGE_KEY,
  type AppearancePrefs,
} from '../lib/appearance/state';
import { syncAppearanceModeButtons } from '../controllers/appearance_controller';

// Use a fresh HTMLElement for each test to avoid cross-test contamination
function makeRoot(): HTMLElement {
  return document.createElement('html');
}

beforeEach(() => {
  localStorage.clear();
  // Reset document root attributes between tests
  const root = document.documentElement;
  delete root.dataset.appearance;
  delete root.dataset.reduceTransparency;
  delete root.dataset.increaseContrast;
  delete root.dataset.reduceMotion;
  root.style.removeProperty('--dynamic-type-scale');
});

// ── applyToRoot ───────────────────────────────────────────────────────────────

describe('applyToRoot', () => {
  it('sets data-appearance to the given appearance mode', () => {
    const root = makeRoot();
    applyToRoot(root, { ...DEFAULT_PREFS, appearance: 'dark' });
    expect(root.dataset.appearance).toBe('dark');
  });

  it('sets data-appearance to "light"', () => {
    const root = makeRoot();
    applyToRoot(root, { ...DEFAULT_PREFS, appearance: 'light' });
    expect(root.dataset.appearance).toBe('light');
  });

  it('sets data-appearance to "auto"', () => {
    const root = makeRoot();
    applyToRoot(root, { ...DEFAULT_PREFS, appearance: 'auto' });
    expect(root.dataset.appearance).toBe('auto');
  });

  it('sets data-reduce-transparency to "1" when reduceTransparency is true', () => {
    const root = makeRoot();
    applyToRoot(root, { ...DEFAULT_PREFS, reduceTransparency: true });
    expect(root.dataset.reduceTransparency).toBe('1');
  });

  it('sets data-reduce-transparency to "0" when reduceTransparency is false', () => {
    const root = makeRoot();
    applyToRoot(root, { ...DEFAULT_PREFS, reduceTransparency: false });
    expect(root.dataset.reduceTransparency).toBe('0');
  });

  it('sets data-increase-contrast to "1" when increaseContrast is true', () => {
    const root = makeRoot();
    applyToRoot(root, { ...DEFAULT_PREFS, increaseContrast: true });
    expect(root.dataset.increaseContrast).toBe('1');
  });

  it('sets data-increase-contrast to "0" when increaseContrast is false', () => {
    const root = makeRoot();
    applyToRoot(root, { ...DEFAULT_PREFS, increaseContrast: false });
    expect(root.dataset.increaseContrast).toBe('0');
  });

  it('sets data-reduce-motion to "1" when reduceMotion is true', () => {
    const root = makeRoot();
    applyToRoot(root, { ...DEFAULT_PREFS, reduceMotion: true });
    expect(root.dataset.reduceMotion).toBe('1');
  });

  it('sets data-reduce-motion to "0" when reduceMotion is false', () => {
    const root = makeRoot();
    applyToRoot(root, { ...DEFAULT_PREFS, reduceMotion: false });
    expect(root.dataset.reduceMotion).toBe('0');
  });

  it('sets --dynamic-type-scale CSS property', () => {
    const root = makeRoot();
    applyToRoot(root, { ...DEFAULT_PREFS, textSizeScale: 1.24 });
    expect(root.style.getPropertyValue('--dynamic-type-scale')).toBe('1.24');
  });

  it('publishes the accessibility text-scale category for responsive layout', () => {
    const root = makeRoot();
    applyToRoot(root, { ...DEFAULT_PREFS, textSizeScale: 3.1 });
    expect(root.dataset.textScale).toBe('accessibility');

    applyToRoot(root, { ...DEFAULT_PREFS, textSizeScale: 1.35 });
    expect(root.dataset.textScale).toBe('standard');
  });

  it('is idempotent — applying the same prefs twice gives the same result', () => {
    const root = makeRoot();
    const prefs: AppearancePrefs = {
      ...DEFAULT_PREFS,
      appearance: 'dark',
      reduceTransparency: true,
      textSizeScale: 1.12,
    };
    applyToRoot(root, prefs);
    applyToRoot(root, prefs);
    expect(root.dataset.appearance).toBe('dark');
    expect(root.dataset.reduceTransparency).toBe('1');
    expect(root.style.getPropertyValue('--dynamic-type-scale')).toBe('1.12');
  });

  it('VG-GUI-6: all three a11y data-attributes are set simultaneously', () => {
    const root = makeRoot();
    applyToRoot(root, {
      appearance: 'dark',
      reduceTransparency: true,
      increaseContrast: true,
      reduceMotion: true,
      textSizeScale: 1.6,
    });
    expect(root.dataset.reduceTransparency).toBe('1');
    expect(root.dataset.increaseContrast).toBe('1');
    expect(root.dataset.reduceMotion).toBe('1');
  });
});

// ── loadPrefs / savePrefs ─────────────────────────────────────────────────────

describe('loadPrefs', () => {
  it('returns DEFAULT_PREFS when localStorage is empty', () => {
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('returns the stored prefs after savePrefs', () => {
    const custom: AppearancePrefs = {
      appearance: 'dark',
      reduceTransparency: true,
      increaseContrast: false,
      reduceMotion: false,
      textSizeScale: 1.24,
    };
    savePrefs(custom);
    const loaded = loadPrefs();
    expect(loaded.appearance).toBe('dark');
    expect(loaded.textSizeScale).toBe(1.24);
    expect(loaded.reduceTransparency).toBe(true);
  });

  it('merges stored prefs with defaults (unknown future keys fall back to defaults)', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ appearance: 'light' }));
    const loaded = loadPrefs();
    expect(loaded.appearance).toBe('light');
    expect(loaded.reduceTransparency).toBe(DEFAULT_PREFS.reduceTransparency);
  });

  it('returns DEFAULT_PREFS when stored JSON is malformed', () => {
    localStorage.setItem(STORAGE_KEY, 'not json {{{');
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });
});

describe('savePrefs + loadPrefs round-trip', () => {
  it('round-trips all fields correctly', () => {
    const prefs: AppearancePrefs = {
      appearance: 'auto',
      reduceTransparency: false,
      increaseContrast: true,
      reduceMotion: true,
      textSizeScale: 2.35,
    };
    savePrefs(prefs);
    const loaded = loadPrefs();
    expect(loaded).toEqual(prefs);
  });
});

// ── togglePref ────────────────────────────────────────────────────────────────

describe('togglePref', () => {
  it('toggles reduceTransparency from false to true', () => {
    const prefs: AppearancePrefs = { ...DEFAULT_PREFS, reduceTransparency: false };
    expect(togglePref(prefs, 'reduceTransparency').reduceTransparency).toBe(true);
  });

  it('toggles reduceTransparency from true to false', () => {
    const prefs: AppearancePrefs = { ...DEFAULT_PREFS, reduceTransparency: true };
    expect(togglePref(prefs, 'reduceTransparency').reduceTransparency).toBe(false);
  });

  it('toggles increaseContrast', () => {
    const prefs: AppearancePrefs = { ...DEFAULT_PREFS, increaseContrast: false };
    expect(togglePref(prefs, 'increaseContrast').increaseContrast).toBe(true);
  });

  it('toggles reduceMotion', () => {
    const prefs: AppearancePrefs = { ...DEFAULT_PREFS, reduceMotion: false };
    expect(togglePref(prefs, 'reduceMotion').reduceMotion).toBe(true);
  });

  it('does not mutate the original prefs object', () => {
    const prefs: AppearancePrefs = { ...DEFAULT_PREFS };
    togglePref(prefs, 'reduceTransparency');
    expect(prefs.reduceTransparency).toBe(DEFAULT_PREFS.reduceTransparency);
  });

  it('returns prefs unchanged when the key is not a boolean', () => {
    const prefs: AppearancePrefs = { ...DEFAULT_PREFS };
    const result = togglePref(prefs, 'textSizeScale');
    expect(result).toBe(prefs); // same reference when no change
  });
});

// ── clampTextScale ────────────────────────────────────────────────────────────

describe('clampTextScale', () => {
  it('returns 1.0 for the default scale', () => {
    expect(clampTextScale(1.0)).toBe(1.0);
  });

  it('snaps 1.05 to the nearest step (1.0)', () => {
    expect(clampTextScale(1.05)).toBe(1.0);
  });

  it('snaps 1.09 to 1.12 (nearer to xLarge)', () => {
    expect(clampTextScale(1.09)).toBe(1.12);
  });

  it('returns the AX5 maximum for values above 3.1', () => {
    expect(clampTextScale(5.0)).toBe(3.1);
  });

  it('returns the xSmall minimum for values below 0.82', () => {
    expect(clampTextScale(0.0)).toBe(0.82);
  });

  it('all DYNAMIC_TYPE_STEPS are valid snap targets', () => {
    for (const step of DYNAMIC_TYPE_STEPS) {
      expect(clampTextScale(step)).toBe(step);
    }
  });
});

// ── DEFAULT_PREFS contract ────────────────────────────────────────────────────

describe('DEFAULT_PREFS', () => {
  it('defaults to "auto" appearance (follow-system)', () => {
    expect(DEFAULT_PREFS.appearance).toBe('auto');
  });

  it('defaults all a11y toggles to off', () => {
    expect(DEFAULT_PREFS.reduceTransparency).toBe(false);
    expect(DEFAULT_PREFS.increaseContrast).toBe(false);
    expect(DEFAULT_PREFS.reduceMotion).toBe(false);
  });

  it('defaults text scale to 1.0 (Large / standard)', () => {
    expect(DEFAULT_PREFS.textSizeScale).toBe(1.0);
  });
});

describe('appearance segmented control synchronization', () => {
  it.each([
    ['light', ['true', 'false', 'false']],
    ['dark', ['false', 'true', 'false']],
    ['auto', ['false', 'false', 'true']],
  ] as const)('updates both ARIA states mutually exclusively for %s', (mode, expected) => {
    document.body.innerHTML = `
      <button data-settings-target="appearanceLight"></button>
      <button data-settings-target="appearanceDark"></button>
      <button data-settings-target="appearanceAuto"></button>
    `;

    syncAppearanceModeButtons(document, mode);

    const light = document.querySelector('[data-settings-target="appearanceLight"]')!;
    const dark = document.querySelector('[data-settings-target="appearanceDark"]')!;
    const auto = document.querySelector('[data-settings-target="appearanceAuto"]')!;
    expect([light, dark, auto].map((el) => el.getAttribute('aria-checked')))
      .toEqual(expected);
    expect([light, dark, auto].map((el) => el.getAttribute('aria-pressed')))
      .toEqual(expected);
  });
});
