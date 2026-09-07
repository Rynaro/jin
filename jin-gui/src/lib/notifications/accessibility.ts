/** Focus and announcement primitives shared by the Notification Center UI and tests. */

export function focusableDialogControls(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((control) => !control.hasAttribute('hidden'));
}

/** Keep Tab/Shift+Tab inside an open recurrence dialog. */
export function trapDialogFocus(dialog: HTMLElement, event: KeyboardEvent): boolean {
  if (event.key !== 'Tab') return false;
  const controls = focusableDialogControls(dialog);
  if (controls.length === 0) return false;
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
    return true;
  }
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
    return true;
  }
  return false;
}

/** Update a polite live region only when its message changes. */
export function announceNotification(region: HTMLElement, message: string): boolean {
  if (region.textContent === message) return false;
  region.textContent = message;
  return true;
}

/** Restore action focus after rerender, falling back to the detail heading. */
export function restoreNotificationFocus(
  detail: HTMLElement,
  action: string | null,
): HTMLElement | null {
  const replacement = action
    ? detail.querySelector<HTMLElement>(`[data-notification-action="${action}"]:not([disabled])`)
    : null;
  const target = replacement
    ?? detail.querySelector<HTMLElement>('[data-notification-detail-heading]');
  target?.focus();
  return target;
}
