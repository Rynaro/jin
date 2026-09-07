/**
 * AppearanceController — Stimulus controller that manages the app-wide
 * appearance (light/dark/auto) and the three HIG accessibility toggles.
 *
 * Sets root data-attributes and CSS custom properties used by:
 *   - tokens.css (color role switching)
 *   - a11y.css   (reduced-transparency / increased-contrast / reduced-motion)
 *
 * Persists to localStorage via state.ts so preferences survive app restarts.
 * The Tauri app_config command is read-only so localStorage is the only
 * persistence path (cross-launch prefs stored on the WebView side).
 *
 * Connect pattern: put data-controller="appearance" on <body>.
 * The controller sets data-attributes on document.documentElement (<html>)
 * so CSS selectors like :root[data-appearance="dark"] match correctly.
 *
 * Actions (bind via data-action in HTML):
 *   appearance#setLight       → data-appearance="light"
 *   appearance#setDark        → data-appearance="dark"
 *   appearance#setAuto        → data-appearance="auto"
 *   appearance#toggleReduceTransparency
 *   appearance#toggleIncreaseContrast
 *   appearance#toggleReduceMotion
 *   appearance#setTextSize    → value from input.valueAsNumber
 */

import { Controller } from '@hotwired/stimulus';
import {
  type Appearance,
  type AppearancePrefs,
  DEFAULT_PREFS,
  applyToRoot,
  loadPrefs,
  savePrefs,
  clampTextScale,
  togglePref,
} from '../lib/appearance/state';

export function syncAppearanceModeButtons(root: ParentNode, appearance: Appearance): void {
  const modes = [
    ['appearanceLight', 'light'],
    ['appearanceDark', 'dark'],
    ['appearanceAuto', 'auto'],
  ] as const;
  for (const [target, mode] of modes) {
    const button = root.querySelector<HTMLElement>(`[data-settings-target~="${target}"]`);
    if (!button) continue;
    const active = appearance === mode ? 'true' : 'false';
    button.setAttribute('aria-checked', active);
    button.setAttribute('aria-pressed', active);
  }
}

export default class AppearanceController extends Controller {
  private prefs: AppearancePrefs = { ...DEFAULT_PREFS };

  connect(): void {
    // Load persisted prefs on connect; apply immediately to avoid FOUC.
    this.prefs = loadPrefs();
    this.apply();
  }

  // ── Appearance (light / dark / auto) ──────────────────────────────────────

  setLight(): void {
    this.update('appearance', 'light' as Appearance);
  }

  setDark(): void {
    this.update('appearance', 'dark' as Appearance);
  }

  setAuto(): void {
    this.update('appearance', 'auto' as Appearance);
  }

  /**
   * setAppearance — programmatic setter, useful for tests and future bindings.
   */
  setAppearance(value: Appearance): void {
    this.update('appearance', value);
  }

  // ── Accessibility toggles ─────────────────────────────────────────────────

  toggleReduceTransparency(): void {
    this.prefs = togglePref(this.prefs, 'reduceTransparency');
    this.apply();
    savePrefs(this.prefs);
  }

  toggleIncreaseContrast(): void {
    this.prefs = togglePref(this.prefs, 'increaseContrast');
    this.apply();
    savePrefs(this.prefs);
  }

  toggleReduceMotion(): void {
    this.prefs = togglePref(this.prefs, 'reduceMotion');
    this.apply();
    savePrefs(this.prefs);
  }

  // ── Text size ─────────────────────────────────────────────────────────────

  /**
   * setTextSize — expects a numeric scale value or an input event.
   * Clamps to the nearest DYNAMIC_TYPE_STEPS entry.
   */
  setTextSize(scaleOrEvent: number | Event): void {
    let scale: number;
    if (typeof scaleOrEvent === 'number') {
      scale = scaleOrEvent;
    } else {
      const input = (scaleOrEvent as InputEvent).target as HTMLInputElement;
      scale = input.valueAsNumber;
    }
    this.prefs = { ...this.prefs, textSizeScale: clampTextScale(scale) };
    this.apply();
    savePrefs(this.prefs);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private update<K extends keyof AppearancePrefs>(
    key: K,
    value: AppearancePrefs[K]
  ): void {
    this.prefs = { ...this.prefs, [key]: value };
    this.apply();
    savePrefs(this.prefs);
  }

  private apply(): void {
    // Target <html>, not <body> (where this controller element lives),
    // so :root selectors in CSS match.
    applyToRoot(document.documentElement, this.prefs);
    syncAppearanceModeButtons(document, this.prefs.appearance);
  }
}
