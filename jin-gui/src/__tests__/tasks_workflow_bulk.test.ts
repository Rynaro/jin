import { describe, expect, it } from 'vitest';
import type { TaskDto, ListDto } from '../types/dto';
import { intersectLegalNextStatuses } from '../lib/tasks/bulk';

function task(status: TaskDto['status'], list: string): TaskDto {
  return {
    id: `${list}-${status}`, title: 'Task', status, priority: 'none', due: null,
    list, completed_at: null, deleted_at: null,
    created: '2026-09-24T00:00:00Z', updated: '2026-09-24T00:00:00Z',
    backlinks: [], body: '',
  };
}

describe('bulk actions respect every selected task’s owning workflow', () => {
  const kinds = new Map<string, ListDto['workflow_kind']>([
    ['home', 'checklist'], ['project', 'board'], ['old', null],
  ]);

  it('never offers a Doing or Cancelled action to a mixed List and Board selection', () => {
    expect(intersectLegalNextStatuses([task('todo', 'home'), task('todo', 'project')], kinds)).toEqual(['done']);
  });

  it('offers the Board-specific Done to Doing path only when every owner permits it', () => {
    expect(intersectLegalNextStatuses([task('done', 'project')], kinds)).toEqual(['todo', 'doing']);
    expect(intersectLegalNextStatuses([task('done', 'home'), task('done', 'project')], kinds)).toEqual(['todo']);
  });

  it('retains legacy transitions for containers without a workflow kind', () => {
    expect(intersectLegalNextStatuses([task('todo', 'old')], kinds)).toContain('cancelled');
  });
});
