// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CALENDAR_COLOR_STORAGE_KEY,
  calendarColor,
  calendarColorForEvent,
  googleCalendarKey,
  JIN_CALENDAR_KEY,
  loadCalendarColors,
  saveCalendarColor,
  applyCalendarColor,
} from '../lib/calendar/colors';
import { applyJinColor, createJinColorPicker, JIN_PALETTE, normalizeJinColor } from '../lib/ui/color_picker';

beforeEach(() => {
  localStorage.clear();
  document.body.replaceChildren();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
});

describe('shared Jin color picker', () => {
  it('renders the canonical palette and reports one selected value', () => {
    const onPick = vi.fn();
    const picker = createJinColorPicker({ value: 'purple', label: 'Calendar color', onPick });
    const swatches = [...picker.element.querySelectorAll<HTMLButtonElement>('.jin-color-swatch')];
    expect(swatches.map(swatch => swatch.dataset.color)).toEqual([...JIN_PALETTE, 'custom']);
    expect(swatches.at(-1)?.classList.contains('jin-color-swatch--custom')).toBe(true);
    expect(swatches.filter(swatch => swatch.getAttribute('aria-pressed') === 'true')[0]?.dataset.color).toBe('purple');
    swatches.find(swatch => swatch.dataset.color === 'success')?.click();
    expect(onPick).toHaveBeenCalledWith('success');
  });

  it('keeps the custom swatch chromatic even when it previews a selected custom color', () => {
    const picker = createJinColorPicker({ value: '#123456', label: 'Color', onPick: vi.fn() });
    const custom = picker.element.querySelector<HTMLElement>('.jin-color-swatch--custom')!;
    expect(custom.style.getPropertyValue('--custom-preview')).toBe('#123456');
    expect(custom.style.getPropertyValue('--sw')).toBe('');
    const css = readFileSync(resolve(process.cwd(), 'src/styles/components.css'), 'utf8');
    expect(css).toMatch(/\.jin-color-swatch--custom\s*\{[^}]*background:\s*conic-gradient\(/s);
    expect(css).not.toMatch(/\.jin-color-swatch--custom\s*\{[^}]*background:\s*var\(--sw/s);
  });

  it('keeps the chroma dialog within its container and preserves usable compact RGB controls', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/components.css'), 'utf8');
    expect(css).toMatch(/\.jin-chroma-dialog\s*\{[^}]*min-inline-size:\s*0[^}]*max-inline-size:\s*100%/s);
    expect(css).toMatch(/\.jin-chroma-dialog__ranges\s*\{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/\.jin-chroma-dialog__range--full\s*\{\s*grid-column:\s*1 \/ -1;/);
    expect(css).toMatch(/\.jin-chroma-dialog__hex,[^{]*\.jin-chroma-dialog__rgb \.form-input\s*\{[^}]*padding-inline:\s*var\(--space-1\)/s);
    expect(css).toMatch(/@media \(max-width: 32rem\)[\s\S]*?\.jin-chroma-dialog__ranges,[\s\S]*?\.jin-chroma-dialog__inputs\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(css).toMatch(/@media \(max-width: 32rem\)[\s\S]*?\.jin-chroma-dialog__ranges input,[\s\S]*?\.jin-chroma-dialog__rgb\s*\{[^}]*inline-size:\s*100%[^}]*min-inline-size:\s*0/s);
    expect(css).toMatch(/@media \(max-width: 32rem\)[\s\S]*?\.jin-chroma-dialog__ranges input\[type='range'\]\s*\{\s*margin-inline:\s*0;/);
  });

  it('styles the native Hue track and thumb for both engines, focus, and forced colors', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/components.css'), 'utf8');
    expect(css).toMatch(/\.jin-chroma-dialog__hue\s*\{[^}]*appearance:\s*none[^}]*background:\s*transparent/s);
    expect(css).toContain('.jin-chroma-dialog__hue::-webkit-slider-runnable-track');
    expect(css).toContain('.jin-chroma-dialog__hue::-moz-range-track');
    expect(css.match(/background: linear-gradient\(to right,/g)?.length).toBeGreaterThanOrEqual(2);
    expect(css).toMatch(/\.jin-chroma-dialog__hue::-webkit-slider-thumb\s*\{[^}]*var\(--chroma-white\)[^}]*var\(--jin-chroma-current-hue, var\(--accent\)\)[^}]*var\(--chroma-black\)/s);
    expect(css).toMatch(/\.jin-chroma-dialog__hue::-moz-range-thumb\s*\{[^}]*var\(--chroma-white\)[^}]*var\(--jin-chroma-current-hue, var\(--accent\)\)[^}]*var\(--chroma-black\)/s);
    expect(css).toMatch(/\.jin-chroma-dialog__hue:focus-visible\s*\{[^}]*outline:/s);
    expect(css).toMatch(/@media \(forced-colors: active\)[\s\S]*?\.jin-chroma-dialog__hue\s*\{[^}]*appearance:\s*auto/s);
  });

  it('normalizes palette, short HEX, and full HEX inputs', () => {
    expect(normalizeJinColor(' Purple ')).toBe('purple');
    expect(normalizeJinColor('#a3f')).toBe('#AA33FF');
    expect(normalizeJinColor('#12abEF')).toBe('#12ABEF');
    expect(normalizeJinColor('12abef')).toBeNull();
    expect(normalizeJinColor('#abcd')).toBeNull();
    const swatch = document.createElement('span');
    expect(applyJinColor(swatch, '#ab12ef')).toBe('#AB12EF');
    expect(swatch.style.getPropertyValue('--sw')).toBe('#AB12EF');
    expect(applyJinColor(swatch, 'unsafe')).toBe('accent');
    expect(swatch.style.getPropertyValue('--sw')).toBe('');
  });

  it('lazily creates a synchronized custom dialog and previews valid HEX/RGB/HSV changes', () => {
    const picker = createJinColorPicker({ value: 'accent', label: 'Color', onPick: vi.fn() });
    document.body.appendChild(picker.element);
    expect(document.querySelector('[aria-label="Choose a custom color"]')).toBe(picker.element.querySelector('[data-color="custom"]'));
    expect(document.querySelector('.jin-chroma-dialog')).toBeNull();
    picker.element.querySelector<HTMLButtonElement>('[data-color="custom"]')!.click();
    expect(document.querySelector('.jin-chroma-dialog')).not.toBeNull();

    const hex = document.querySelector<HTMLInputElement>('[aria-label="HEX color"]')!;
    hex.value = '#3a7bd5'; hex.setSelectionRange(4, 4); hex.dispatchEvent(new Event('input'));
    expect(hex.value).toBe('#3a7bd5');
    expect(hex.selectionStart).toBe(4);
    expect([...document.querySelectorAll<HTMLInputElement>('.jin-chroma-dialog__rgb input')].map(input => input.value)).toEqual(['58', '123', '213']);
    hex.dispatchEvent(new Event('change'));
    expect(hex.value).toBe('#3A7BD5');
    const previewBefore = document.querySelector<HTMLElement>('.jin-chroma-dialog__preview')!.style.backgroundColor;
    const red = document.querySelector<HTMLInputElement>('[aria-label="Red channel"]')!;
    const rgbLabels = [...document.querySelectorAll<HTMLLabelElement>('.jin-chroma-dialog__rgb label')];
    expect(rgbLabels.map(label => label.textContent)).toEqual(['R', 'G', 'B']);
    expect(rgbLabels[0].contains(red)).toBe(true);
    red.value = '255'; red.dispatchEvent(new Event('input'));
    expect(document.querySelector<HTMLElement>('.jin-chroma-dialog__preview')!.style.backgroundColor).not.toBe(previewBefore);
    const hue = document.querySelector<HTMLInputElement>('[aria-label="Hue"]')!;
    hue.value = '120'; hue.dispatchEvent(new Event('input'));
    expect(hex.value).toMatch(/^#[0-9A-F]{6}$/);
    expect(document.querySelector('.jin-chroma-dialog__sv-map')?.getAttribute('aria-valuetext')).toContain('Saturation');
  });

  it('shows and announces live Hue, Saturation, and Brightness values', () => {
    const picker = createJinColorPicker({ value: 'accent', label: 'Color', onPick: vi.fn() });
    document.body.appendChild(picker.element);
    picker.element.querySelector<HTMLButtonElement>('[data-color="custom"]')!.click();
    const hue = document.querySelector<HTMLInputElement>('[aria-label="Hue"]')!;
    const saturation = document.querySelector<HTMLInputElement>('[aria-label="Saturation"]')!;
    const brightness = document.querySelector<HTMLInputElement>('[aria-label="Brightness"]')!;
    const outputs = [...document.querySelectorAll<HTMLOutputElement>('.jin-chroma-dialog__range-output')];
    expect(outputs).toHaveLength(3);
    expect([...document.querySelectorAll('.jin-chroma-dialog__range-header > span:first-child')].map(node => node.textContent)).toEqual(['Hue', 'Saturation', 'Brightness']);

    for (const degrees of [0, 120, 240, 360]) {
      hue.value = String(degrees); hue.dispatchEvent(new Event('input'));
      expect(outputs[0].value).toBe(`${degrees}°`);
      expect(hue.getAttribute('aria-valuetext')).toBe(`${degrees} degrees`);
      expect(hue.style.getPropertyValue('--jin-chroma-current-hue')).toBe(`hsl(${degrees} 100% 50%)`);
    }
    saturation.value = '25'; saturation.dispatchEvent(new Event('input'));
    brightness.value = '75'; brightness.dispatchEvent(new Event('input'));
    expect(outputs[1].value).toBe('25%');
    expect(outputs[2].value).toBe('75%');
    expect(saturation.getAttribute('aria-valuetext')).toBe('25%');
    expect(brightness.getAttribute('aria-valuetext')).toBe('75%');
    expect(document.querySelector('.jin-chroma-dialog__sv-map')?.getAttribute('aria-label')).toBe('Saturation and brightness map');
  });

  it('preserves HEX/RGB drafts and caret, defers short HEX normalization, and skips IME synchronization', () => {
    const onPick = vi.fn();
    const picker = createJinColorPicker({ value: '#336699', label: 'Color', onPick });
    document.body.appendChild(picker.element);
    picker.element.querySelector<HTMLButtonElement>('[data-color="custom"]')!.click();
    const hex = document.querySelector<HTMLInputElement>('[aria-label="HEX color"]')!;
    const rgb = [...document.querySelectorAll<HTMLInputElement>('.jin-chroma-dialog__rgb input')];
    const preview = document.querySelector<HTMLElement>('.jin-chroma-dialog__preview')!;
    const apply = [...document.querySelectorAll<HTMLButtonElement>('.jin-chroma-dialog__actions button')].find(button => button.textContent === 'Apply')!;

    const initialPreview = preview.style.backgroundColor;
    hex.value = '#123'; hex.setSelectionRange(4, 4); hex.dispatchEvent(new Event('input'));
    expect(hex.value).toBe('#123');
    expect(hex.selectionStart).toBe(4);
    expect(preview.style.backgroundColor).toBe(initialPreview);
    expect(apply.disabled).toBe(false);
    hex.dispatchEvent(new Event('blur'));
    expect(hex.value).toBe('#112233');

    rgb[0].value = '007'; rgb[0].dispatchEvent(new Event('input'));
    expect(rgb[0].value).toBe('007');
    expect(hex.value).toMatch(/^#[0-9A-F]{6}$/);
    rgb[0].dispatchEvent(new Event('change'));
    expect(rgb[0].value).toBe('7');

    const rgbBeforeComposition = rgb.map(input => input.value);
    hex.dispatchEvent(new CompositionEvent('compositionstart'));
    hex.value = '#abcdef'; hex.dispatchEvent(new InputEvent('input', { isComposing: true }));
    expect(rgb.map(input => input.value)).toEqual(rgbBeforeComposition);
    expect(hex.value).toBe('#abcdef');
    hex.dispatchEvent(new CompositionEvent('compositionend'));
    expect(rgb.map(input => input.value)).toEqual(['171', '205', '239']);
    expect(hex.value).toBe('#abcdef');
  });

  it('blocks invalid input, cancels without mutation, restores focus, applies once, and destroys ownership', () => {
    const onPick = vi.fn();
    const picker = createJinColorPicker({ value: 'accent', label: 'Color', onPick });
    document.body.appendChild(picker.element);
    const trigger = picker.element.querySelector<HTMLButtonElement>('[data-color="custom"]')!;
    trigger.focus(); trigger.click();
    const hex = document.querySelector<HTMLInputElement>('[aria-label="HEX color"]')!;
    const apply = [...document.querySelectorAll<HTMLButtonElement>('.jin-chroma-dialog__actions button')].find(button => button.textContent === 'Apply')!;
    hex.value = '#nope'; hex.dispatchEvent(new Event('input'));
    expect(apply.disabled).toBe(true);
    const error = document.querySelector<HTMLElement>('.jin-chroma-dialog__error')!;
    expect(error.textContent).toContain('valid HEX');
    expect(hex.getAttribute('aria-invalid')).toBe('true');
    expect(hex.getAttribute('aria-describedby')).toBe(error.id);
    hex.value = '#123456'; hex.dispatchEvent(new Event('input'));
    expect(hex.hasAttribute('aria-invalid')).toBe(false);
    expect(hex.hasAttribute('aria-describedby')).toBe(false);
    const [red, green] = [...document.querySelectorAll<HTMLInputElement>('.jin-chroma-dialog__rgb input')];
    red.value = '256'; green.value = ''; red.dispatchEvent(new Event('input'));
    expect(red.getAttribute('aria-invalid')).toBe('true');
    expect(green.hasAttribute('aria-invalid')).toBe(false);
    expect(green.getAttribute('aria-describedby')).toBe(error.id);
    expect(red.getAttribute('aria-describedby')).toBe(error.id);
    expect(hex.hasAttribute('aria-invalid')).toBe(false);
    red.value = '12'; green.value = '34'; red.dispatchEvent(new Event('input'));
    expect(red.hasAttribute('aria-invalid')).toBe(false);
    expect(green.hasAttribute('aria-describedby')).toBe(false);
    expect(apply.disabled).toBe(false);
    document.querySelector<HTMLButtonElement>('.jin-chroma-dialog__actions .btn-secondary')!.click();
    expect(onPick).not.toHaveBeenCalled(); expect(document.activeElement).toBe(trigger);

    trigger.click();
    const reopenedHex = document.querySelector<HTMLInputElement>('[aria-label="HEX color"]')!;
    reopenedHex.value = '#123'; reopenedHex.dispatchEvent(new Event('input'));
    const reopenedApply = [...document.querySelectorAll<HTMLButtonElement>('.jin-chroma-dialog__actions button')].find(button => button.textContent === 'Apply')!;
    reopenedApply.click(); reopenedApply.click();
    expect(onPick).toHaveBeenCalledTimes(1); expect(onPick).toHaveBeenCalledWith('#112233');
    expect(document.activeElement).toBe(trigger);
    picker.destroy(); expect(document.querySelector('.jin-chroma-dialog')).toBeNull();
  });
});

describe('exact calendar color preferences', () => {
  it('keeps Jin and same-named Google calendars from different accounts distinct', () => {
    const work = googleCalendarKey('work-account', 'primary');
    const personal = googleCalendarKey('personal-account', 'primary');
    saveCalendarColor(JIN_CALENDAR_KEY, 'purple');
    saveCalendarColor(work, 'orange');
    saveCalendarColor(personal, 'sky');
    expect(calendarColor(JIN_CALENDAR_KEY)).toBe('purple');
    expect(calendarColor(work)).toBe('orange');
    expect(calendarColor(personal)).toBe('sky');
  });

  it('resolves an event through account id plus calendar id and ignores invalid stored colors', () => {
    const key = googleCalendarKey('acct-work-01', 'team@example.com');
    localStorage.setItem(CALENDAR_COLOR_STORAGE_KEY, JSON.stringify({ [key]: 'pink', broken: 'neon' }));
    const event = {
      source: 'google',
      sync_context: {
        provider: 'google', account_id: 'acct-work-01', account_alias: 'Work',
        calendar_id: 'team@example.com', calendar_name: 'Team', access_role: 'writer',
        writable: true, state: 'synced',
      },
    };
    expect(calendarColorForEvent(event)).toBe('pink');
    expect(loadCalendarColors()).toEqual({ [key]: 'pink' });
  });

  it('round-trips canonical custom colors while retaining legacy-safe fallback', () => {
    saveCalendarColor(JIN_CALENDAR_KEY, '#A1B2C3');
    expect(calendarColor(JIN_CALENDAR_KEY)).toBe('#A1B2C3');
    localStorage.setItem(CALENDAR_COLOR_STORAGE_KEY, JSON.stringify({ jin: '#abc', old: 'unknown-value' }));
    expect(loadCalendarColors()).toEqual({ jin: '#AABBCC' });
    const event = document.createElement('button');
    applyCalendarColor(event, '#AABBCC');
    expect(event.dataset.calendarColor).toBe('custom');
    expect(event.style.getPropertyValue('--calendar-color-value')).toBe('#AABBCC');
  });
});
