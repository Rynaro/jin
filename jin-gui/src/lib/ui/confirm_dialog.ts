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
  onCheckboxChange?: (checked: boolean) => void;
  selectLabel?: string;
  selectOptions?: Array<{ value: string; label: string }>;
  /** Whether the optional select begins visible. */
  selectVisible?: boolean;
  /** Optional, structured context shown between the message and choices. */
  bodyContent?: HTMLElement;
  /** Additional class on the dialog for a product-specific presentation. */
  className?: string;
  /** A mutually exclusive choice group for confirmations with distinct scopes. */
  choiceLabel?: string;
  choiceOptions?: Array<{ value: string; label: string; description?: string }>;
  choiceValue?: string;
  onChoiceChange?: (value: string) => void;
  /** Shown inline when an asynchronous confirmation cannot be completed. */
  failureMessage?: string;
  /** Localized accessible label for the standard close control. */
  closeLabel?: string;
  /**
   * 'danger' — confirm button uses .btn-danger (cinnabar seal accent) to signal
   *            a destructive action.
   * 'default' — confirm button uses .btn-primary (accent).
   */
  variant?: 'default' | 'danger';
  /** Called when the user clicks Confirm, before close(). */
  onConfirm?: (checked: boolean, selectedValue?: string, choiceValue?: string) => void | Promise<void>;
}

// ── ConfirmDialog ─────────────────────────────────────────────────────────────

export class ConfirmDialog extends JinModal {
  /** Live message element — updated by updateMessage(). */
  private _messageEl: HTMLParagraphElement | null = null;
  /** Stored for re-confirmation after updateMessage calls. */
  private readonly _onConfirm: ((checked: boolean, selectedValue?: string, choiceValue?: string) => void | Promise<void>) | undefined;
  private _checkbox: HTMLInputElement | null = null;
  private _select: HTMLSelectElement | null = null;
  private _selectField: HTMLLabelElement | null = null;
  private _choice: HTMLInputElement | null = null;
  private _confirmButton: HTMLButtonElement | null = null;
  private _cancelButton: HTMLButtonElement | null = null;
  private _failureEl: HTMLParagraphElement | null = null;
  private _submitting = false;

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
    if (opts.className) this.dialog.classList.add(opts.className);
    if (opts.closeLabel) {
      this.dialog.querySelector<HTMLButtonElement>('.modal-close-btn')?.setAttribute('aria-label', opts.closeLabel);
    }
    // A destructive mutation remains visible until it settles.  The base modal
    // owns Escape/backdrop dismissal, so stop those paths while a request is in
    // flight; otherwise a failure would lose its retry context.
    this.dialog.addEventListener('cancel', event => {
      if (!this._submitting) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    this.dialog.addEventListener('click', event => {
      if (this._submitting && event.target === this.dialog) event.stopImmediatePropagation();
    }, true);

    this._onConfirm = opts.onConfirm;

    // ── Body: single message paragraph ───────────────────────────────────────
    const body = document.createElement('div');
    body.className = 'confirm-dialog__content';
    const msgEl = document.createElement('p');
    msgEl.className = 'action-dialog__message';
    msgEl.textContent = opts.message ?? '';
    this._messageEl = msgEl;
    body.appendChild(msgEl);
    if (opts.bodyContent) body.appendChild(opts.bodyContent);
    if (opts.choiceOptions?.length) {
      const group = document.createElement('fieldset');
      group.className = 'confirm-dialog__choices';
      const legend = document.createElement('legend');
      legend.textContent = opts.choiceLabel ?? '';
      group.appendChild(legend);
      const choiceName = `confirm-choice-${crypto.randomUUID()}`;
      for (const [index, option] of opts.choiceOptions.entries()) {
        const label = document.createElement('label');
        label.className = 'confirm-dialog__choice';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = choiceName;
        input.value = option.value;
        input.checked = option.value === (opts.choiceValue ?? opts.choiceOptions[0].value);
        const copy = document.createElement('span');
        const title = document.createElement('strong');
        title.textContent = option.label;
        copy.appendChild(title);
        if (option.description) {
          const description = document.createElement('small');
          description.textContent = option.description;
          copy.appendChild(description);
        }
        label.append(input, copy);
        group.appendChild(label);
        if (input.checked || index === 0) this._choice = input;
      }
      group.addEventListener('change', () => {
        this._choice = group.querySelector<HTMLInputElement>('input:checked');
        if (this._choice) opts.onChoiceChange?.(this._choice.value);
      });
      body.appendChild(group);
    }
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
      checkbox.addEventListener('change', () => opts.onCheckboxChange?.(checkbox.checked));
    }
    if (opts.selectOptions?.length) {
      const label = document.createElement('label');
      label.className = 'confirm-dialog__select';
      const copy = document.createElement('span');
      copy.textContent = opts.selectLabel ?? '';
      const select = document.createElement('select');
      select.className = 'form-input';
      for (const option of opts.selectOptions) select.appendChild(new Option(option.label, option.value));
      label.append(copy, select);
      label.hidden = opts.selectVisible === false;
      body.appendChild(label);
      this._select = select;
      this._selectField = label;
    }
    const failure = document.createElement('p');
    failure.className = 'confirm-dialog__failure';
    failure.setAttribute('role', 'alert');
    failure.hidden = true;
    this._failureEl = failure;
    body.appendChild(failure);
    this.setBody(body);

    // ── Footer: Cancel + Confirm ─────────────────────────────────────────────
    const footer = this._buildFooter(
      opts.confirmLabel ?? 'Confirm',
      opts.variant ?? 'default',
      opts.cancelLabel ?? 'Cancel',
      opts.failureMessage,
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

  /** Show or hide the optional selector without changing its chosen value. */
  setSelectVisible(visible: boolean): void {
    if (this._selectField) this._selectField.hidden = !visible;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private _buildFooter(
    confirmLabel: string,
    variant: 'default' | 'danger',
    cancelLabel: string,
    failureMessage?: string,
  ): HTMLElement {
    const container = document.createElement('div');
    container.className = 'confirm-dialog__actions';

    // Cancel — closes without running onConfirm
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-secondary';
    cancelBtn.textContent = cancelLabel;
    cancelBtn.addEventListener('click', () => {
      if (!this._submitting) this.close();
    });
    this._cancelButton = cancelBtn;

    // Confirm — runs onConfirm callback, then closes
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = variant === 'danger' ? 'btn-danger' : 'btn-primary';
    confirmBtn.textContent = confirmLabel;
    confirmBtn.addEventListener('click', () => this._confirm(failureMessage));
    this._confirmButton = confirmBtn;

    container.appendChild(cancelBtn);
    container.appendChild(confirmBtn);
    return container;
  }

  private async _confirm(failureMessage?: string): Promise<void> {
    if (this._submitting) return;
    this._failureEl?.toggleAttribute('hidden', true);
    try {
      const outcome = this._onConfirm?.(
        this._checkbox?.checked ?? false,
        this._select?.value,
        this._choice?.value,
      );
      if (outcome && typeof (outcome as Promise<void>).then === 'function') {
        this._setSubmitting(true);
        await outcome;
      }
      this.close();
    } catch {
      this._failureEl!.textContent = failureMessage ?? 'Could not complete this action. Try again.';
      this._failureEl!.hidden = false;
      this._setSubmitting(false);
      this._confirmButton?.focus();
    }
  }

  private _setSubmitting(submitting: boolean): void {
    this._submitting = submitting;
    this.dialog.toggleAttribute('aria-busy', submitting);
    if (this._confirmButton) this._confirmButton.disabled = submitting;
    if (this._cancelButton) this._cancelButton.disabled = submitting;
    const close = this.dialog.querySelector<HTMLButtonElement>('.modal-close-btn');
    if (close) close.disabled = submitting;
  }
}
