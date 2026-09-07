/**
 * ui/tag_color_dialog.ts — TagColorDialog: JinModal subclass for picking a
 * tag's color (S8, AC-S8-02: wires the previously-dead `setTagColor(slug,
 * color)` bridge call).
 *
 * Reuses the exact same palette + swatch markup as the list color picker
 * (`ListsController.renderColorPicker`, `lib/lists/transform.ts`'s
 * `JIN_PALETTE`) — the story's own action plan says "reuse the list color
 * picker". Swatches are `.lists-color-swatch[data-color="..."]`, whose CSS
 * already maps every JIN_PALETTE token to a themed custom property
 * (`--sw`, browse.css) — no raw hex, legible in both light and dark themes
 * for free.
 *
 * Unlike the list color picker (which lives inside a bigger name+color EDIT
 * form and commits on a separate Save), this picker has nothing else to
 * edit: picking a swatch commits immediately and closes, exactly like a
 * native color picker.
 *
 * OCP: extends JinModal by calling setBody() after super() returns, avoiding
 * the template-method ordering hazard (buildBody/buildFooter run during
 * super() before subclass field assignments) — same pattern ConfirmDialog uses.
 */

import { JinModal, type JinModalOpts } from './modal';
import { createJinColorPicker, type JinColorPicker } from './color_picker';

export interface TagColorDialogOpts extends JinModalOpts {
  /** Initial color (a JIN_PALETTE token). Update dynamically via updateColor(). */
  color?: string;
  /** Initial label text (e.g. "Choose a color for #urgent"). Update via updateLabel(). */
  label?: string;
  /** Called with the picked color; the dialog closes immediately after. */
  onPick: (color: string) => void;
}

export class TagColorDialog extends JinModal {
  private _labelEl: HTMLParagraphElement | null = null;
  private _pickerEl: HTMLElement | null = null;
  private _currentColor: string;
  private readonly _onPick: (color: string) => void;
  private _picker: JinColorPicker | null = null;

  constructor(opts: TagColorDialogOpts) {
    super({
      title: opts.title ?? 'Tag Color',
      ariaLabel: opts.ariaLabel ?? 'Choose a tag color',
      host: opts.host ?? 'modal-root',
      closeOnBackdrop: opts.closeOnBackdrop,
      closeOnEscape: opts.closeOnEscape,
    });

    this._currentColor = opts.color ?? 'accent';
    this._onPick = opts.onPick;

    const body = document.createElement('div');
    body.className = 'tag-color-dialog__body';

    const label = document.createElement('p');
    label.className = 'action-dialog__message';
    label.textContent = opts.label ?? '';
    this._labelEl = label;
    body.appendChild(label);

    this._pickerEl = this._buildPicker();
    body.appendChild(this._pickerEl);

    this.setBody(body);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Update the current color's preselect (aria-pressed) before opening. */
  updateColor(color: string): void {
    this._currentColor = color;
    this._picker?.setValue(color);
  }

  /** Replace the label text (e.g. to name the tag being recolored). */
  updateLabel(text: string): void {
    if (this._labelEl) this._labelEl.textContent = text;
  }

  override destroy(): void {
    this._picker?.destroy();
    this._picker = null;
    super.destroy();
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private _buildPicker(): HTMLElement {
    this._picker = createJinColorPicker({
      value: this._currentColor,
      label: 'Choose a tag color',
      onPick: color => {
        this._onPick(color);
        this.close();
      },
    });
    const container = this._picker.element;
    container.classList.add('lists-color-picker');
    return container;
  }
}
