// @vitest-environment jsdom
/**
 * ui_select.test.ts — unit tests for JinSelect (src/lib/ui/select.ts).
 *
 * Story S5 acceptance criteria (spec §5 GIVEN/WHEN/THEN):
 *
 *   (a) After JinSelect.enhance(sel), changing the underlying <select> value
 *       STILL fires a native change event that external listeners receive.
 *       This proves Stimulus data-action="change->tasks#applyFilter" keeps working.
 *
 *   (b) The emitted value equals the option value attribute (e.g. an l.id).
 *       Option labels (display names) are never the value — id stays identity.
 *
 *   (c) getValue() / setValue() round-trip through the native DOM.
 *
 *   (d) The .jin-select__chevron affordance element is present inside the shell
 *       after enhancement.
 *
 *   (e) The native change event propagation path is preserved — a listener
 *       on the select (simulating Stimulus change->applyFilter wiring) fires
 *       even after JinSelect wraps the select.
 *
 *   (f) JinSelect.onChange() subscriber receives the correct value.
 *
 *   (g) JinSelect does NOT swallow the change event — it still reaches parent
 *       event listeners (bubble path intact).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JinSelect } from '../lib/ui/select';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal <select> with a few options (value = l.id pattern).
 * Appended to document.body so parentNode is set (required by enhance).
 */
function buildSelect(
  options: Array<{ value: string; label: string }> = [
    { value: '', label: 'All Lists' },
    { value: 'inbox', label: 'Inbox' },
    { value: 'proj-1', label: 'Project One' },
  ],
): HTMLSelectElement {
  const sel = document.createElement('select');
  for (const { value, label } of options) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    sel.appendChild(opt);
  }
  document.body.appendChild(sel);
  return sel;
}

// ── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  document.body.innerHTML = '';
});

// ── Suite: JinSelect shell structure ─────────────────────────────────────────

describe('JinSelect shell structure', () => {
  it('(d) wraps the select in a .jin-select shell element', () => {
    const sel = buildSelect();
    JinSelect.enhance(sel);

    const shell = document.querySelector('.jin-select');
    expect(shell).not.toBeNull();
    expect(shell!.contains(sel)).toBe(true);
  });

  it('(d) .jin-select__chevron affordance element is present inside the shell', () => {
    const sel = buildSelect();
    JinSelect.enhance(sel);

    const shell = document.querySelector('.jin-select');
    expect(shell).not.toBeNull();
    const chevron = shell!.querySelector('.jin-select__chevron');
    expect(chevron).not.toBeNull();
  });

  it('(d) chevron has aria-hidden="true" (decorative — no screen reader noise)', () => {
    const sel = buildSelect();
    JinSelect.enhance(sel);

    const chevron = document.querySelector('.jin-select__chevron');
    expect(chevron).not.toBeNull();
    expect(chevron!.getAttribute('aria-hidden')).toBe('true');
  });

  it('shell is inserted at the select original DOM position (not appended elsewhere)', () => {
    // Select is the only direct child of body before enhancement.
    const sel = buildSelect();
    const indexBefore = Array.from(document.body.children).indexOf(sel);

    JinSelect.enhance(sel);

    // After enhancement, the shell is at the original index; select is inside it.
    const shell = document.body.children[indexBefore] as HTMLElement;
    expect(shell.classList.contains('jin-select')).toBe(true);
    expect(shell.querySelector('select')).toBe(sel);
  });
});

// ── Suite: native change event preservation ──────────────────────────────────

describe('native change event preservation', () => {
  it('(a) native change event still fires on the select after enhancement', () => {
    const sel = buildSelect();
    JinSelect.enhance(sel);

    const handler = vi.fn();
    sel.addEventListener('change', handler);

    // Simulate user selecting a different option.
    sel.value = 'inbox';
    sel.dispatchEvent(new Event('change', { bubbles: true }));

    expect(handler).toHaveBeenCalledOnce();
  });

  it('(e) change event bubbles to a parent listener (Stimulus applyFilter path)', () => {
    const sel = buildSelect();
    JinSelect.enhance(sel);

    // Simulate Stimulus: change->tasks#applyFilter attached to the select element.
    // After enhancement the select is inside .jin-select, but the event still
    // bubbles up through body → any parent container.
    const parentHandler = vi.fn();
    document.body.addEventListener('change', parentHandler);

    sel.value = 'proj-1';
    sel.dispatchEvent(new Event('change', { bubbles: true }));

    expect(parentHandler).toHaveBeenCalledOnce();

    document.body.removeEventListener('change', parentHandler);
  });

  it('(g) JinSelect does NOT call stopPropagation — event reaches multiple listeners', () => {
    const sel = buildSelect();
    const js = JinSelect.enhance(sel);

    const listenerA = vi.fn();
    const listenerB = vi.fn();
    const onChangeCallback = vi.fn();

    sel.addEventListener('change', listenerA);
    document.body.addEventListener('change', listenerB);
    js.onChange(onChangeCallback);

    sel.value = 'proj-1';
    sel.dispatchEvent(new Event('change', { bubbles: true }));

    // All three should fire.
    expect(listenerA).toHaveBeenCalledOnce();
    expect(listenerB).toHaveBeenCalledOnce();
    expect(onChangeCallback).toHaveBeenCalledOnce();

    document.body.removeEventListener('change', listenerB);
  });
});

// ── Suite: emitted value is the option value (l.id, not display name) ────────

describe('value identity — option value is the emitted value (b)', () => {
  it('(b) onChange callback receives the option value, not the display label', () => {
    const sel = buildSelect([
      { value: '', label: 'All Lists' },
      { value: 'proj-1', label: 'Project One' }, // id ≠ display name
    ]);
    const js = JinSelect.enhance(sel);

    const received: string[] = [];
    js.onChange((v) => received.push(v));

    sel.value = 'proj-1';
    sel.dispatchEvent(new Event('change', { bubbles: true }));

    expect(received).toEqual(['proj-1']); // id, not 'Project One'
  });

  it('(b) inbox id (id === name case) still works correctly', () => {
    const sel = buildSelect();
    const js = JinSelect.enhance(sel);

    const received: string[] = [];
    js.onChange((v) => received.push(v));

    sel.value = 'inbox';
    sel.dispatchEvent(new Event('change', { bubbles: true }));

    expect(received).toEqual(['inbox']);
  });

  it('(b) empty string value (All Lists) is passed through as-is', () => {
    const sel = buildSelect();
    sel.value = 'inbox'; // start non-empty
    const js = JinSelect.enhance(sel);

    const received: string[] = [];
    js.onChange((v) => received.push(v));

    sel.value = '';
    sel.dispatchEvent(new Event('change', { bubbles: true }));

    expect(received).toEqual(['']);
  });
});

// ── Suite: getValue / setValue round-trip ─────────────────────────────────────

describe('getValue / setValue round-trip (c)', () => {
  it('(c) getValue() returns the current native select value', () => {
    const sel = buildSelect();
    const js = JinSelect.enhance(sel);

    sel.value = 'proj-1';
    expect(js.getValue()).toBe('proj-1');
  });

  it('(c) setValue() updates the native select value', () => {
    const sel = buildSelect();
    const js = JinSelect.enhance(sel);

    js.setValue('inbox');
    expect(sel.value).toBe('inbox');
    expect(js.getValue()).toBe('inbox');
  });

  it('(c) getValue() reflects subsequent setValue() calls', () => {
    const sel = buildSelect();
    const js = JinSelect.enhance(sel);

    js.setValue('');
    expect(js.getValue()).toBe('');

    js.setValue('proj-1');
    expect(js.getValue()).toBe('proj-1');

    js.setValue('inbox');
    expect(js.getValue()).toBe('inbox');
  });

  it('(c) setValue() is silent — does NOT fire a change event', () => {
    const sel = buildSelect();
    const js = JinSelect.enhance(sel);

    const handler = vi.fn();
    sel.addEventListener('change', handler);

    js.setValue('proj-1'); // programmatic — must not fire

    expect(handler).not.toHaveBeenCalled();
  });
});

// ── Suite: onChange subscriber ────────────────────────────────────────────────

describe('onChange subscriber (f)', () => {
  it('(f) onChange callback fires when the select value changes', () => {
    const sel = buildSelect();
    const js = JinSelect.enhance(sel);

    const cb = vi.fn();
    js.onChange(cb);

    sel.value = 'inbox';
    sel.dispatchEvent(new Event('change', { bubbles: true }));

    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith('inbox');
  });

  it('(f) multiple onChange subscribers all fire', () => {
    const sel = buildSelect();
    const js = JinSelect.enhance(sel);

    const cbA = vi.fn();
    const cbB = vi.fn();
    js.onChange(cbA);
    js.onChange(cbB);

    sel.value = 'proj-1';
    sel.dispatchEvent(new Event('change', { bubbles: true }));

    expect(cbA).toHaveBeenCalledOnce();
    expect(cbB).toHaveBeenCalledOnce();
  });
});

// ── Suite: JinSelect.enhance static factory ───────────────────────────────────

describe('JinSelect.enhance static factory', () => {
  it('enhance() returns a JinSelect instance', () => {
    const sel = buildSelect();
    const js = JinSelect.enhance(sel);
    expect(js).toBeInstanceOf(JinSelect);
  });

  it('enhance() and new JinSelect() produce equivalent shells', () => {
    const selA = buildSelect();
    const selB = buildSelect();

    JinSelect.enhance(selA);
    new JinSelect(selB);

    const shellA = selA.closest('.jin-select');
    const shellB = selB.closest('.jin-select');

    expect(shellA).not.toBeNull();
    expect(shellB).not.toBeNull();
    expect(shellA!.querySelector('.jin-select__chevron')).not.toBeNull();
    expect(shellB!.querySelector('.jin-select__chevron')).not.toBeNull();
  });

  it('enhance() is idempotent and returns the original instance', () => {
    const sel = buildSelect();
    const first = JinSelect.enhance(sel);
    const second = JinSelect.enhance(sel);

    expect(second).toBe(first);
    expect(document.querySelectorAll('.jin-select')).toHaveLength(1);
    expect(document.querySelectorAll('.jin-select__chevron')).toHaveLength(1);
  });

  it('enhanceAll() covers static and dynamically appended selects without double wrapping', () => {
    const root = document.createElement('section');
    const first = document.createElement('select');
    first.disabled = true;
    root.appendChild(first);
    document.body.appendChild(root);

    JinSelect.enhanceAll(root);
    const dynamic = document.createElement('select');
    root.appendChild(dynamic);
    JinSelect.enhanceAll(root);

    expect(root.querySelectorAll('.jin-select')).toHaveLength(2);
    expect(first.disabled).toBe(true);
    expect(first.closest('.jin-select')).not.toBeNull();
    expect(dynamic.closest('.jin-select')).not.toBeNull();
  });
});

// ── Suite: filter bar simulation (applyFilter path) ──────────────────────────

describe('filter bar / applyFilter path — no regression after enhancement', () => {
  /**
   * Simulates the tasks controller filter bar pattern:
   *   - A select with data-action="change->tasks#applyFilter" (attribute intact)
   *   - A listener on the select element (Stimulus attaches to the element)
   *   - JinSelect.enhance() wraps it
   *   - Verify the listener still fires with the correct value
   */
  it('Stimulus-style listener on the select element still fires after enhance()', () => {
    const sel = buildSelect([
      { value: '', label: 'All Statuses' },
      { value: 'todo', label: 'To Do' },
      { value: 'doing', label: 'In Progress' },
    ]);
    // Mark like the real HTML does
    sel.setAttribute('data-action', 'change->tasks#applyFilter');

    // Simulate the applyFilter call
    const applyFilter = vi.fn();
    sel.addEventListener('change', applyFilter);

    // Enhance (wraps in shell)
    JinSelect.enhance(sel);

    // The data-action attribute must survive enhancement (Stimulus reads it)
    expect(sel.getAttribute('data-action')).toBe('change->tasks#applyFilter');

    // Trigger a change as the user would
    sel.value = 'todo';
    sel.dispatchEvent(new Event('change', { bubbles: true }));

    expect(applyFilter).toHaveBeenCalledOnce();
  });

  it('list filter emits l.id (not display name) after enhancement', () => {
    const sel = buildSelect([
      { value: '', label: 'All Lists' },
      { value: 'inbox', label: 'Inbox' },
      { value: 'proj-1', label: 'Project One' }, // id ≠ display name
    ]);
    sel.setAttribute('data-action', 'change->tasks#applyFilter');

    let emittedValue: string | null = null;
    sel.addEventListener('change', () => {
      emittedValue = sel.value;
    });

    JinSelect.enhance(sel);

    sel.value = 'proj-1';
    sel.dispatchEvent(new Event('change', { bubbles: true }));

    // The value that reaches applyFilter must be the id, not the display name.
    expect(emittedValue).toBe('proj-1');
  });
});
