/**
 * ui/confirm_dialog.ts — ConfirmDialog: JinModal subclass for destructive confirmations.
 *
 * Renders a message line (.action-dialog__message) and a Cancel + Confirm button pair.
 * The confirm button uses `.btn-danger` (cinnabar seal) for the danger variant.
 *
 * OCP: extends JinModal by calling setBody()/setFooter() after super() returns,
 * avoiding the template-method ordering hazard (buildBody/buildFooter are called
 * during super() before subclass field assignments run).
 *
 * LSP: honors the same open()/close()/destroy() contract as JinModal.
 *
 * Usage:
 *   const dialog = new ConfirmDialog({
 *     title: 'Delete Task',
 *     message: 'Delete "My Task"? This cannot be undone.',
 *     confirmLabel: 'Delete',
 *     variant: 'danger',
 *     onConfirm: () => void this.doDelete(),
 *   });
 *   dialog.updateMessage('Delete "Other Task"? This cannot be undone.');
 *   dialog.open();
 */

import { JinModal, type JinModalOpts } from './modal';

// ── Options ───────────────────────────────────────────────────────────────────

export interface ConfirmDialogOpts extends JinModalOpts {
  /** Initial message text. Update dynamically via updateMessage(). */
  message?: string;
  /** Label for the confirm button. Defaults to 'Confirm'. */
  confirmLabel?: string;
  cancelLabel?: string;
  checkboxLabel?: string;
  /**
   * 'danger' — confirm button uses .btn-danger (cinnabar seal accent) to signal
   *            a destructive action.
   * 'default' — confirm button uses .btn-primary (accent).
   */
  variant?: 'default' | 'danger';
  /** Called when the user clicks Confirm, before close(). */
  onConfirm?: (checked: boolean) => void;
}

// ── ConfirmDialog ─────────────────────────────────────────────────────────────

export class ConfirmDialog extends JinModal {
  /** Live message element — updated by updateMessage(). */
  private _messageEl: HTMLParagraphElement | null = null;
  /** Stored for re-confirmation after updateMessage calls. */
  private readonly _onConfirm: ((checked: boolean) => void) | undefined;
  private _checkbox: HTMLInputElement | null = null;

  constructor(opts: ConfirmDialogOpts = {}) {
    // Parent builds the shell (action-dialog__inner / __header / __body / __footer).
    // Body and footer slots are empty at this point (base buildBody/buildFooter
    // return null). We populate them below via setBody()/setFooter().
    super({
      title: opts.title,
      ariaLabel: opts.ariaLabel ?? opts.title,
      host: opts.host ?? 'modal-root',
      closeOnBackdrop: opts.closeOnBackdrop,
      closeOnEscape: opts.closeOnEscape,
    });

    this._onConfirm = opts.onConfirm;

    // ── Body: single message paragraph ───────────────────────────────────────
    const body = document.createElement('div');
    const msgEl = document.createElement('p');
    msgEl.className = 'action-dialog__message';
    msgEl.textContent = opts.message ?? '';
    this._messageEl = msgEl;
    body.appendChild(msgEl);
    if (opts.checkboxLabel) {
      const label = document.createElement('label');
      label.className = 'confirm-dialog__checkbox';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = false;
      const copy = document.createElement('span');
      copy.textContent = opts.checkboxLabel;
      label.appendChild(checkbox);
      label.appendChild(copy);
      body.appendChild(label);
      this._checkbox = checkbox;
    }
    this.setBody(body);

    // ── Footer: Cancel + Confirm ─────────────────────────────────────────────
    const footer = this._buildFooter(
      opts.confirmLabel ?? 'Confirm',
      opts.variant ?? 'default',
      opts.cancelLabel ?? 'Cancel',
    );
    this.setFooter(footer);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Replace the message text. Call before open() to customize per-invocation
   * (e.g., include the task title in the confirmation prompt).
   */
  updateMessage(text: string): void {
    if (this._messageEl) {
      this._messageEl.textContent = text;
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private _buildFooter(
    confirmLabel: string,
    variant: 'default' | 'danger',
    cancelLabel: string,
  ): HTMLElement {
    const container = document.createElement('div');

    // Cancel — closes without running onConfirm
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-secondary';
    cancelBtn.textContent = cancelLabel;
    cancelBtn.addEventListener('click', () => this.close());

    // Confirm — runs onConfirm callback, then closes
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = variant === 'danger' ? 'btn-danger' : 'btn-primary';
    confirmBtn.textContent = confirmLabel;
    confirmBtn.addEventListener('click', () => {
      this._onConfirm?.(this._checkbox?.checked ?? false);
      this.close();
    });

    container.appendChild(cancelBtn);
    container.appendChild(confirmBtn);
    return container;
  }
}
