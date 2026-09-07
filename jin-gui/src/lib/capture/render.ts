/**
 * capture/render.ts — DOM rendering helpers for capture and create forms.
 *
 * These are pure DOM operations: no invoke, no Stimulus.
 * CaptureController is the thin adapter that calls these.
 *
 * Tested by: src/__tests__/capture_controller.test.ts
 */

// ── Form error rendering ──────────────────────────────────────────────────────

/**
 * renderFormError — populate and show an inline error element.
 * The element is typically a <p> or <span> with class "hidden" when empty.
 * After calling this, the element is visible and has role="alert" so screen
 * readers announce it immediately.
 */
export function renderFormError(errorEl: HTMLElement, message: string): void {
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
  errorEl.setAttribute('role', 'alert');
  errorEl.setAttribute('aria-live', 'polite');
}

/**
 * clearFormError — hide and clear a single inline error element.
 */
export function clearFormError(errorEl: HTMLElement): void {
  errorEl.textContent = '';
  errorEl.classList.add('hidden');
  errorEl.removeAttribute('role');
  errorEl.removeAttribute('aria-live');
}

/**
 * renderFormSuccess — show a transient success/status message.
 */
export function renderFormSuccess(statusEl: HTMLElement, message: string): void {
  statusEl.textContent = message;
  statusEl.classList.remove('hidden');
  statusEl.setAttribute('role', 'status');
  statusEl.setAttribute('aria-live', 'polite');
}

/**
 * setFormBusy — disable/enable a submit button during an in-flight request.
 * Prevents double-submission; pairs with aria-busy for screen readers.
 */
export function setFormBusy(submitBtn: HTMLButtonElement, busy: boolean): void {
  submitBtn.disabled = busy;
  submitBtn.setAttribute('aria-busy', String(busy));
}

/**
 * clearAllFormErrors — clear all error elements in a form/dialog container.
 * Selects elements marked with data-form-error attribute.
 */
export function clearAllFormErrors(container: HTMLElement): void {
  const errorEls = container.querySelectorAll<HTMLElement>('[data-form-error]');
  for (const el of errorEls) {
    clearFormError(el);
  }
}
