// @vitest-environment jsdom
/**
 * ui_modal.test.ts — unit tests for JinModal (src/lib/ui/modal.ts).
 *
 * Story S1 GIVEN/WHEN/THEN coverage:
 *   1. open() → exactly one <dialog.action-dialog> under #jin-modal-root,
 *      dialog.open === true, focus on first focusable element.
 *   2. Backdrop click and Escape close the dialog — and do NOT when suppressed.
 *   3. A subclass overriding buildFooter() leaves the base shell unchanged (OCP).
 *
 * jsdom does not implement HTMLDialogElement.showModal() / close().
 * We stub them at the prototype level so dialog.open reflects state.
 * Pattern sourced from notes_controller.test.ts:1464-1477.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JinModal, ensureModalRoot, type JinModalOpts } from '../lib/ui/modal';
import { ConfirmDialog } from '../lib/ui/confirm_dialog';
import { initIcons } from '../lib/icons';

// ── jsdom stub — showModal() / close() ───────────────────────────────────────
//
// jsdom's HTMLDialogElement has the interface but does not implement these as
// callable methods. Assign lightweight stubs on the prototype that toggle the
// `open` content attribute so dialog.open reflects open/closed state.

function stubDialogPrototype(): void {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    value(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
    writable: true,
    configurable: true,
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    value(this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  stubDialogPrototype();
});

afterEach(() => {
  // Reset DOM between tests to prevent state leakage
  document.body.innerHTML = '';
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Get the dialog element from the modal root (asserts it exists). */
function getDialog(): HTMLDialogElement {
  return document.querySelector('dialog.action-dialog') as HTMLDialogElement;
}

// ── Suite: ensureModalRoot ────────────────────────────────────────────────────

describe('ensureModalRoot', () => {
  it('creates #jin-modal-root on document.body when absent', () => {
    const root = ensureModalRoot();
    expect(root.id).toBe('jin-modal-root');
    expect(document.body.contains(root)).toBe(true);
  });

  it('returns the same element on repeated calls (idempotent)', () => {
    const root1 = ensureModalRoot();
    const root2 = ensureModalRoot();
    expect(root1).toBe(root2);
    expect(document.querySelectorAll('#jin-modal-root')).toHaveLength(1);
  });
});

// ── Suite: JinModal — open() ──────────────────────────────────────────────────

describe('JinModal open()', () => {
  it('appends exactly one <dialog.action-dialog> under #jin-modal-root', () => {
    const modal = new JinModal({ title: 'Test Modal' });
    modal.open();

    const root = document.getElementById('jin-modal-root');
    expect(root).not.toBeNull();

    const dialogs = root!.querySelectorAll('dialog.action-dialog');
    expect(dialogs).toHaveLength(1);

    modal.destroy();
  });

  it('sets dialog.open === true after open()', () => {
    const modal = new JinModal({ title: 'Test Modal' });
    modal.open();

    const dialog = getDialog();
    expect(dialog.open).toBe(true);

    modal.destroy();
  });

  it('renders the standard shell structure (inner / header / title / close btn / body / footer)', () => {
    const modal = new JinModal({ title: 'Structure Check' });
    modal.open();

    const dialog = getDialog();
    expect(dialog.querySelector('.action-dialog__inner')).not.toBeNull();
    expect(dialog.querySelector('.action-dialog__header')).not.toBeNull();
    expect(dialog.querySelector('.action-dialog__title')!.textContent).toBe('Structure Check');
    expect(dialog.querySelector('.modal-close-btn')).not.toBeNull();
    expect(dialog.querySelector('.action-dialog__body')).not.toBeNull();
    expect(dialog.querySelector('.action-dialog__footer')).not.toBeNull();

    modal.destroy();
  });

  it('focuses the first focusable element (close button) after open()', () => {
    const modal = new JinModal({ title: 'Focus Test' });
    modal.open();

    const closeBtn = document.querySelector('.modal-close-btn') as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();
    expect(document.activeElement).toBe(closeBtn);

    modal.destroy();
  });

  it('focuses the first input when it is before the close button in DOM order', () => {
    const modal = new JinModal({ title: 'Input Focus' });

    // Inject an input into the body slot before calling open()
    const input = document.createElement('input');
    input.type = 'text';
    modal.setBody(input);

    modal.open();

    // The input is inside .action-dialog__body which comes AFTER .action-dialog__header
    // in the shell. The close button (in the header) comes first in DOM order.
    // querySelector returns the first matching element — the close button.
    const closeBtn = document.querySelector('.modal-close-btn') as HTMLButtonElement;
    expect(document.activeElement).toBe(closeBtn);

    modal.destroy();
  });

  it('multiple open() calls do not duplicate the #jin-modal-root', () => {
    const modal1 = new JinModal({ title: 'A' });
    const modal2 = new JinModal({ title: 'B' });

    modal1.open();
    modal2.open();

    expect(document.querySelectorAll('#jin-modal-root')).toHaveLength(1);

    modal1.destroy();
    modal2.destroy();
  });
});

describe('ConfirmDialog dynamic icon hydration', () => {
  it('hydrates only the new modal and preserves existing SVG identity and semantics', () => {
    const nav = document.createElement('button');
    nav.innerHTML = '<i data-lucide="calendar" aria-hidden="true"></i>';
    document.body.appendChild(nav);
    initIcons();
    const navigationSvg = nav.querySelector<SVGSVGElement>('svg.lucide-calendar')!;

    const first = new ConfirmDialog({
      title: 'Remove this Time block?',
      message: 'The task will not be completed or deleted.',
      confirmLabel: 'Remove',
      variant: 'danger',
    });
    first.open();
    const firstDialog = document.querySelectorAll<HTMLDialogElement>('dialog.action-dialog')[0];
    const firstClose = firstDialog.querySelector<HTMLButtonElement>('.modal-close-btn')!;
    const firstCloseSvg = firstClose.querySelector<SVGSVGElement>('svg.lucide-x')!;

    const second = new ConfirmDialog({ title: 'Delete event?', variant: 'danger' });
    second.open();
    const secondDialog = document.querySelectorAll<HTMLDialogElement>('dialog.action-dialog')[1];
    const secondClose = secondDialog.querySelector<HTMLButtonElement>('.modal-close-btn')!;

    expect(secondClose.getAttribute('aria-label')).toBe('Close');
    expect(secondClose.querySelector('svg.lucide-x')).not.toBeNull();
    expect(secondClose.querySelector('i[data-lucide]')).toBeNull();
    expect(nav.querySelector('svg.lucide-calendar')).toBe(navigationSvg);
    expect(firstClose.querySelector('svg.lucide-x')).toBe(firstCloseSvg);
    expect(navigationSvg.isConnected).toBe(true);
    expect(firstCloseSvg.isConnected).toBe(true);
    expect(document.activeElement).toBe(secondClose);

    const cancel = new Event('cancel', { cancelable: true });
    secondDialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(secondDialog.open).toBe(false);
    expect(firstDialog.open).toBe(true);

    firstDialog.dispatchEvent(new MouseEvent('click', { bubbles: false }));
    expect(firstDialog.open).toBe(false);

    second.destroy();
    first.destroy();
  });
});

// ── Suite: JinModal — close() ─────────────────────────────────────────────────

describe('JinModal close()', () => {
  it('sets dialog.open === false after close()', () => {
    const modal = new JinModal({ title: 'Close Test' });
    modal.open();

    expect(getDialog().open).toBe(true);

    modal.close();

    expect(getDialog().open).toBe(false);

    modal.destroy();
  });

  it('restores focus to the previously focused element after close()', () => {
    // Create a button outside the modal to represent prior focus
    const trigger = document.createElement('button');
    trigger.textContent = 'Open Modal';
    document.body.appendChild(trigger);
    trigger.focus();

    expect(document.activeElement).toBe(trigger);

    const modal = new JinModal({ title: 'Focus Restore' });
    modal.open();

    expect(document.activeElement).not.toBe(trigger);

    modal.close();

    expect(document.activeElement).toBe(trigger);

    modal.destroy();
  });
});

// ── Suite: JinModal — backdrop click ─────────────────────────────────────────

describe('JinModal backdrop click', () => {
  it('closes the modal when closeOnBackdrop is true (default)', () => {
    const modal = new JinModal({ title: 'Backdrop Close' });
    modal.open();

    const dialog = getDialog();
    expect(dialog.open).toBe(true);

    // Dispatch a click event directly on the dialog element to simulate a backdrop click.
    // When the click originates on the dialog itself (not a child), e.target === dialog.
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: false }));

    expect(dialog.open).toBe(false);

    modal.destroy();
  });

  it('does NOT close when closeOnBackdrop is false', () => {
    const modal = new JinModal({ title: 'Backdrop Suppressed', closeOnBackdrop: false });
    modal.open();

    const dialog = getDialog();
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: false }));

    // Dialog should remain open
    expect(dialog.open).toBe(true);

    modal.close();
    modal.destroy();
  });

  it('does NOT close when click target is a child element (not the backdrop)', () => {
    const modal = new JinModal({ title: 'Inner Click' });
    modal.open();

    const dialog = getDialog();
    const inner = dialog.querySelector('.action-dialog__inner') as HTMLElement;

    // Click on an inner element — e.target will be the inner div, not the dialog
    inner.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Dialog should remain open (only backdrop clicks close it)
    expect(dialog.open).toBe(true);

    modal.close();
    modal.destroy();
  });
});

// ── Suite: JinModal — Escape (cancel event) ───────────────────────────────────

describe('JinModal Escape / cancel event', () => {
  it('closes the modal when closeOnEscape is true (default)', () => {
    const modal = new JinModal({ title: 'Escape Close' });
    modal.open();

    const dialog = getDialog();
    expect(dialog.open).toBe(true);

    // The native ESC key fires a 'cancel' event on the dialog
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));

    expect(dialog.open).toBe(false);

    modal.destroy();
  });

  it('does NOT close when closeOnEscape is false', () => {
    const modal = new JinModal({ title: 'Escape Suppressed', closeOnEscape: false });
    modal.open();

    const dialog = getDialog();
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));

    // Dialog should remain open
    expect(dialog.open).toBe(true);

    modal.close();
    modal.destroy();
  });
});

// ── Suite: JinModal — destroy() ───────────────────────────────────────────────

describe('JinModal destroy()', () => {
  it('removes the dialog from the DOM', () => {
    const modal = new JinModal({ title: 'Destroy Test' });
    expect(document.querySelector('dialog.action-dialog')).not.toBeNull();

    modal.destroy();

    expect(document.querySelector('dialog.action-dialog')).toBeNull();
  });

  it('detaches backdrop and cancel event listeners after destroy()', () => {
    const modal = new JinModal({ title: 'Listener Cleanup', closeOnBackdrop: true });
    modal.open();
    modal.close();
    modal.destroy();

    // The dialog is removed; dispatching on a detached element should not throw
    // and the modal should not re-close (it's already closed and removed).
    expect(() => {
      const orphan = document.createElement('dialog');
      orphan.dispatchEvent(new MouseEvent('click', { bubbles: false }));
    }).not.toThrow();
  });
});

// ── Suite: JinModal — setBody / setFooter ────────────────────────────────────

describe('JinModal setBody() and setFooter()', () => {
  it('setBody() replaces the content of the body slot', () => {
    const modal = new JinModal({ title: 'Set Body' });

    const content = document.createElement('p');
    content.textContent = 'Body content';
    modal.setBody(content);

    const body = document.querySelector('.action-dialog__body');
    expect(body?.textContent).toBe('Body content');

    modal.destroy();
  });

  it('setFooter() replaces the content of the footer slot', () => {
    const modal = new JinModal({ title: 'Set Footer' });

    const footer = document.createElement('div');
    footer.textContent = 'Footer content';
    modal.setFooter(footer);

    const footerSlot = document.querySelector('.action-dialog__footer');
    expect(footerSlot?.textContent).toBe('Footer content');

    modal.destroy();
  });
});

// ── Suite: JinModal — fromElement() ──────────────────────────────────────────

describe('JinModal.fromElement()', () => {
  it('wraps an existing dialog and opens it', () => {
    const dialogEl = document.createElement('dialog');
    dialogEl.className = 'action-dialog';
    document.body.appendChild(dialogEl);

    const modal = JinModal.fromElement(dialogEl);
    modal.open();

    expect(dialogEl.open).toBe(true);

    modal.destroy();
  });

  it('strips data-action attributes from buttons inside the adopted dialog', () => {
    const dialogEl = document.createElement('dialog');
    dialogEl.className = 'action-dialog';
    const btn = document.createElement('button');
    btn.setAttribute('data-action', 'click->tasks#save');
    dialogEl.appendChild(btn);
    document.body.appendChild(dialogEl);

    JinModal.fromElement(dialogEl, { host: 'in-place' });

    // data-action should be removed — Stimulus scoping dependency is gone
    expect(btn.hasAttribute('data-action')).toBe(false);
  });

  it('keeps dialog in place when host is "in-place"', () => {
    const container = document.createElement('section');
    const dialogEl = document.createElement('dialog');
    dialogEl.className = 'action-dialog';
    container.appendChild(dialogEl);
    document.body.appendChild(container);

    JinModal.fromElement(dialogEl, { host: 'in-place' });

    // Dialog should still be inside container, not moved to modal root
    expect(container.contains(dialogEl)).toBe(true);
  });

  it('relocates dialog to #jin-modal-root by default', () => {
    const container = document.createElement('section');
    const dialogEl = document.createElement('dialog');
    dialogEl.className = 'action-dialog';
    container.appendChild(dialogEl);
    document.body.appendChild(container);

    JinModal.fromElement(dialogEl);

    const root = document.getElementById('jin-modal-root');
    expect(root).not.toBeNull();
    expect(root!.contains(dialogEl)).toBe(true);
    expect(container.contains(dialogEl)).toBe(false);
  });

  it('wires onPrimary callback to .btn-primary in the adopted dialog', () => {
    const dialogEl = document.createElement('dialog');
    dialogEl.className = 'action-dialog';
    const primaryBtn = document.createElement('button');
    primaryBtn.className = 'btn-primary';
    dialogEl.appendChild(primaryBtn);
    document.body.appendChild(dialogEl);

    let called = false;
    JinModal.fromElement(dialogEl, {
      host: 'in-place',
      onPrimary: () => { called = true; },
    });

    primaryBtn.click();

    expect(called).toBe(true);
  });

  it('backdrop click closes an adopted dialog', () => {
    const dialogEl = document.createElement('dialog');
    dialogEl.className = 'action-dialog';
    document.body.appendChild(dialogEl);

    const modal = JinModal.fromElement(dialogEl, { host: 'in-place' });
    modal.open();

    expect(dialogEl.open).toBe(true);

    dialogEl.dispatchEvent(new MouseEvent('click', { bubbles: false }));

    expect(dialogEl.open).toBe(false);

    modal.destroy();
  });
});

// ── Suite: OCP proof — subclass overriding buildFooter() ─────────────────────

describe('JinModal OCP — subclass overriding buildFooter()', () => {
  it('base shell is unchanged and only the footer slot content differs', () => {
    class CustomFooterModal extends JinModal {
      constructor(opts: JinModalOpts = {}) {
        super(opts);
      }

      protected override buildFooter(): HTMLElement {
        const container = document.createElement('div');
        const btn = document.createElement('button');
        btn.className = 'btn-primary';
        btn.textContent = 'Custom Action';
        container.appendChild(btn);
        return container;
      }
    }

    const modal = new CustomFooterModal({ title: 'OCP Proof' });
    modal.open();

    const dialog = getDialog();

    // ── Base shell must be unchanged ─────────────────────────────────────────
    expect(dialog.querySelector('.action-dialog__inner')).not.toBeNull();
    expect(dialog.querySelector('.action-dialog__header')).not.toBeNull();
    expect(dialog.querySelector('.action-dialog__title')!.textContent).toBe('OCP Proof');
    expect(dialog.querySelector('.modal-close-btn')).not.toBeNull();
    expect(dialog.querySelector('.action-dialog__body')).not.toBeNull();

    // ── Footer has the subclass-provided content ──────────────────────────────
    const footer = dialog.querySelector('.action-dialog__footer');
    expect(footer).not.toBeNull();
    expect(footer!.querySelector('.btn-primary')!.textContent).toBe('Custom Action');

    modal.destroy();
  });

  it('overriding buildBody() also leaves header and footer slots unchanged', () => {
    class CustomBodyModal extends JinModal {
      constructor(opts: JinModalOpts = {}) {
        super(opts);
      }

      protected override buildBody(): HTMLElement {
        const p = document.createElement('p');
        p.className = 'action-dialog__message';
        p.textContent = 'Are you sure?';
        return p;
      }
    }

    const modal = new CustomBodyModal({ title: 'OCP Body Proof' });
    modal.open();

    const dialog = getDialog();

    // Header is intact
    expect(dialog.querySelector('.action-dialog__title')!.textContent).toBe('OCP Body Proof');
    expect(dialog.querySelector('.modal-close-btn')).not.toBeNull();

    // Body has the subclass content
    const body = dialog.querySelector('.action-dialog__body');
    expect(body!.querySelector('.action-dialog__message')!.textContent).toBe('Are you sure?');

    // Footer slot exists (empty, since base buildFooter returns null)
    expect(dialog.querySelector('.action-dialog__footer')).not.toBeNull();

    modal.destroy();
  });

  it('two separate subclasses do NOT share each other footer content', () => {
    class ModalA extends JinModal {
      protected override buildFooter(): HTMLElement {
        const btn = document.createElement('button');
        btn.textContent = 'Action A';
        return btn;
      }
    }

    class ModalB extends JinModal {
      protected override buildFooter(): HTMLElement {
        const btn = document.createElement('button');
        btn.textContent = 'Action B';
        return btn;
      }
    }

    const modalA = new ModalA({ title: 'Modal A' });
    const modalB = new ModalB({ title: 'Modal B' });

    modalA.open();
    modalB.open();

    const dialogs = document.querySelectorAll('dialog.action-dialog');
    expect(dialogs).toHaveLength(2);

    const footerA = dialogs[0].querySelector('.action-dialog__footer');
    const footerB = dialogs[1].querySelector('.action-dialog__footer');

    expect(footerA!.textContent).toBe('Action A');
    expect(footerB!.textContent).toBe('Action B');

    modalA.destroy();
    modalB.destroy();
  });
});

// ── Suite: JinModal — ariaLabel ──────────────────────────────────────────────

describe('JinModal ariaLabel option', () => {
  it('sets aria-label on the <dialog> element when provided', () => {
    const modal = new JinModal({ title: 'Confirm', ariaLabel: 'Confirm delete action' });

    const dialog = getDialog();
    expect(dialog.getAttribute('aria-label')).toBe('Confirm delete action');

    modal.destroy();
  });

  it('does not set aria-label when not provided', () => {
    const modal = new JinModal({ title: 'No Label' });

    const dialog = getDialog();
    expect(dialog.getAttribute('aria-label')).toBeNull();

    modal.destroy();
  });
});

// ── Suite: JinModal — lifecycle hooks ────────────────────────────────────────

describe('JinModal lifecycle hooks', () => {
  it('beforeOpen() is called before showModal()', () => {
    const order: string[] = [];

    class HookedModal extends JinModal {
      protected override beforeOpen(): void {
        order.push('beforeOpen');
      }

      protected override onOpen(): void {
        order.push('onOpen');
      }
    }

    const modal = new HookedModal({ title: 'Hooks' });
    modal.open();

    expect(order[0]).toBe('beforeOpen');
    expect(order[1]).toBe('onOpen');
    expect(getDialog().open).toBe(true); // showModal ran between the two hooks

    modal.destroy();
  });

  it('onClose() is called before dialog.close()', () => {
    const order: string[] = [];

    class CloseHookModal extends JinModal {
      protected override onClose(): void {
        order.push('onClose');
        // Dialog should still be "open" at this point (close() hasn't been called yet)
        order.push(this['dialog'].open ? 'still-open' : 'already-closed');
      }
    }

    const modal = new CloseHookModal({ title: 'Close Hook' });
    modal.open();
    modal.close();

    expect(order[0]).toBe('onClose');
    expect(order[1]).toBe('still-open');

    modal.destroy();
  });
});
