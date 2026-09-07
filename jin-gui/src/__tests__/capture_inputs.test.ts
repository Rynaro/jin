// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { JinSelectField } from '../lib/ui/select';
import { TagInput } from '../lib/ui/tag_input';

describe('JinSelectField', () => {
  it('uses a Jin combobox/listbox while retaining the hidden select as value source', () => {
    document.body.innerHTML = '<label for="choice">Priority</label><select id="choice"><option value="">None</option><option value="high">High</option></select>';
    const select = document.querySelector('select')!;
    JinSelectField.enhance(select);
    const trigger = document.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    expect(trigger.getAttribute('aria-label')).toBe('Priority');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(select.getAttribute('aria-hidden')).toBe('true');
    trigger.click();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(2);
    (document.querySelectorAll<HTMLButtonElement>('[role="option"]')[1]).click();
    expect(select.value).toBe('high');
    expect(trigger.textContent).toContain('High');
  });

  it('forwards required/help semantics and exposes validation on the visible combobox', () => {
    document.body.innerHTML = '<label for="choice">Calendar</label><select id="choice" required aria-describedby="choice-help"><option value="">Choose</option><option value="local">Jin only</option></select><p id="choice-help">Destination help</p><p id="choice-error">Choose a destination</p>';
    const select = document.querySelector('select')!;
    const field = JinSelectField.enhance(select);
    const trigger = document.querySelector<HTMLButtonElement>('[role="combobox"]')!;

    expect(trigger.getAttribute('aria-required')).toBe('true');
    expect(trigger.getAttribute('aria-describedby')).toBe('choice-help');
    field.setInvalid(true, 'choice-error');
    field.focus();
    expect(document.activeElement).toBe(trigger);
    expect(document.activeElement).not.toBe(select);
    expect(trigger.getAttribute('aria-invalid')).toBe('true');
    expect(trigger.getAttribute('aria-describedby')?.split(' ')).toEqual(['choice-help', 'choice-error']);

    field.setValue('local');
    expect(trigger.hasAttribute('aria-invalid')).toBe(false);
    expect(trigger.getAttribute('aria-describedby')).toBe('choice-help');
  });

  it('supports arrow navigation, Enter selection, and Escape dismissal', () => {
    document.body.innerHTML = '<select aria-label="List"><option value="a">Alpha</option><option value="b">Beta</option></select>';
    const select = document.querySelector('select')!;
    JinSelectField.enhance(select);
    const trigger = document.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    trigger.click();
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(select.value).toBe('b');
    trigger.click();
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('refreshes when async options are populated', async () => {
    document.body.innerHTML = '<select aria-label="Calendar"><option>Jin only</option></select>';
    const select = document.querySelector('select')!;
    JinSelectField.enhance(select);
    select.append(new Option('Work calendar', 'work'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(2);
  });

  it('keeps the rendered value synchronized with programmatic resets', () => {
    document.body.innerHTML = '<select aria-label="List"><option value="inbox">Inbox</option><option value="work">Work</option></select>';
    const field = JinSelectField.enhance(document.querySelector('select')!);
    field.setValue('work');
    expect(document.querySelector('.jin-select-field__value')?.textContent).toBe('Work');
    field.setValue('inbox');
    expect(document.querySelector('.jin-select-field__value')?.textContent).toBe('Inbox');
  });

  it('closes on Tab without trapping or cancelling normal focus movement', () => {
    document.body.innerHTML = '<select aria-label="List"><option>Inbox</option></select><button id="after">After</button>';
    JinSelectField.enhance(document.querySelector('select')!);
    const trigger = document.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    trigger.click();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    trigger.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on focusout and can be destroyed/reconnected without duplicate UI', async () => {
    document.body.innerHTML = '<select aria-label="List"><option>Inbox</option></select><button id="after">After</button>';
    const select = document.querySelector('select')!;
    const first = JinSelectField.enhance(select);
    const trigger = document.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    trigger.focus();
    trigger.click();
    document.getElementById('after')!.focus();
    await Promise.resolve();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    first.destroy();
    expect(document.querySelectorAll('.jin-select-field')).toHaveLength(0);
    JinSelectField.enhance(select);
    expect(document.querySelectorAll('.jin-select-field')).toHaveLength(1);
    expect(document.querySelectorAll('[role="combobox"]')).toHaveLength(1);
  });

  it('portals the popup outside scrolling form content and fits compact viewport height', () => {
    document.body.innerHTML = '<dialog open><div class="scroll"><label for="priority">Priority</label><select id="priority"><option>None</option><option>High</option><option>Medium</option><option>Low</option></select></div></dialog>';
    const dialog = document.querySelector('dialog')!;
    const select = document.querySelector('select')!;
    JinSelectField.enhance(select);
    const trigger = document.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      x: 40, y: 190, left: 40, top: 190, right: 240, bottom: 226, width: 200, height: 36,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
      x: 20, y: 20, left: 20, top: 20, right: 300, bottom: 260, width: 280, height: 240,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(260);

    trigger.click();
    const popup = document.getElementById(trigger.getAttribute('aria-controls')!)!;
    expect(popup.parentElement).toBe(dialog);
    expect(popup.dataset.placement).toBe('top');
    expect(parseFloat(popup.style.top)).toBeGreaterThanOrEqual(-12);
    expect(parseFloat(popup.style.maxHeight)).toBeLessThanOrEqual(162);
  });
});

describe('TagInput', () => {
  it('commits normalized, deduplicated chips on comma or Enter', () => {
    document.body.innerHTML = '<input aria-label="Add tag">';
    const source = document.querySelector('input')!;
    const tags = new TagInput(source);
    const input = document.querySelector<HTMLInputElement>('.jin-tag-input__field')!;
    input.value = '#Work, work, URGENT';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(tags.getTags()).toEqual(['work', 'urgent']);
    expect(source.value).toBe('work,urgent');
  });

  it('removes the last chip with Backspace from an empty draft', () => {
    document.body.innerHTML = '<input value="one,two">';
    const tags = new TagInput(document.querySelector('input')!);
    const input = document.querySelector<HTMLInputElement>('.jin-tag-input__field')!;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    expect(tags.getTags()).toEqual(['one']);
  });

  it('tears down cleanly so reconnect creates one input surface', () => {
    document.body.innerHTML = '<input value="one">';
    const source = document.querySelector('input')!;
    const first = new TagInput(source);
    first.destroy();
    expect(document.querySelectorAll('.jin-tag-input')).toHaveLength(0);
    new TagInput(source);
    expect(document.querySelectorAll('.jin-tag-input')).toHaveLength(1);
    expect(document.querySelectorAll('.jin-tag-input__field')).toHaveLength(1);
  });
});
