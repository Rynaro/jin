import { JinModal } from './modal';

export const JIN_PALETTE = [
  'accent', 'sky', 'danger', 'warning', 'success', 'purple', 'pink', 'orange',
] as const;

export type JinPaletteColor = (typeof JIN_PALETTE)[number];
export type JinColor = JinPaletteColor | `#${string}`;

export function isJinPaletteColor(color: string): color is JinPaletteColor {
  return (JIN_PALETTE as readonly string[]).includes(color);
}

/** Accept semantic tokens plus three/six-digit HEX, returning one persisted form. */
export function normalizeJinColor(input: string): JinColor | null {
  const value = input.trim();
  const token = value.toLowerCase();
  if (isJinPaletteColor(token)) return token;
  const short = /^#([0-9a-f]{3})$/i.exec(value)?.[1];
  if (short) return `#${[...short].map(char => char.repeat(2)).join('').toUpperCase()}`;
  const full = /^#([0-9a-f]{6})$/i.exec(value)?.[1];
  return full ? `#${full.toUpperCase()}` : null;
}

/** Apply only a validated color to a CSS custom property; invalid reads fall back safely. */
export function applyJinColor(element: HTMLElement, color: string, property = '--sw'): JinColor {
  const normalized = normalizeJinColor(color) ?? 'accent';
  if (isJinPaletteColor(normalized)) {
    element.dataset.color = normalized;
    element.style.removeProperty(property);
  } else {
    element.dataset.color = 'custom';
    element.style.setProperty(property, normalized);
  }
  return normalized;
}

interface Rgb { r: number; g: number; b: number }
interface Hsv { h: number; s: number; v: number }

let chromaDialogSequence = 0;

function hexToRgb(hex: string): Rgb {
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}

function rgbToHex({ r, g, b }: Rgb): `#${string}` {
  return `#${[r, g, b].map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const channels = [r, g, b].map(channel => channel / 255);
  const max = Math.max(...channels); const min = Math.min(...channels); const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === channels[0]) h = 60 * (((channels[1] - channels[2]) / delta) % 6);
    else if (max === channels[1]) h = 60 * (((channels[2] - channels[0]) / delta) + 2);
    else h = 60 * (((channels[0] - channels[1]) / delta) + 4);
  }
  return { h: Math.round((h + 360) % 360), s: Math.round(max ? (delta / max) * 100 : 0), v: Math.round(max * 100) };
}

function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const saturation = s / 100; const value = v / 100;
  const c = value * saturation; const x = c * (1 - Math.abs(((h / 60) % 2) - 1)); const m = value - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

class JinChromaDialog {
  private readonly modal: JinModal;
  private readonly preview = document.createElement('span');
  private readonly hex = document.createElement('input');
  private readonly rgb = ['Red', 'Green', 'Blue'].map(() => document.createElement('input'));
  private readonly hue = document.createElement('input');
  private readonly saturation = document.createElement('input');
  private readonly value = document.createElement('input');
  private readonly hueOutput = document.createElement('output');
  private readonly saturationOutput = document.createElement('output');
  private readonly valueOutput = document.createElement('output');
  private readonly map = document.createElement('div');
  private readonly mapThumb = document.createElement('span');
  private readonly error = document.createElement('p');
  private readonly apply = document.createElement('button');
  private readonly errorId = `jin-chroma-error-${++chromaDialogSequence}`;
  private readonly composing = new Set<HTMLInputElement>();
  private color: JinColor = rgbToHex(hsvToRgb({ h: 220, s: 60, v: 80 }));
  private hsv: Hsv = rgbToHsv(hexToRgb(this.color));
  private draftSource: HTMLInputElement | null = null;
  private callback: ((color: JinColor) => void) | null = null;

  constructor() {
    this.modal = new JinModal({ title: 'Custom Color', ariaLabel: 'Choose a custom color' });
    this.modal.setBody(this.buildBody());
    this.modal.setFooter(this.buildFooter());
  }

  open(initial: string, callback: (color: JinColor) => void): void {
    this.callback = callback;
    const normalized = normalizeJinColor(initial);
    if (normalized && !isJinPaletteColor(normalized)) this.setRgb(hexToRgb(normalized));
    else this.setHsv({ h: 220, s: 60, v: 80 });
    this.modal.open();
  }

  destroy(): void { this.callback = null; this.modal.destroy(); }

  private buildBody(): HTMLElement {
    const body = document.createElement('div'); body.className = 'jin-chroma-dialog';
    this.preview.className = 'jin-chroma-dialog__preview'; this.preview.setAttribute('aria-hidden', 'true');
    this.map.className = 'jin-chroma-dialog__sv-map'; this.map.tabIndex = 0;
    this.map.setAttribute('role', 'slider'); this.map.setAttribute('aria-label', 'Saturation and brightness map');
    this.mapThumb.className = 'jin-chroma-dialog__sv-thumb'; this.map.appendChild(this.mapThumb);
    this.map.addEventListener('pointerdown', event => {
      this.map.setPointerCapture?.(event.pointerId);
      this.pickMap(event);
    });
    this.map.addEventListener('pointermove', event => { if (event.buttons === 1) this.pickMap(event); });
    this.map.addEventListener('keydown', event => this.keyMap(event));
    this.configureRange(this.hue, 'Hue', 0, 360); this.configureRange(this.saturation, 'Saturation', 0, 100); this.configureRange(this.value, 'Brightness', 0, 100);
    this.hue.classList.add('jin-chroma-dialog__hue');
    [this.hue, this.saturation, this.value].forEach(input => input.addEventListener('input', () => this.readHsv()));
    const ranges = document.createElement('div'); ranges.className = 'jin-chroma-dialog__ranges';
    ranges.append(
      this.rangeLabeled('Hue', this.hue, this.hueOutput, true),
      this.rangeLabeled('Saturation', this.saturation, this.saturationOutput),
      this.rangeLabeled('Brightness', this.value, this.valueOutput),
    );
    this.hex.className = 'form-input jin-chroma-dialog__hex'; this.hex.setAttribute('aria-label', 'HEX color'); this.hex.placeholder = '#RRGGBB';
    this.configureDraftInput(this.hex, () => this.readHex(false), () => this.readHex(true));
    const rgbRow = document.createElement('div'); rgbRow.className = 'jin-chroma-dialog__rgb';
    this.rgb.forEach((input, index) => {
      input.type = 'number'; input.className = 'form-input'; input.min = '0'; input.max = '255'; input.step = '1';
      input.setAttribute('aria-label', `${['Red', 'Green', 'Blue'][index]} channel`);
      this.configureDraftInput(input, () => this.readRgb(input, false), () => this.readRgb(input, true));
      rgbRow.appendChild(this.labeled(['R', 'G', 'B'][index], input));
    });
    const inputs = document.createElement('div'); inputs.className = 'jin-chroma-dialog__inputs'; inputs.append(this.labeled('HEX', this.hex), rgbRow);
    this.error.id = this.errorId; this.error.className = 'form-error jin-chroma-dialog__error'; this.error.setAttribute('role', 'alert'); this.error.setAttribute('aria-live', 'polite');
    body.append(this.preview, this.map, ranges, inputs, this.error); return body;
  }

  private buildFooter(): HTMLElement {
    const footer = document.createElement('div'); footer.className = 'jin-chroma-dialog__actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn-secondary'; cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => { this.callback = null; this.modal.close(); });
    this.apply.type = 'button'; this.apply.className = 'btn-primary'; this.apply.textContent = 'Apply';
    this.apply.addEventListener('click', () => {
      if (this.apply.disabled || !this.callback) return;
      if (!this.commitDraft()) return;
      const callback = this.callback; const color = this.color; this.callback = null;
      this.modal.close(); callback(color);
    });
    footer.append(cancel, this.apply); return footer;
  }

  private labeled(text: string, input: HTMLInputElement): HTMLLabelElement {
    const label = document.createElement('label'); const span = document.createElement('span'); span.textContent = text; label.append(span, input); return label;
  }

  private rangeLabeled(text: string, input: HTMLInputElement, output: HTMLOutputElement, fullRow = false): HTMLLabelElement {
    const label = document.createElement('label'); label.className = 'jin-chroma-dialog__range';
    if (fullRow) label.classList.add('jin-chroma-dialog__range--full');
    const header = document.createElement('span'); header.className = 'jin-chroma-dialog__range-header';
    const name = document.createElement('span'); name.textContent = text;
    output.className = 'jin-chroma-dialog__range-output'; output.setAttribute('for', input.id);
    header.append(name, output); label.append(header, input); return label;
  }

  private configureRange(input: HTMLInputElement, label: string, min: number, max: number): void {
    input.type = 'range'; input.id = `${this.errorId}-${label.toLowerCase()}`;
    input.min = String(min); input.max = String(max); input.step = '1'; input.setAttribute('aria-label', label);
  }

  private configureDraftInput(input: HTMLInputElement, read: () => void, commit: () => void): void {
    input.addEventListener('compositionstart', () => this.composing.add(input));
    input.addEventListener('compositionend', () => { this.composing.delete(input); read(); });
    input.addEventListener('input', () => { if (!this.composing.has(input)) read(); });
    input.addEventListener('change', commit);
    input.addEventListener('blur', commit);
  }

  private readHex(commit: boolean): boolean {
    this.draftSource = this.hex;
    const normalized = normalizeJinColor(this.hex.value);
    if (normalized && !isJinPaletteColor(normalized)) {
      if (!commit && /^#[0-9a-f]{3}$/i.test(this.hex.value.trim())) {
        this.clearInvalid(); this.apply.disabled = false; return true;
      }
      this.setRgb(hexToRgb(normalized), commit ? null : this.hex);
      if (commit) this.draftSource = null;
      return true;
    }
    const value = this.hex.value.trim();
    const incomplete = value === '' || /^#[0-9a-f]{0,2}$/i.test(value) || /^#[0-9a-f]{4,5}$/i.test(value);
    this.invalidate(
      incomplete ? 'Complete the HEX color using 3 or 6 digits.' : 'Enter a valid HEX color such as #3A7BD5.',
      incomplete ? [] : [this.hex],
      incomplete ? [this.hex] : [],
    );
    return false;
  }

  private readRgb(source: HTMLInputElement, commit: boolean): boolean {
    this.draftSource = source;
    const values = this.rgb.map(input => Number(input.value));
    const incompleteInputs = this.rgb.filter(input => input.value.trim() === '');
    const invalidInputs = this.rgb.filter((input, index) => input.value.trim() !== '' && (!Number.isInteger(values[index]) || values[index] < 0 || values[index] > 255));
    if (incompleteInputs.length || invalidInputs.length) {
      this.invalidate('RGB channels must be whole numbers from 0 to 255.', invalidInputs, incompleteInputs);
      return false;
    }
    this.setRgb({ r: values[0], g: values[1], b: values[2] }, commit ? null : source);
    if (commit) this.draftSource = null;
    return true;
  }

  private readHsv(): void { this.setHsv({ h: Number(this.hue.value), s: Number(this.saturation.value), v: Number(this.value.value) }); }

  private pickMap(event: PointerEvent): void {
    const rect = this.map.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    this.setHsv({ ...this.hsv, s: Math.round(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * 100), v: Math.round((1 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))) * 100) });
  }

  private keyMap(event: KeyboardEvent): void {
    const amount = event.shiftKey ? 10 : 1; const next = { ...this.hsv };
    if (event.key === 'ArrowLeft') next.s -= amount; else if (event.key === 'ArrowRight') next.s += amount;
    else if (event.key === 'ArrowDown') next.v -= amount; else if (event.key === 'ArrowUp') next.v += amount; else return;
    event.preventDefault(); next.s = Math.max(0, Math.min(100, next.s)); next.v = Math.max(0, Math.min(100, next.v)); this.setHsv(next);
  }

  private commitDraft(): boolean {
    if (this.draftSource === this.hex) return this.readHex(true);
    if (this.draftSource && this.rgb.includes(this.draftSource)) return this.readRgb(this.draftSource, true);
    return true;
  }

  private setRgb(rgb: Rgb, source: HTMLInputElement | null = null): void { this.setHsv(rgbToHsv(rgb), rgbToHex(rgb), source); }

  private setHsv(hsv: Hsv, exactHex?: JinColor, source: HTMLInputElement | null = null): void {
    if (!source) this.draftSource = null;
    this.hsv = hsv; this.color = exactHex ?? rgbToHex(hsvToRgb(hsv)); const rgb = hexToRgb(this.color);
    if (source !== this.hex) this.hex.value = this.color;
    [rgb.r, rgb.g, rgb.b].forEach((channel, index) => { if (source !== this.rgb[index]) this.rgb[index].value = String(channel); });
    this.hue.value = String(hsv.h); this.saturation.value = String(hsv.s); this.value.value = String(hsv.v);
    this.hueOutput.value = `${hsv.h}°`; this.saturationOutput.value = `${hsv.s}%`; this.valueOutput.value = `${hsv.v}%`;
    this.hue.setAttribute('aria-valuetext', `${hsv.h} degrees`); this.saturation.setAttribute('aria-valuetext', `${hsv.s}%`); this.value.setAttribute('aria-valuetext', `${hsv.v}%`);
    this.hue.style.setProperty('--jin-chroma-current-hue', `hsl(${hsv.h} 100% 50%)`);
    this.preview.style.backgroundColor = this.color; this.map.style.setProperty('--jin-chroma-hue', `hsl(${hsv.h} 100% 50%)`);
    this.mapThumb.style.setProperty('--jin-chroma-saturation', `${hsv.s}%`); this.mapThumb.style.setProperty('--jin-chroma-value', `${100 - hsv.v}%`);
    this.map.setAttribute('aria-valuemin', '0'); this.map.setAttribute('aria-valuemax', '100'); this.map.setAttribute('aria-valuenow', String(hsv.s));
    this.map.setAttribute('aria-valuetext', `Saturation ${hsv.s}%, brightness ${hsv.v}%`); this.clearInvalid(); this.apply.disabled = false;
  }

  private clearInvalid(): void {
    [this.hex, ...this.rgb].forEach(input => { input.removeAttribute('aria-invalid'); input.removeAttribute('aria-describedby'); });
    this.error.textContent = '';
  }

  private invalidate(message: string, invalidInputs: HTMLInputElement[], incompleteInputs: HTMLInputElement[] = []): void {
    this.clearInvalid(); this.error.textContent = message; this.apply.disabled = true;
    invalidInputs.forEach(input => { input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', this.errorId); });
    incompleteInputs.forEach(input => input.setAttribute('aria-describedby', this.errorId));
  }
}

export interface JinColorPickerOptions { value?: string; label: string; onPick: (color: JinColor) => void }
export interface JinColorPicker { element: HTMLElement; setValue: (color: string) => void; destroy: () => void }

export function createJinColorPicker(options: JinColorPickerOptions): JinColorPicker {
  const element = document.createElement('div'); element.className = 'jin-color-picker'; element.setAttribute('role', 'group'); element.setAttribute('aria-label', options.label);
  let value = normalizeJinColor(options.value ?? '') ?? 'accent'; let chroma: JinChromaDialog | null = null;
  const setValue = (color: string): void => {
    value = normalizeJinColor(color) ?? 'accent';
    element.querySelectorAll<HTMLButtonElement>('.jin-color-swatch').forEach(swatch => {
      const selected = isJinPaletteColor(value) ? swatch.dataset.color === value : swatch.dataset.color === 'custom';
      swatch.setAttribute('aria-pressed', String(selected));
      if (swatch.dataset.color === 'custom') {
        if (!isJinPaletteColor(value)) swatch.style.setProperty('--custom-preview', value); else swatch.style.removeProperty('--custom-preview');
      }
    });
  };
  for (const color of JIN_PALETTE) {
    const swatch = document.createElement('button'); swatch.type = 'button'; swatch.className = 'jin-color-swatch lists-color-swatch tap-target'; swatch.dataset.color = color;
    swatch.setAttribute('aria-label', `Color: ${color}`); swatch.addEventListener('click', () => { setValue(color); options.onPick(color); }); element.appendChild(swatch);
  }
  const custom = document.createElement('button'); custom.type = 'button'; custom.className = 'jin-color-swatch jin-color-swatch--custom tap-target'; custom.dataset.color = 'custom';
  custom.setAttribute('aria-label', 'Choose a custom color'); custom.addEventListener('click', () => {
    chroma ??= new JinChromaDialog(); chroma.open(value, color => { setValue(color); options.onPick(color); });
  });
  element.appendChild(custom); setValue(value);
  return { element, setValue, destroy: () => { chroma?.destroy(); chroma = null; } };
}
