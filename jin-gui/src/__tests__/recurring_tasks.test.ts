import { describe, expect, it } from 'vitest';
import type { TaskDto } from '../types/dto';
import { repeatSummary } from '../lib/tasks/repeat';
import { recurrenceSummary } from '../lib/tasks/transform';

const task = (recurrence: TaskDto['recurrence']): TaskDto => ({
  id: 'routine', title: 'Routine', status: 'todo', priority: 'none', due: '2026-10-29',
  list: 'inbox', completed_at: null, deleted_at: null, created: '', updated: '', backlinks: [],
  recurrence, completion_history: [],
});

describe('recurring task UI contract', () => {
  it('summarizes schedule and completion routines without DOM state', () => {
    expect(recurrenceSummary(task({ series_id: 's', frequency: 'weekly', interval: 2, weekdays: [2, 4], mode: 'completion', end: { kind: 'never' }, anchor_due: '2026-10-29', sequence: 1 }))).toBe('Every 2 week on Tue, Thu after completion');
  });

  it('summarizes fixed weekdays without exposing internal ISO weekday numbers', () => {
    expect(recurrenceSummary(task({
      series_id: 's', frequency: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5], mode: 'scheduled',
      end: { kind: 'count', count: 5 }, anchor_due: '2026-10-29', sequence: 2,
    }))).toBe('week on Mon, Tue, Wed, Thu, Fri');
  });
});


describe('saved repeat inspector summary', () => {
  it('summarizes the saved rule and its actual planning mode', () => {
    const t = task({ series_id: 's', frequency: 'monthly', interval: 2, weekdays: [], mode: 'scheduled', end: { kind: 'count', count: 5 }, anchor_due: '2026-10-29', sequence: 1 });
    expect(repeatSummary(t)).toEqual({ title: 'Every 2 months', detail: '10 upcoming entries · Ends after 5 occurrences' });
    t.recurrence!.mode = 'completion';
    expect(repeatSummary(t)).toEqual({ title: 'Every 2 months after completion', detail: 'Next entry after completion · Ends after 5 occurrences' });
  });
  it('keeps stopped and ordinary tasks quiet', () => {
    expect(repeatSummary(task(undefined))).toEqual({ title: 'Does not repeat', detail: '' });
  });
});
