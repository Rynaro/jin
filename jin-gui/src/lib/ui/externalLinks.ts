import { isTauri } from '@tauri-apps/api/core';
import { openExternalUrl } from '../../invoke';

/** The same strict destination boundary is applied again in the native command. */
export function normalizeExternalUrl(raw: string): string | null {
  if (raw !== raw.trim() || /[\u0000-\u001f\u007f-\u009f]/.test(raw)) return null;
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

let installed = false;
let request: ((raw: string, origin?: HTMLElement) => void) | null = null;

/** Initialize once so Read and revision previews share one decision point. */
export function installExternalLinkService(): void {
  if (installed) return;
  installed = true;
  const dialog = document.createElement('dialog');
  dialog.className = 'action-dialog notes-external-dialog';
  dialog.setAttribute('aria-label', 'Open in browser?');
  const inner = document.createElement('div'); inner.className = 'action-dialog__inner notes-external-dialog__inner';
  const heading = document.createElement('h2'); heading.textContent = 'Open in browser?';
  const explanation = document.createElement('p'); explanation.textContent = 'Jin will stay open. This address will open in your default browser.';
  const destination = document.createElement('p'); destination.className = 'notes-external-dialog__destination';
  const status = document.createElement('p'); status.className = 'notes-external-dialog__status'; status.role = 'status';
  const actions = document.createElement('div'); actions.className = 'action-dialog__footer';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn-secondary'; cancel.textContent = 'Cancel';
  const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'btn-secondary'; copy.textContent = 'Copy address';
  const confirm = document.createElement('button'); confirm.type = 'button'; confirm.className = 'btn-primary'; confirm.textContent = 'Open in browser';
  actions.append(cancel, copy, confirm); inner.append(heading, explanation, destination, status, actions); dialog.append(inner); document.body.append(dialog);
  let currentUrl: string | null = null;
  let source: HTMLElement | null = null;
  let busy = false;
  let session = 0;
  const close = (): void => { if (!busy && dialog.open) dialog.close(); };
  const returnFocus = (): void => { session += 1; if (source?.isConnected) source.focus({ preventScroll: true }); source = null; currentUrl = null; status.textContent = ''; };
  dialog.addEventListener('close', returnFocus);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });
  cancel.addEventListener('click', close);
  copy.addEventListener('click', async () => {
    if (!currentUrl) return;
    const requestedSession = session;
    const address = currentUrl;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(address);
      if (requestedSession === session && dialog.open) status.textContent = 'Address copied.';
    } catch { if (requestedSession === session && dialog.open) status.textContent = 'Could not copy the address.'; }
  });
  confirm.addEventListener('click', async () => {
    if (!currentUrl || busy) return;
    busy = true; confirm.disabled = true; cancel.disabled = true; status.textContent = 'Opening…';
    try {
      if (isTauri()) await openExternalUrl(currentUrl);
      else {
        // A synchronous blank popup lets us detect blocking; sever its opener
        // before setting the remote address, and never navigate this document.
        const popup = window.open('about:blank', '_blank');
        if (!popup) throw new Error('Browser blocked the new tab');
        popup.opener = null;
        popup.location.replace(currentUrl);
      }
      busy = false; dialog.close();
    } catch {
      status.textContent = 'The browser could not open this address. Try again or copy it.';
      busy = false; confirm.disabled = false; cancel.disabled = false;
    }
  });
  request = (raw, origin) => {
    if (dialog.open) return;
    session += 1;
    source = origin ?? null;
    currentUrl = normalizeExternalUrl(raw);
    destination.textContent = currentUrl ?? raw;
    confirm.disabled = !currentUrl;
    cancel.disabled = false;
    status.textContent = currentUrl ? '' : 'Only complete http or https addresses can open in a browser.';
    dialog.showModal();
    cancel.focus();
  };

  const matchingAnchor = (target: EventTarget | null): HTMLAnchorElement | null => {
    if (!(target instanceof Element)) return null;
    const anchor = target.closest<HTMLAnchorElement>('a[href]');
    return anchor?.closest('.notes-detail-pane .cm-reading-wrapper, .notes-history__preview') ? anchor : null;
  };
  const intercept = (event: MouseEvent | KeyboardEvent): void => {
    const anchor = matchingAnchor(event.target);
    if (!anchor) return;
    event.preventDefault();
    event.stopPropagation();
    request?.(anchor.getAttribute('href') ?? '', anchor);
  };
  document.addEventListener('click', intercept, true);
  document.addEventListener('auxclick', intercept, true);
  document.addEventListener('contextmenu', intercept, true);
  document.addEventListener('keydown', (event) => { if (event.key === 'Enter' && matchingAnchor(event.target)) intercept(event); }, true);
}

/** Explicit Edit-card/link actions use the same confirmation as Read. */
export function confirmExternalLink(raw: string, origin?: HTMLElement): void {
  if (!installed) installExternalLinkService();
  request?.(raw, origin);
}
