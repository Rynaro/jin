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
      toggle: vi.fn(), open: vi.fn(), process: vi.fn(), defer: vi.fn(), task: vi.fn(), loadEvents: vi.fn(), selectEvent, attach,
    });
    const select = target.querySelector('select') as HTMLSelectElement;
    expect(select.options[1].value).toBe('e1');
    select.value = 'e1';
    select.dispatchEvent(new Event('change'));
    expect(selectEvent).toHaveBeenCalledWith(note, 'e1');
    renderCaptureReview(target, [note], [event], 'n1', 'e1', {
      toggle: vi.fn(), open: vi.fn(), process: vi.fn(), defer: vi.fn(), task: vi.fn(), loadEvents: vi.fn(), selectEvent, attach,
    });
    buttonByText(target, 'Attach').click();
    expect(attach).toHaveBeenCalledWith(note, 'e1');
  });

  it('leaves an unexpanded row as a compact title and metadata only', () => {
    const target = document.createElement('ul');
    renderCaptureReview(target, [note], [], null, null, {
      toggle: vi.fn(), open: vi.fn(), process: vi.fn(), defer: vi.fn(), task: vi.fn(), loadEvents: vi.fn(), selectEvent: vi.fn(), attach: vi.fn(),
    });
    expect(target.querySelectorAll('button')).toHaveLength(1);
    expect(target.querySelector('input')).toBeNull();
  });

  it('opens the expanded note from its decision controls', () => {
    const target = document.createElement('ul');
    const open = vi.fn();
    renderCaptureReview(target, [note], null, 'n1', null, {
      toggle: vi.fn(), open, process: vi.fn(), defer: vi.fn(), task: vi.fn(), loadEvents: vi.fn(), selectEvent: vi.fn(), attach: vi.fn(),
    });
    buttonByText(target, 'Open note').click();
    expect(open).toHaveBeenCalledWith(note);
  });

  it('waits to defer until Apply and formats all-day events without midnight', () => {
    const target = document.createElement('ul');
    const defer = vi.fn();
    renderCaptureReview(target, [note], null, 'n1', null, {
      toggle: vi.fn(), open: vi.fn(), process: vi.fn(), defer, task: vi.fn(), loadEvents: vi.fn(), selectEvent: vi.fn(), attach: vi.fn(),
    });
    const date = target.querySelector('input[type="date"]') as HTMLInputElement;
    date.value = '2026-07-08';
    date.dispatchEvent(new Event('input'));
    expect(defer).not.toHaveBeenCalled();
    buttonByText(target, 'Apply').click();
    expect(defer).toHaveBeenCalledWith(note, '2026-07-08');
    expect(eventOptionLabel({ ...event, start: '2026-07-09', end: '2026-07-10', is_all_day: true, floating: false, source: 'google' } as EventDto)).not.toContain('12:00');
  });
});
