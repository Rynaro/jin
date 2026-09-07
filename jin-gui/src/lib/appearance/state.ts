/**
 * appearance/state.ts — pure appearance state logic (no Stimulus dependency).
 *
 * Extracted so the logic is testable without a Tauri/Stimulus runtime.
 * The Stimulus AppearanceController delegates to these functions.
 *
 * Responsibilities:
 *   - Apply appearance prefs to the root HTML element via data-attributes
 *   - Load/save prefs from localStorage
 *   - Expose the Dynamic Type step scale values
 *
 * Data-attribute contract (VG-GUI-6):
 *   [data-appearance]          = "light" | "dark" | "auto"
 *   [data-reduce-transparency] = "1" | "0"
 *   [data-increase-contrast]   = "1" | "0"
 *   [data-reduce-motion]       = "1" | "0"
 *   [data-text-scale]          = "standard" | "accessibility"
 *   CSS custom property --dynamic-type-scale = <number>
 *
 * These data-attributes gate the a11y.css fallback rules for WebKitGTK,
 * where CSS media queries for prefers-reduced-transparency / prefers-contrast
 * may not fire (GAP G1 from the spec).
 */

export type Appearance = 'light' | 'dark' | 'auto';

/**
 * Dynamic Type scale steps.
 * Mirror Apple's 7 standard + 5 AX accessibility sizes.
 * Index 3 (1.0) is the default "Large" size.
 */
export const DYNAMIC_TYPE_STEPS = [
  0.82,  // xSmall
  0.88,  // Small
  0.94,  // Medium
  1.0,   // Large (default)
  1.12,  // xLarge
  1.24,  // xxLarge
  1.35,  // xxxLarge
  1.6,   // AX1
  1.9,   // AX2
  2.35,  // AX3
  2.75,  // AX4
  3.1,   // AX5
] as const;

export type DynamicTypeStep = (typeof DYNAMIC_TYPE_STEPS)[number];

/**
 * The full set of user-controllable appearance preferences.
 * Persisted in localStorage and applied as root data-attributes + CSS vars.
 */
export interface AppearancePrefs {
  appearance: Appearance;
  reduceTransparency: boolean;
  increaseContrast: boolean;
  reduceMotion: boolean;
  /**
   * Text size multiplier from DYNAMIC_TYPE_STEPS.
   * 1.0 is the default; applied as --dynamic-type-scale on :root.
   */
  textSizeScale: number;
}

export const DEFAULT_PREFS: AppearancePrefs = {
  appearance: 'auto',
  reduceTransparency: false,
  increaseContrast: false,
  reduceMotion: false,
  textSizeScale: 1.0,
};

export const STORAGE_KEY = 'jin_appearance_prefs';

/**
 * applyToRoot — sets root element data-attributes and CSS custom property
 * to match the given prefs. Idempotent.
 */
export function applyToRoot(root: HTMLElement, prefs: AppearancePrefs): void {
  root.dataset.appearance = prefs.appearance;
  root.dataset.reduceTransparency = prefs.reduceTransparency ? '1' : '0';
  root.dataset.increaseContrast = prefs.increaseContrast ? '1' : '0';
  root.dataset.reduceMotion = prefs.reduceMotion ? '1' : '0';
  root.dataset.textScale = prefs.textSizeScale >= 1.6 ? 'accessibility' : 'standard';
  root.style.setProperty('--dynamic-type-scale', String(prefs.textSizeScale));
}

/**
 * loadPrefs — reads from localStorage; returns DEFAULT_PREFS on miss or error.
 * Unknown keys from future versions are silently dropped (spread into defaults).
 */
export function loadPrefs(): AppearancePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed: Partial<AppearancePrefs> = JSON.parse(raw);
    return {
      ...DEFAULT_PREFS,
      ...parsed,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/**
 * savePrefs — writes to localStorage. Silently no-ops if unavailable
 * (e.g. private browsing, Tauri WebView with restricted storage).
 */
export function savePrefs(prefs: AppearancePrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Silent: localStorage unavailable is not a fatal error.
  }
}

/**
 * clampTextScale — clamps a scale value to the nearest valid DYNAMIC_TYPE_STEPS entry.
 */
export function clampTextScale(scale: number): number {
  const steps = DYNAMIC_TYPE_STEPS as readonly number[];
  return steps.reduce((prev, curr) =>
    Math.abs(curr - scale) < Math.abs(prev - scale) ? curr : prev
  );
}

/**
 * toggleBool — returns the opposite of a boolean pref field.
 * Convenience for the Stimulus controller toggle actions.
 */
export function togglePref<K extends keyof AppearancePrefs>(
  prefs: AppearancePrefs,
  key: K
): AppearancePrefs {
  if (typeof prefs[key] !== 'boolean') return prefs;
  return { ...prefs, [key]: !prefs[key] };
}
