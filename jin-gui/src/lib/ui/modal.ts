/**
 * ui/modal.ts — JinModal: reusable modal base primitive (SOLID, framework-free).
 *
 * Implements the §5.1 architecture from the SPECTRA todo-defect-fixes spec.
 * Controllers hold a DIRECT reference (composition) — never a Stimulus target/action.
 * This breaks the target-scoping dependency that caused DT-2.
 *
 * Usage (new dialog):
 *   const modal = new JinModal({ title: 'Confirm', ariaLabel: 'Confirm action' });
 *   modal.open();
 *
 * Usage (adopt existing dialog):
 *   const modal = JinModal.fromElement(dialogEl, { host: 'in-place', onPrimary: () => save() });
 *
 * SOLID mapping:
 *   SRP — JinModal owns only the shell, lifecycle, and a11y; content is a subclass concern.
 *   OCP — subclasses override buildBody()/buildFooter()/on*() hooks; base is never edited.
 *   LSP — every subclass honors the same open/close/destroy contract.
 *   ISP — narrow surface: open, close, destroy, setBody, setFooter + lifecycle hooks.
 *   DIP — controllers depend on the JinModal abstraction, not on concrete DOM or Stimulus targets.
 *
 * Lucide 'x' glyph: verified registered in src/lib/icons/index.ts (import X + map entry).
 */

import { initIcons } from '../icons';

// ── Public options interface ──────────────────────────────────────────────────

export interface JinModalOpts {
  /** Dialog title text rendered in the .action-dialog__header. */
  title?: string;
  /** aria-label for the <dialog> element (screen-reader announcement). */
  ariaLabel?: string;
  /** Whether clicking the backdrop (e.target === dialog) closes it (default true). */
  closeOnBackdrop?: boolean;
  /** Whether pressing Escape (the native cancel event) closes it (default true). */
  closeOnEscape?: boolean;
  /**
   * Where to host the dialog element:
   *   'modal-root' (default) — appends to / relocates to #jin-modal-root.
   *   'in-place'             — dialog stays where it is in the DOM. Required for
   *                            shared dialogs used by multiple controllers (e.g. the
   *                            shared dueDateDialog nested inside capture).
   */
  host?: 'modal-root' | 'in-place';
  /**
   * Primary button callback — used by fromElement() to re-wire an existing .btn-primary.
   * Subclasses building their own footer should wire buttons inside buildFooter() instead.
   */
  onPrimary?: () => void;
  /**
   * Secondary button callback — used by fromElement() to re-wire an existing .btn-secondary.
   */
  onSecondary?: () => void;
}

// ── ensureModalRoot ───────────────────────────────────────────────────────────

/**
 * Ensures a singleton #jin-modal-root <div> exists on document.body.
 * Returns the existing element if already present (idempotent).
 * Every JinModal appends its <dialog> here → one stacking/backdrop context,
 * completely independent of any Stimulus controller subtree.
 */
export function ensureModalRoot(): HTMLElement {
  const existing = document.getElementById('jin-modal-root');
  if (existing) return existing as HTMLElement;
  const root = document.createElement('div');
  root.id = 'jin-modal-root';
  document.body.appendChild(root);
  return root;
}

// ── JinModal ──────────────────────────────────────────────────────────────────

export class JinModal {
  /** The managed <dialog> element. Subclasses may read but must not replace it. */
  protected dialog!: HTMLDialogElement;

  // Content slots — may be null for dialogs adopted via fromElement() whose
  // existing markup does not include these class names.
  private _bodySlot: HTMLElement | null = null;
  private _footerSlot: HTMLElement | null = null;

  // Options
  private _closeOnBackdrop: boolean = true;
  private _closeOnEscape: boolean = true;

  // A11y — save and restore the element that was focused before open()
  private _priorFocus: Element | null = null;

  // Bound event handlers stored for cleanup in destroy()
  private _backdropHandler: EventListener = () => {};
  private _cancelHandler: EventListener = () => {};

  // ── Constructor (fresh dialog) ────────────────────────────────────────────────

  /**
   * Create a new JinModal with a freshly created <dialog> skeleton.
   * The dialog is appended to #jin-modal-root (created if needed).
   *
   * Override buildBody() / buildFooter() in a subclass to populate the slots
   * without modifying the base class (OCP).
   */
  constructor(opts: JinModalOpts = {}) {
    this._closeOnBackdrop = opts.closeOnBackdrop ?? true;
    this._closeOnEscape = opts.closeOnEscape ?? true;

    const { dialog, bodySlot, footerSlot, closeBtn } = JinModal._buildShell(
      opts.title,
      opts.ariaLabel,
    );
    this.dialog = dialog;
    this._bodySlot = bodySlot;
    this._footerSlot = footerSlot;

    // Wire the X close button before template methods run so subclass
    // implementations of buildFooter() can already rely on the header being wired.
    closeBtn.addEventListener('click', () => this.close());

    // OCP: let subclasses populate body and footer without editing the base.
    const body = this.buildBody();
    if (body) this._bodySlot.appendChild(body);

    const footer = this.buildFooter();
    if (footer) this._footerSlot.appendChild(footer);

    // Wire backdrop-click + Escape handlers
    this._attachEventListeners();

    // Add to the singleton modal root (or leave in place if host:'in-place')
    if ((opts.host ?? 'modal-root') === 'modal-root') {
      ensureModalRoot().appendChild(this.dialog);
    }
    // Fresh modals are created after the app-wide startup hydration pass.
    // Hydrate their Lucide close placeholder once it is mounted so the
    // accessible Close control is also visually recognizable.
    initIcons(this.dialog);
  }

  // ── Static factory — adopt existing dialog ────────────────────────────────────

  /**
   * Wrap an existing <dialog> element with the JinModal lifecycle.
   *
   * - Strips any Stimulus `data-action` wiring from buttons inside the dialog
   *   (so the controller no longer needs to be the subtree parent).
   * - Re-wires opts.onPrimary / opts.onSecondary to .btn-primary / .btn-secondary.
   * - By default, relocates the dialog to #jin-modal-root. Pass host:'in-place'
   *   to keep it where it is (required for the shared dueDateDialog so the
   *   nested `calendar` controller and the `capture` controller keep working).
   */
  static fromElement(
    dialogEl: HTMLDialogElement,
    opts: JinModalOpts = {},
  ): JinModal {
    // Bypass the constructor (which builds a fresh shell) via Object.create.
    // TypeScript `private` keyword permits access from within the class body
    // (including static methods), so all fields can be set manually below.
    const instance = Object.create(JinModal.prototype) as JinModal;

    instance._closeOnBackdrop = opts.closeOnBackdrop ?? true;
    instance._closeOnEscape = opts.closeOnEscape ?? true;
    instance._priorFocus = null;
    instance.dialog = dialogEl;
    instance._bodySlot =
      dialogEl.querySelector<HTMLElement>('.action-dialog__body');
    instance._footerSlot =
      dialogEl.querySelector<HTMLElement>('.action-dialog__footer');
    // _backdropHandler and _cancelHandler are set by _attachEventListeners() below

    // Strip Stimulus data-action wiring from every button/element in the dialog
    dialogEl.querySelectorAll<HTMLElement>('[data-action]').forEach((el) => {
      el.removeAttribute('data-action');
    });

    // Re-wire primary/secondary buttons to the injected callbacks
    if (opts.onPrimary) {
      dialogEl
        .querySelector<HTMLButtonElement>('.btn-primary')
        ?.addEventListener('click', opts.onPrimary);
    }
    if (opts.onSecondary) {
      dialogEl
        .querySelector<HTMLButtonElement>('.btn-secondary')
        ?.addEventListener('click', opts.onSecondary);
    }

    // Wire the modal close button if the adopted dialog has one
    dialogEl
      .querySelector<HTMLButtonElement>('.modal-close-btn')
      ?.addEventListener('click', () => instance.close());

    // Wire backdrop-click + Escape handlers
    instance._attachEventListeners();

    // Relocate to #jin-modal-root (or leave in place)
    if ((opts.host ?? 'modal-root') === 'modal-root') {
      ensureModalRoot().appendChild(dialogEl);
    }

    return instance;
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private _attachEventListeners(): void {
    this._backdropHandler = (e: Event) => {
      // Backdrop click: the native event target is the <dialog> itself (not an inner child)
      if (this._closeOnBackdrop && e.target === this.dialog) {
        this.close();
      }
    };
    this._cancelHandler = (e: Event) => {
      // Always prevent the native ESC dismiss so we own the close flow
      e.preventDefault();
      if (this._closeOnEscape) {
        this.close();
      }
    };
    this.dialog.addEventListener('click', this._backdropHandler);
    this.dialog.addEventListener('cancel', this._cancelHandler);
  }

  /**
   * Builds the standard .action-dialog shell via createElement (no innerHTML injection).
   * Returns references to the slots and the close button for immediate wiring.
   */
  private static _buildShell(
    title?: string,
    ariaLabel?: string,
  ): {
    dialog: HTMLDialogElement;
    bodySlot: HTMLElement;
    footerSlot: HTMLElement;
    closeBtn: HTMLButtonElement;
  } {
    const dialog = document.createElement('dialog');
    dialog.className = 'action-dialog';
    if (ariaLabel) dialog.setAttribute('aria-label', ariaLabel);

    const inner = document.createElement('div');
    inner.className = 'action-dialog__inner';

    // ── Header ──────────────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.className = 'action-dialog__header';

    const titleEl = document.createElement('h2');
    titleEl.className = 'action-dialog__title';
    titleEl.textContent = title ?? '';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'modal-close-btn';
    closeBtn.setAttribute('aria-label', 'Close');
    // Lucide 'x' glyph — registered in src/lib/icons/index.ts (import X, map X)
    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', 'x');
    icon.setAttribute('aria-hidden', 'true');
    closeBtn.appendChild(icon);

    header.appendChild(titleEl);
    header.appendChild(closeBtn);

    // ── Body slot (populated by buildBody() or setBody()) ───────────────────────
    const bodySlot = document.createElement('div');
    bodySlot.className = 'action-dialog__body';

    // ── Footer slot (populated by buildFooter() or setFooter()) ─────────────────
    const footerSlot = document.createElement('div');
    footerSlot.className = 'action-dialog__footer';

    inner.appendChild(header);
    inner.appendChild(bodySlot);
    inner.appendChild(footerSlot);
    dialog.appendChild(inner);

    return { dialog, bodySlot, footerSlot, closeBtn };
  }

  // ── Template methods (OCP extension points) ───────────────────────────────────

  /**
   * Override in subclasses to provide the modal body content.
   * Called once during construction before the dialog is added to the DOM.
   * Return an HTMLElement to fill the .action-dialog__body slot, or null for empty.
   */
  protected buildBody(): HTMLElement | null {
    return null;
  }

  /**
   * Override in subclasses to provide the modal footer content (e.g. action buttons).
   * Called once during construction before the dialog is added to the DOM.
   * Return an HTMLElement to fill the .action-dialog__footer slot, or null for empty.
   */
  protected buildFooter(): HTMLElement | null {
    return null;
  }

  // ── Lifecycle hooks (OCP extension points) ────────────────────────────────────

  /** Called by open() before showModal(). Override for pre-open side-effects. */
  protected beforeOpen(): void {}

  /** Called by open() after focus is shifted. Override for post-open side-effects. */
  protected onOpen(): void {}

  /** Called by close() before dialog.close(). Override for pre-close side-effects. */
  protected onClose(): void {}

  // ── Public surface (ISP) ─────────────────────────────────────────────────────

  /**
   * Open the dialog via showModal(). Saves the currently focused element for
   * later restoration and shifts focus to the first focusable element inside
   * the dialog.
   *
   * Lifecycle: beforeOpen() → showModal() → focus first focusable → onOpen().
   */
  open(): void {
    this._priorFocus = document.activeElement;
    this.beforeOpen();
    this.dialog.showModal();
    // Shift focus into the dialog (close button is first focusable in the base shell)
    const first = this.dialog.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]),' +
        ' select:not([disabled]), textarea:not([disabled]),' +
        ' [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();
    this.onOpen();
  }

  /**
   * Close the dialog and restore focus to the element that was active before open().
   *
   * Lifecycle: onClose() → dialog.close() → restore prior focus.
   */
  close(options: { restoreFocus?: boolean } = {}): void {
    this.onClose();
    this.dialog.close();
    if ((options.restoreFocus ?? true) && this._priorFocus instanceof HTMLElement) {
      this._priorFocus.focus();
    }
  }

  /**
   * Remove the dialog from the DOM and detach all event listeners.
   * Call when the owning controller disconnects or the modal is no longer needed.
   */
  destroy(): void {
    this.dialog.removeEventListener('click', this._backdropHandler);
    this.dialog.removeEventListener('cancel', this._cancelHandler);
    this.dialog.remove();
  }

  /**
   * Replace the content of the .action-dialog__body slot.
   * No-op if the dialog has no body slot (e.g. an adopted dialog without that class).
   */
  setBody(node: Node): void {
    this._bodySlot?.replaceChildren(node);
  }

  /**
   * Replace the content of the .action-dialog__footer slot.
   */
  setFooter(node: Node): void {
    this._footerSlot?.replaceChildren(node);
  }
}
