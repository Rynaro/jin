// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { eventOptionLabel, renderCaptureReview } from '../lib/capture/review';
import type { CaptureReviewItemDto, EventDto } from '../types/dto';

const note: CaptureReviewItemDto = {
  kind: 'note', id: 'n1', title: 'Call the printer', created: '2026-07-01T10:00:00Z', return_on: null, state: 'pending',
};
const event = {
  id: 'e1',
  title: 'Print review',
  start: '2026-07-09T09:00:00',
  end: '2026-07-09T10:00:00',
  is_all_day: false,
  floating: true,
  source: 'jin',
} as EventDto;

function buttonByText(target: HTMLElement, text: string): HTMLButtonElement {
  return Array.from(target.querySelectorAll('button')).find(button => button.textContent === text) as HTMLButtonElement;
}

describe('capture review renderer', () => {
  it('keeps actions on only the selected capture and attaches to an exact event id', () => {
    const target = document.createElement('ul');
    const attach = vi.fn();
    const selectEvent = vi.fn();
    renderCaptureReview(target, [note], [event], 'n1', null, {
      toggle: vi.fn(), open: vi.fn(), process: vi.fn(), task: vi.fn(), loadEvents: vi.fn(), selectEvent, attach, pickCheckback: vi.fn(),
    });
    const select = target.querySelector('select') as HTMLSelectElement;
    expect(select.options[1].value).toBe('e1');
    select.value = 'e1';
    select.dispatchEvent(new Event('change'));
    expect(selectEvent).toHaveBeenCalledWith(note, 'e1');
    renderCaptureReview(target, [note], [event], 'n1', 'e1', {
      toggle: vi.fn(), open: vi.fn(), process: vi.fn(), task: vi.fn(), loadEvents: vi.fn(), selectEvent, attach, pickCheckback: vi.fn(),
    });
    buttonByText(target, 'Attach').click();
    expect(attach).toHaveBeenCalledWith(note, 'e1');
  });

  it('leaves an unexpanded row as a compact title and metadata only', () => {
    const target = document.createElement('ul');
    renderCaptureReview(target, [note], [], null, null, {
      toggle: vi.fn(), open: vi.fn(), process: vi.fn(), task: vi.fn(), loadEvents: vi.fn(), selectEvent: vi.fn(), attach: vi.fn(), pickCheckback: vi.fn(),
    });
    expect(target.querySelectorAll('button')).toHaveLength(1);
    expect(target.querySelector('input')).toBeNull();
  });

  it('opens the expanded note from its decision controls', () => {
    const target = document.createElement('ul');
    const open = vi.fn();
    renderCaptureReview(target, [note], null, 'n1', null, {
      toggle: vi.fn(), open, process: vi.fn(), task: vi.fn(), loadEvents: vi.fn(), selectEvent: vi.fn(), attach: vi.fn(), pickCheckback: vi.fn(),
    });
    buttonByText(target, 'Open note').click();
    expect(open).toHaveBeenCalledWith(note);
  });

  it('opens the shared check-back picker without a native date field', () => {
    const target = document.createElement('ul');
    const pickCheckback = vi.fn();
    renderCaptureReview(target, [note], null, 'n1', null, {
      toggle: vi.fn(), open: vi.fn(), process: vi.fn(), task: vi.fn(), loadEvents: vi.fn(), selectEvent: vi.fn(), attach: vi.fn(), pickCheckback,
    });
    const date = target.querySelector<HTMLButtonElement>('.capture-review__checkback-action')!;
    expect(date.textContent).toBe('Check back');
    expect(date.querySelector('i[data-lucide="calendar"]')).not.toBeNull();
    expect(date.getAttribute('aria-label')).toBeNull();
    date.click();
    expect(pickCheckback).toHaveBeenCalledWith(note, date);
    expect(target.querySelector('input[type="date"]')).toBeNull();
  });

  it('uses one chevron shape that rotates with the expanded state', () => {
    const target = document.createElement('ul');
    renderCaptureReview(target, [note], [], null, null, {
      toggle: vi.fn(), open: vi.fn(), process: vi.fn(), task: vi.fn(), loadEvents: vi.fn(), selectEvent: vi.fn(), attach: vi.fn(), pickCheckback: vi.fn(),
    });
    const collapsed = target.querySelector<HTMLButtonElement>('.capture-review__title')!;
    expect(collapsed.querySelector('i[data-lucide="chevron-down"]')).not.toBeNull();
    expect(collapsed.getAttribute('aria-expanded')).toBe('false');

    renderCaptureReview(target, [note], [], 'n1', null, {
      toggle: vi.fn(), open: vi.fn(), process: vi.fn(), task: vi.fn(), loadEvents: vi.fn(), selectEvent: vi.fn(), attach: vi.fn(), pickCheckback: vi.fn(),
    });
    const expanded = target.querySelector<HTMLButtonElement>('.capture-review__title')!;
    expect(expanded.querySelector('i[data-lucide="chevron-down"]')).not.toBeNull();
    expect(expanded.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps an existing check-back date in the aligned action', () => {
    const target = document.createElement('ul');
    const deferred = { ...note, return_on: '2026-11-23' };
    renderCaptureReview(target, [deferred], [], 'n1', null, {
      toggle: vi.fn(), open: vi.fn(), process: vi.fn(), task: vi.fn(), loadEvents: vi.fn(), selectEvent: vi.fn(), attach: vi.fn(), pickCheckback: vi.fn(),
    });
    const date = target.querySelector<HTMLButtonElement>('.capture-review__checkback-action')!;
    expect(date.textContent).toBe('Check back 2026-11-23');
    expect(date.getAttribute('aria-label')).toBeNull();
  });

  it('formats all-day events without midnight', () => {
    expect(eventOptionLabel({ ...event, start: '2026-07-09', end: '2026-07-10', is_all_day: true, floating: false, source: 'google' } as EventDto)).not.toContain('12:00');
  });
});
