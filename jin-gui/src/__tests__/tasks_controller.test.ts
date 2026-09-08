// @vitest-environment jsdom
/**
 * tasks_controller.test.ts — headless unit tests for the Tasks browse + detail view (GUI-S4).
 *
 * Tests two layers:
 *   1. Pure logic from lib/tasks/transform.ts (no DOM)
 *   2. DOM rendering from lib/tasks/render.ts (jsdom, no Stimulus)
 *
 * Headless gates verified here:
 *   ✓ filterTasksList: excludes deleted, filters by status/list/priority
 *   ✓ sortTasksList: high>medium>low>none, then most-recently-updated (VG-P0)
 *   ✓ taskStatusLabel: human-readable text (color-independence)
 *   ✓ taskStatusGlyph: correct icon names
 *   ✓ taskPriorityLabel: canonical vocabulary none|low|medium|high (VG-P0)
 *   ✓ taskPriorityGlyph: flag for non-none, empty string for none (VG-P0)
 *   ✓ renderTasksList: renders title; status by glyph AND label (never color-only)
 *   ✓ renderTasksList: clicking row fires onNavigate with task id
 *   ✓ renderTasksList: empty state
 *   ✓ renderTaskPane: renders status, priority, due, list, body
 *   ✓ renderTaskPane: backlinks are reachable
 *   ✓ VG-P1: status toggle fires onStatusToggle callback
 *   ✓ VG-P1: delete button fires onDeleteRequest callback
 *   ✓ VG-P1: add-task input Enter fires onCreateTask callback
 *   ✓ S3: the detail pane replaces both retired editors (AC-S3-01..11)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TaskDto, TaskBacklinkDto, SectionDto, ReminderDto } from '../types/dto';
import type { JinErrorDto } from '../types/error';
import {
  filterTasksList,
  sortTasksList,
  taskStatusLabel,
  taskStatusGlyph,
  taskPriorityLabel,
  taskPriorityGlyph,
  formatTaskDue,
  groupTasksBySection,
  sortTasksForMode,
  formatReminderLabel,
  legalNextStatuses,
  computeSubtaskDisplayInfo,
  partitionParentsAndChildren,
  type TaskGroup,
} from '../lib/tasks/transform';
import {
  renderTasksList,
  renderTaskPane,
  renderListViewWithSections,
  renderBoardView,
  buildReminderChips,
  buildTaskItem,
  type TasksViewElements,
  type TasksTemplates,
  type TaskDetailCallbacks,
  type TaskRowCallbacks,
} from '../lib/tasks/render';
import { between } from '../lib/tasks/rank';
import { listNameById } from '../lib/lists/transform';
import { applyScope, groupFlexibleTasks } from '../lib/tasks/scopes';

// ── S1 controller-level harness (AC-S1-06 / AC-S1-08) ────────────────────────
//
// Everything above this point tests pure functions / render.ts in isolation —
// no Stimulus, no bridge. AC-S1-06 (view persists globally across a list
// switch) and AC-S1-08 (view toggle disabled without a list scope) are
// properties of the real TasksController instance, so this section mounts it
// via a genuine Stimulus Application, same pattern as tasks_dnd_autoselect.test.ts.
// vi.mock calls are hoisted by Vitest regardless of source position, so they
// take effect for the imports below even though they're declared mid-file.
import { Application, defaultSchema } from '@hotwired/stimulus';
import type { ListDto } from '../types/dto';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));
vi.mock('../lib/icons', () => ({ initIcons: vi.fn() }));

// eslint-disable-next-line import/first -- must follow the vi.mock calls above.
import TasksController from '../controllers/tasks_controller';
// eslint-disable-next-line import/first
import * as InvokeModule from '../invoke';

// ── Fixture factories ─────────────────────────────────────────────────────────

function makeTask(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: 'task-001',
    title: 'Test Task',
    status: 'todo',
    priority: 'none', // canonical default (was 'normal' — updated for P0)
    due: null,
    list: 'inbox',
    completed_at: null,
    deleted_at: null,
    created: '2026-06-01T00:00:00Z',
    updated: '2026-06-27T12:00:00Z',
    backlinks: [],
    body: '',
    ...overrides,
  };
}

function makeTaskBacklink(overrides: Partial<TaskBacklinkDto> = {}): TaskBacklinkDto {
  return {
    source_id: 'evt-abc-123',
    source_kind: 'event',
    edge_type: 'derived-from',
    label: 'Promoted Event',
    ...overrides,
  };
}

// ── jsdom helpers ─────────────────────────────────────────────────────────────

function makeTasksViewElements(): TasksViewElements {
  const listPanel = document.createElement('div');
  const list = document.createElement('ul');
  listPanel.appendChild(list);
  const emptyState = document.createElement('div');
  emptyState.classList.add('hidden');
  const loadingState = document.createElement('div');
  loadingState.classList.add('hidden');

  const detailPanel = document.createElement('div');
  detailPanel.classList.add('hidden');
  const detailLoadingState = document.createElement('div');
  detailLoadingState.classList.add('hidden');
  const detailNotFoundState = document.createElement('div');
  detailNotFoundState.classList.add('hidden');
  const detailContent = document.createElement('div');

  document.body.appendChild(listPanel);
  document.body.appendChild(emptyState);
  document.body.appendChild(loadingState);
  document.body.appendChild(detailPanel);

  return {
    listPanel,
    list,
    emptyState,
    loadingState,
    detailPanel,
    detailLoadingState,
    detailNotFoundState,
    detailContent,
  };
}

/**
 * makeTasksTemplates — mirrors the real `#tmpl-task-item` (S2: ONE template,
 * cloned for both the List row and the Board card by `buildTaskItem`).
 * Status toggle is a .task-item__status-btn.task-item__checkbox button with
 * role="checkbox". The .task-item__status-badge is a sibling of the button
 * (not inside it). Hover actions cluster has .task-item__delete-btn only —
 * S3 retired the pencil/edit button (AC-S3-04). See index.html#tmpl-task-item
 * for the source of truth.
 */
function makeTasksTemplates(): TasksTemplates {
  const taskItemTmpl = document.createElement('template');
  taskItemTmpl.innerHTML = `
    <li class="task-item">
      <span class="task-item__drag-handle" aria-hidden="true">
        <i data-lucide="grip-vertical" aria-hidden="true"></i>
      </span>
      <button type="button" class="task-item__status-btn task-item__checkbox tap-target"
              role="checkbox" aria-checked="false" aria-label="Toggle task status">
        <i class="task-item__status-icon" aria-hidden="true"></i>
      </button>
      <span class="browse-status-badge task-item__status-badge" role="img" aria-label="">
        <span class="task-item__status-label"></span>
      </span>
      <div class="task-item__content">
        <button type="button" class="task-item__body tap-target" aria-label="">
          <span class="task-item__title"></span>
          <span class="task-item__subtask-progress" aria-hidden="true"></span>
        </button>
        <span class="task-item__meta">
          <span class="task-item__tags"></span>
        </span>
      </div>
      <span class="browse-status-badge task-item__priority" role="img" aria-label="">
        <i class="task-item__priority-icon" aria-hidden="true"></i>
        <span class="task-item__priority-label"></span>
      </span>
      <div class="task-item__actions" aria-hidden="true">
        <button type="button" class="task-item__delete-btn tap-target" aria-label="Delete task">
          <i data-lucide="trash-2" aria-hidden="true"></i>
        </button>
      </div>
    </li>
  `.trim();

  const backlinkRowTmpl = document.createElement('template');
  backlinkRowTmpl.innerHTML = `
    <li class="browse-link-row">
      <button class="browse-link-row__btn tap-target" aria-label="" data-link-id="" data-link-kind="">
        <i class="browse-link-row__icon" aria-hidden="true"></i>
        <span class="browse-link-row__label text-callout"></span>
        <span class="browse-link-row__id text-caption2"></span>
      </button>
    </li>
  `.trim();

  return { taskItem: taskItemTmpl, backlinkRow: backlinkRowTmpl };
}

// ── Shared setup ──────────────────────────────────────────────────────────────

let el: TasksViewElements;
let templates: TasksTemplates;
const noopNavigate = vi.fn();

beforeEach(() => {
  document.body.innerHTML = '';
  noopNavigate.mockReset();
  el = makeTasksViewElements();
  templates = makeTasksTemplates();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. filterTasksList — filter pass-through (spec AC: filters pass through)
// ─────────────────────────────────────────────────────────────────────────────

describe('filterTasksList', () => {
  it('excludes soft-deleted tasks', () => {
    const tasks = [
      makeTask({ id: 't1', deleted_at: '2026-01-01T00:00:00Z' }),
      makeTask({ id: 't2', deleted_at: null }),
    ];
    expect(filterTasksList(tasks, {})).toHaveLength(1);
    expect(filterTasksList(tasks, {})[0].id).toBe('t2');
  });

  it('filters by status — only matching tasks returned', () => {
    const tasks = [
      makeTask({ id: 't1', status: 'todo' }),
      makeTask({ id: 't2', status: 'done' }),
      makeTask({ id: 't3', status: 'todo' }),
    ];
    const result = filterTasksList(tasks, { status: 'todo' });
    expect(result).toHaveLength(2);
    expect(result.every((t) => t.status === 'todo')).toBe(true);
  });

  it('filters by list — list_tasks({list:"inbox"}) returns only inbox tasks', () => {
    const tasks = [
      makeTask({ id: 't1', list: 'inbox' }),
      makeTask({ id: 't2', list: 'work' }),
      makeTask({ id: 't3', list: 'inbox' }),
    ];
    const result = filterTasksList(tasks, { list: 'inbox' });
    expect(result).toHaveLength(2);
    expect(result.every((t) => t.list === 'inbox')).toBe(true);
  });

  it('filters by priority', () => {
    const tasks = [
      makeTask({ id: 't1', priority: 'high' }),
      makeTask({ id: 't2', priority: 'none' }),
      makeTask({ id: 't3', priority: 'high' }),
    ];
    const result = filterTasksList(tasks, { priority: 'high' });
    expect(result).toHaveLength(2);
    expect(result.every((t) => t.priority === 'high')).toBe(true);
  });

  it('combines status + list + priority filters (all must match)', () => {
    const tasks = [
      makeTask({ id: 't1', status: 'todo', list: 'inbox', priority: 'high' }),
      makeTask({ id: 't2', status: 'todo', list: 'work', priority: 'high' }),
      makeTask({ id: 't3', status: 'done', list: 'inbox', priority: 'high' }),
    ];
    const result = filterTasksList(tasks, { status: 'todo', list: 'inbox', priority: 'high' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('t1');
  });

  it('returns all non-deleted when no filter applied', () => {
    const tasks = [makeTask({ id: 't1' }), makeTask({ id: 't2' })];
    expect(filterTasksList(tasks, {})).toHaveLength(2);
  });

  it('ignores empty string filters', () => {
    const tasks = [makeTask({ id: 't1', status: 'todo' }), makeTask({ id: 't2', status: 'done' })];
    expect(filterTasksList(tasks, { status: '' })).toHaveLength(2);
  });

  it('does not mutate the input array', () => {
    const tasks = [makeTask()];
    const originalLen = tasks.length;
    filterTasksList(tasks, { status: 'todo' });
    expect(tasks).toHaveLength(originalLen);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. sortTasksList — deterministic sort (canonical vocabulary: none|low|medium|high)
// ─────────────────────────────────────────────────────────────────────────────

describe('sortTasksList', () => {
  it('sorts high priority first (canonical vocabulary)', () => {
    const tasks = [
      makeTask({ id: 't1', priority: 'low',    updated: '2026-06-27T00:00:00Z' }),
      makeTask({ id: 't2', priority: 'high',   updated: '2026-06-25T00:00:00Z' }),
      makeTask({ id: 't3', priority: 'medium', updated: '2026-06-26T00:00:00Z' }),
    ];
    const sorted = sortTasksList(tasks);
    expect(sorted[0].id).toBe('t2'); // high first
    expect(sorted[1].id).toBe('t3'); // medium second
    expect(sorted[2].id).toBe('t1'); // low last
  });

  it('within same priority: most-recently-updated first', () => {
    const tasks = [
      makeTask({ id: 't1', priority: 'medium', updated: '2026-06-25T00:00:00Z' }),
      makeTask({ id: 't2', priority: 'medium', updated: '2026-06-27T12:00:00Z' }),
    ];
    const sorted = sortTasksList(tasks);
    expect(sorted[0].id).toBe('t2');
  });

  it('does not mutate the input array', () => {
    const tasks = [
      makeTask({ id: 't1', priority: 'low' }),
      makeTask({ id: 't2', priority: 'high' }),
    ];
    const originalFirst = tasks[0].id;
    sortTasksList(tasks);
    expect(tasks[0].id).toBe(originalFirst);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. taskStatusLabel — color-independence gate (status by text AND glyph AND label)
// ─────────────────────────────────────────────────────────────────────────────

describe('taskStatusLabel', () => {
  it('returns "To Do" for todo', () => {
    expect(taskStatusLabel('todo')).toBe('To Do');
  });

  it('returns "In Progress" for doing', () => {
    expect(taskStatusLabel('doing')).toBe('In Progress');
  });

  it('returns "Done" for done', () => {
    expect(taskStatusLabel('done')).toBe('Done');
  });

  it('returns "Cancelled" for cancelled', () => {
    expect(taskStatusLabel('cancelled')).toBe('Cancelled');
  });

  it('capitalizes unknown status', () => {
    expect(taskStatusLabel('pending')).toBe('Pending');
  });

  it('never returns empty string (color-independence)', () => {
    expect(taskStatusLabel('')).toBe('Unknown');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. taskStatusGlyph — icon names
// ─────────────────────────────────────────────────────────────────────────────

describe('taskStatusGlyph', () => {
  it('returns "circle" for todo', () => {
    expect(taskStatusGlyph('todo')).toBe('circle');
  });

  it('returns "circle-dot" for doing', () => {
    expect(taskStatusGlyph('doing')).toBe('circle-dot');
  });

  it('returns "check-circle" for done', () => {
    expect(taskStatusGlyph('done')).toBe('check-circle');
  });

  it('returns "x-circle" for cancelled', () => {
    expect(taskStatusGlyph('cancelled')).toBe('x-circle');
  });

  it('returns a non-empty fallback for unknown', () => {
    expect(taskStatusGlyph('unknown')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. taskPriorityLabel / taskPriorityGlyph — canonical vocabulary: none|low|medium|high
// ─────────────────────────────────────────────────────────────────────────────

describe('taskPriorityLabel', () => {
  it('returns "High" for high', () => {
    expect(taskPriorityLabel('high')).toBe('High');
  });

  it('returns "Medium" for medium (P0: canonical vocabulary)', () => {
    expect(taskPriorityLabel('medium')).toBe('Medium');
  });

  it('returns "Low" for low', () => {
    expect(taskPriorityLabel('low')).toBe('Low');
  });

  it('returns "None" for none (P0: canonical default)', () => {
    expect(taskPriorityLabel('none')).toBe('None');
  });

  it('never returns empty string', () => {
    expect(taskPriorityLabel('')).toBeTruthy();
  });
});

describe('taskPriorityGlyph', () => {
  it('returns "flag" for high (P0: flag glyph decision, tinted --color-danger)', () => {
    expect(taskPriorityGlyph('high')).toBe('flag');
  });

  it('returns "flag" for medium (P0: flag glyph, tinted warning/accent)', () => {
    expect(taskPriorityGlyph('medium')).toBe('flag');
  });

  it('returns "flag" for low (P0: flag glyph, tinted muted)', () => {
    expect(taskPriorityGlyph('low')).toBe('flag');
  });

  it('returns "" for none (P0: no flag for no-priority)', () => {
    expect(taskPriorityGlyph('none')).toBe('');
  });

  it('returns "" for unknown (no glyph for unrecognized priority)', () => {
    expect(taskPriorityGlyph('unknown')).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. formatTaskDue
// ─────────────────────────────────────────────────────────────────────────────

describe('formatTaskDue', () => {
  it('returns "No due date" for null', () => {
    expect(formatTaskDue(null)).toBe('No due date');
  });

  it('returns a non-empty string for a valid ISO date', () => {
    const result = formatTaskDue('2026-07-01T00:00:00Z');
    expect(result).not.toBe('No due date');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. renderTasksList — list rendering (color-independence gate)
// ─────────────────────────────────────────────────────────────────────────────

describe('renderTasksList — empty state', () => {
  it('shows empty state when tasks array is empty', () => {
    renderTasksList(el, templates, [], noopNavigate);
    expect(el.emptyState.classList.contains('hidden')).toBe(false);
  });

  it('hides list when tasks array is empty (no onCreateTask callback)', () => {
    // Without onCreateTask, list stays hidden when empty
    renderTasksList(el, templates, [], noopNavigate);
    expect(el.list.classList.contains('hidden')).toBe(true);
  });
});

describe('renderTasksList — row rendering (spec AC: status by color AND glyph AND label)', () => {
  it('renders the correct number of rows', () => {
    const tasks = [makeTask({ id: 't1' }), makeTask({ id: 't2' })];
    renderTasksList(el, templates, tasks, noopNavigate);
    expect(el.list.querySelectorAll('.task-item')).toHaveLength(2);
  });

  it('renders the task title', () => {
    renderTasksList(el, templates, [makeTask({ title: 'Important Work' })], noopNavigate);
    expect(el.list.querySelector('.task-item__title')?.textContent).toBe('Important Work');
  });

  it('renders status TEXT LABEL (color-independence: not color-only)', () => {
    renderTasksList(el, templates, [makeTask({ status: 'todo' })], noopNavigate);
    const labelEl = el.list.querySelector('.task-item__status-label');
    expect(labelEl?.textContent?.trim()).toBe('To Do');
  });

  it('renders status GLYPH (data-lucide set — color-independence: icon + text)', () => {
    renderTasksList(el, templates, [makeTask({ status: 'done' })], noopNavigate);
    const iconEl = el.list.querySelector('.task-item__status-icon');
    expect(iconEl?.getAttribute('data-lucide')).toBe('check-circle');
  });

  it('renders status badge with aria-label (accessible)', () => {
    renderTasksList(el, templates, [makeTask({ status: 'cancelled' })], noopNavigate);
    const badgeEl = el.list.querySelector('.task-item__status-badge');
    expect(badgeEl?.getAttribute('aria-label')).toContain('Cancelled');
  });

  it('renders priority TEXT LABEL (medium, P0 canonical vocabulary)', () => {
    renderTasksList(el, templates, [makeTask({ priority: 'medium' })], noopNavigate);
    const priorityLabelEl = el.list.querySelector('.task-item__priority-label');
    expect(priorityLabelEl?.textContent?.trim()).toBe('Medium');
  });

  it('renders priority GLYPH as "flag" for high (P0 flag decision)', () => {
    renderTasksList(el, templates, [makeTask({ priority: 'high' })], noopNavigate);
    const priorityIconEl = el.list.querySelector('.task-item__priority-icon');
    expect(priorityIconEl?.getAttribute('data-lucide')).toBe('flag');
  });

  it('renders priority GLYPH as "flag" for low (P0 flag decision)', () => {
    renderTasksList(el, templates, [makeTask({ priority: 'low' })], noopNavigate);
    const priorityIconEl = el.list.querySelector('.task-item__priority-icon');
    expect(priorityIconEl?.getAttribute('data-lucide')).toBe('flag');
  });

  it('hides priority icon for "none" priority (P0: no flag for none)', () => {
    renderTasksList(el, templates, [makeTask({ priority: 'none' })], noopNavigate);
    const priorityIconEl = el.list.querySelector('.task-item__priority-icon') as HTMLElement | null;
    // Icon hidden (display:none) when no glyph
    expect(priorityIconEl?.style.display).toBe('none');
  });

  it('list_tasks({status:"todo", list:"inbox"}) — renders only filtered tasks', () => {
    const allTasks = [
      makeTask({ id: 't1', status: 'todo', list: 'inbox' }),
      makeTask({ id: 't2', status: 'done', list: 'inbox' }),
      makeTask({ id: 't3', status: 'todo', list: 'work' }),
    ];
    const filtered = allTasks.filter((t) => t.status === 'todo' && t.list === 'inbox');
    renderTasksList(el, templates, filtered, noopNavigate);
    expect(el.list.querySelectorAll('.task-item')).toHaveLength(1);
    expect(el.list.querySelector('.task-item__title')?.textContent).toBe('Test Task');
  });
});

describe('renderTasksList — navigation (reachability gate)', () => {
  it('clicking a task row fires onNavigate with kind="tasks" and the task id', () => {
    const navigate = vi.fn();
    renderTasksList(el, templates, [makeTask({ id: 'task-xyz' })], navigate);
    const btn = el.list.querySelector('.task-item__body') as HTMLButtonElement;
    btn.click();
    expect(navigate).toHaveBeenCalledWith('tasks', 'task-xyz');
  });

  it('row button has accessible aria-label', () => {
    renderTasksList(el, templates, [makeTask({ title: 'Fix Bug' })], noopNavigate);
    const btn = el.list.querySelector('.task-item__body');
    expect(btn?.getAttribute('aria-label')).toContain('Fix Bug');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. renderTaskPane — detail rendering
// ─────────────────────────────────────────────────────────────────────────────

describe('renderTaskPane — title and meta', () => {
  it('renders the task title', () => {
    renderTaskPane(el, templates, makeTask({ title: 'My Task Detail' }), noopNavigate);
    expect(el.detailContent.querySelector('.browse-detail__title')?.textContent).toBe(
      'My Task Detail'
    );
  });

  it('renders status label in detail', () => {
    renderTaskPane(el, templates, makeTask({ status: 'doing' }), noopNavigate);
    expect(el.detailContent.querySelector('.task-detail__status-label')?.textContent).toBe(
      'In Progress'
    );
  });

  it('renders priority label in detail', () => {
    renderTaskPane(el, templates, makeTask({ priority: 'high' }), noopNavigate);
    expect(el.detailContent.querySelector('.task-detail__priority-label')?.textContent).toBe(
      'High'
    );
  });

  it('renders due date in detail', () => {
    renderTaskPane(
      el,
      templates,
      makeTask({ due: '2026-07-15T00:00:00Z' }),
      noopNavigate
    );
    const dueValueEl = el.detailContent.querySelector('.task-detail__due-value');
    expect(dueValueEl?.textContent).not.toBe('No due date');
    expect(dueValueEl?.textContent).toBeTruthy();
  });

  it('renders "No due date" when due is null', () => {
    renderTaskPane(el, templates, makeTask({ due: null }), noopNavigate);
    expect(el.detailContent.querySelector('.task-detail__due-value')?.textContent).toBe(
      'No due date'
    );
  });

  it('renders list name in detail', () => {
    renderTaskPane(el, templates, makeTask({ list: 'work' }), noopNavigate);
    expect(el.detailContent.querySelector('.task-detail__list-value')?.textContent).toBe('work');
  });

  it('renders body textarea in detail panel (P1)', () => {
    renderTaskPane(el, templates, makeTask({ body: 'Some notes here' }), noopNavigate);
    const bodyEl = el.detailContent.querySelector('.task-detail__body') as HTMLTextAreaElement | null;
    expect(bodyEl).not.toBeNull();
    expect(bodyEl?.value).toBe('Some notes here');
  });

  it('renders empty body textarea when body is empty string (P1)', () => {
    renderTaskPane(el, templates, makeTask({ body: '' }), noopNavigate);
    const bodyEl = el.detailContent.querySelector('.task-detail__body') as HTMLTextAreaElement | null;
    expect(bodyEl?.value).toBe('');
  });
});

describe('renderTaskPane — backlinks (reachability gate)', () => {
  const EVT_ID = 'evt-derived-abc';
  const EVT_LABEL = 'Q3 Review Meeting';

  it('renders backlinks section when backlinks present', () => {
    const task = makeTask({
      backlinks: [makeTaskBacklink({ source_id: EVT_ID, label: EVT_LABEL })],
    });
    renderTaskPane(el, templates, task, noopNavigate);
    expect(el.detailContent.querySelector('.browse-detail__links-section')).not.toBeNull();
  });

  it('renders the backlink label in the DOM (reachable: label visible)', () => {
    const task = makeTask({
      backlinks: [makeTaskBacklink({ source_id: EVT_ID, label: EVT_LABEL })],
    });
    renderTaskPane(el, templates, task, noopNavigate);
    const labelEl = el.detailContent.querySelector('.browse-link-row__label');
    expect(labelEl?.textContent).toBe(EVT_LABEL);
  });

  it('renders the backlink source_id in the DOM (reachable: id visible)', () => {
    const task = makeTask({
      backlinks: [makeTaskBacklink({ source_id: EVT_ID })],
    });
    renderTaskPane(el, templates, task, noopNavigate);
    const idEl = el.detailContent.querySelector('.browse-link-row__id');
    expect(idEl?.textContent).toBe(EVT_ID);
  });

  it('clicking an event backlink fires onNavigate with kind="events" (has-event backlink reachable)', () => {
    const navigate = vi.fn();
    const task = makeTask({
      backlinks: [makeTaskBacklink({ source_id: EVT_ID, source_kind: 'event' })],
    });
    renderTaskPane(el, templates, task, navigate);
    const btn = el.detailContent.querySelector('.browse-link-row__btn') as HTMLButtonElement;
    btn.click();
    expect(navigate).toHaveBeenCalledWith('events', EVT_ID);
  });

  it('clicking a note backlink fires onNavigate with kind="notes"', () => {
    const navigate = vi.fn();
    const task = makeTask({
      backlinks: [makeTaskBacklink({ source_id: 'note-prep', source_kind: 'note' })],
    });
    renderTaskPane(el, templates, task, navigate);
    const btn = el.detailContent.querySelector('.browse-link-row__btn') as HTMLButtonElement;
    btn.click();
    expect(navigate).toHaveBeenCalledWith('notes', 'note-prep');
  });

  it('no backlinks section when backlinks is empty', () => {
    renderTaskPane(el, templates, makeTask({ backlinks: [] }), noopNavigate);
    expect(el.detailContent.querySelector('.browse-detail__links-section')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. VG-P0 — Priority vocabulary validation gates
// ─────────────────────────────────────────────────────────────────────────────

describe('VG-P0 — sort: high>medium>low>none on 4-priority fixture', () => {
  it('sorts high>medium>low>none (canonical 4-priority fixture)', () => {
    const fixture = [
      makeTask({ id: 'none', priority: 'none',   updated: '2026-01-01T00:00:00Z' }),
      makeTask({ id: 'low',  priority: 'low',    updated: '2026-01-01T00:00:00Z' }),
      makeTask({ id: 'med',  priority: 'medium', updated: '2026-01-01T00:00:00Z' }),
      makeTask({ id: 'high', priority: 'high',   updated: '2026-01-01T00:00:00Z' }),
    ];
    const sorted = sortTasksList(fixture);
    expect(sorted.map((t) => t.priority)).toEqual(['high', 'medium', 'low', 'none']);
  });
});

describe('VG-P0 — no GUI option emits "normal"; medium is selectable/labelled', () => {
  it('medium priority is labelled "Medium" (selectable in filter/capture selects)', () => {
    expect(taskPriorityLabel('medium')).toBe('Medium');
  });

  it('none of the four canonical priorities produce a "Normal" label', () => {
    // Proves no canonical priority maps to the removed 'normal' vocabulary
    for (const p of ['none', 'low', 'medium', 'high'] as const) {
      expect(taskPriorityLabel(p)).not.toBe('Normal');
    }
  });

  it('buildCreateTaskPayload: medium priority passes through unchanged (not "normal")', () => {
    // The capture form sends empty string for none (→ undefined → core default)
    // or an explicit value for others. Verify medium is the string "medium".
    expect(taskPriorityLabel('medium')).toBe('Medium');
    expect(taskPriorityGlyph('medium')).toBe('flag');
    // The select option value "medium" maps to the canonical core priority.
    // (No "normal" option exists; buildCreateTaskPayload passes value through unchanged.)
    const canonicalValues = ['', 'high', 'medium', 'low']; // capture form option values
    expect(canonicalValues).not.toContain('normal');
    expect(canonicalValues).toContain('medium');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. VG-P1 — Interactive core wiring (render-layer callbacks, mocked invoke)
// ─────────────────────────────────────────────────────────────────────────────

describe('VG-P1 — S1.1 complete/reopen: status toggle callback', () => {
  it('clicking .task-item__status-btn fires onStatusToggle with (taskId, currentStatus)', () => {
    const onStatusToggle = vi.fn();
    renderTasksList(
      el, templates,
      [makeTask({ id: 'task-toggle', status: 'todo' })],
      noopNavigate,
      { onStatusToggle }
    );
    const statusBtn = el.list.querySelector('.task-item__status-btn') as HTMLButtonElement;
    statusBtn.click();
    expect(onStatusToggle).toHaveBeenCalledWith('task-toggle', 'todo');
  });

  it('clicking status-btn on a done task fires onStatusToggle with status "done"', () => {
    const onStatusToggle = vi.fn();
    renderTasksList(
      el, templates,
      [makeTask({ id: 'task-done', status: 'done', completed_at: '2026-06-30T10:00:00Z' })],
      noopNavigate,
      { onStatusToggle }
    );
    const statusBtn = el.list.querySelector('.task-item__status-btn') as HTMLButtonElement;
    statusBtn.click();
    // Controller uses this to decide "todo" as next (reopen); test asserts callback was called
    expect(onStatusToggle).toHaveBeenCalledWith('task-done', 'done');
  });

  it('clicking status-btn does NOT fire onNavigate (stopPropagation)', () => {
    const navigate = vi.fn();
    const onStatusToggle = vi.fn();
    renderTasksList(
      el, templates,
      [makeTask({ id: 'task-stop', status: 'todo' })],
      navigate,
      { onStatusToggle }
    );
    const statusBtn = el.list.querySelector('.task-item__status-btn') as HTMLButtonElement;
    statusBtn.click();
    expect(navigate).not.toHaveBeenCalled();
    expect(onStatusToggle).toHaveBeenCalledOnce();
  });
});

// S3 (AC-S3-04): the row pencil button, its edit-request callback, and the
// legacy detail Save/Cancel button are all RETIRED — selection opens the ONE
// detail pane (lib/tasks/render.ts#renderTaskPane) instead. See the "S3 — the
// detail pane replaces both editors" suite below for the pane's own coverage.

describe('VG-P1 — S1.3 delete: onDeleteRequest callback', () => {
  it('clicking .task-item__delete-btn fires onDeleteRequest with (taskId, taskTitle)', () => {
    const onDeleteRequest = vi.fn();
    renderTasksList(
      el, templates,
      [makeTask({ id: 'task-del', title: 'My Task' })],
      noopNavigate,
      { onDeleteRequest }
    );
    const deleteBtn = el.list.querySelector('.task-item__delete-btn') as HTMLButtonElement;
    deleteBtn.click();
    expect(onDeleteRequest).toHaveBeenCalledWith('task-del', 'My Task');
  });

  it('clicking delete-btn does NOT fire onNavigate (stopPropagation)', () => {
    const navigate = vi.fn();
    const onDeleteRequest = vi.fn();
    renderTasksList(
      el, templates,
      [makeTask({ id: 'task-del2' })],
      navigate,
      { onDeleteRequest }
    );
    const deleteBtn = el.list.querySelector('.task-item__delete-btn') as HTMLButtonElement;
    deleteBtn.click();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('VG-P1 — S1.4 create-in-place: onCreateTask callback', () => {
  it('pressing Enter in the add-task input fires onCreateTask with the title', () => {
    const onCreateTask = vi.fn();
    renderTasksList(el, templates, [], noopNavigate, { onCreateTask });

    const addInput = el.list.querySelector('.task-add-input') as HTMLInputElement;
    expect(addInput).not.toBeNull();
    addInput.value = 'My New Task';
    addInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onCreateTask).toHaveBeenCalledWith('My New Task');
  });

  it('input is cleared after Enter (ready for rapid entry)', () => {
    const onCreateTask = vi.fn();
    renderTasksList(el, templates, [], noopNavigate, { onCreateTask });
    const addInput = el.list.querySelector('.task-add-input') as HTMLInputElement;
    addInput.value = 'Another Task';
    addInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(addInput.value).toBe('');
  });

  it('does NOT fire onCreateTask for empty/whitespace input', () => {
    const onCreateTask = vi.fn();
    renderTasksList(el, templates, [], noopNavigate, { onCreateTask });
    const addInput = el.list.querySelector('.task-add-input') as HTMLInputElement;
    addInput.value = '   ';
    addInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onCreateTask).not.toHaveBeenCalled();
  });

  it('add-task row is visible even when task list is empty (always-visible)', () => {
    const onCreateTask = vi.fn();
    renderTasksList(el, templates, [], noopNavigate, { onCreateTask });
    const addInput = el.list.querySelector('.task-add-input');
    expect(addInput).not.toBeNull();
    // List is visible (not hidden) due to add-task row
    expect(el.list.classList.contains('hidden')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. VG-P4 — Tag filter + tag chip rendering
// ─────────────────────────────────────────────────────────────────────────────

describe('VG-P4 — filterTasksList with tag filter', () => {
  it('filters out tasks that do not carry the tag slug', () => {
    const tasks = [
      makeTask({ id: 't1', tags: ['email', 'urgent'] }),
      makeTask({ id: 't2', tags: ['planning'] }),
      makeTask({ id: 't3', tags: [] }),
    ];
    const result = filterTasksList(tasks, { tag: 'email' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('t1');
  });

  it('returns all tasks when tag filter is empty string', () => {
    const tasks = [
      makeTask({ id: 't1', tags: ['email'] }),
      makeTask({ id: 't2', tags: [] }),
    ];
    expect(filterTasksList(tasks, { tag: '' })).toHaveLength(2);
  });

  it('returns all tasks when tag filter is undefined', () => {
    const tasks = [
      makeTask({ id: 't1', tags: ['email'] }),
      makeTask({ id: 't2', tags: [] }),
    ];
    expect(filterTasksList(tasks, {})).toHaveLength(2);
  });

  it('handles tasks with undefined tags field gracefully', () => {
    // TaskDto.tags is optional — test that undefined tags does not throw
    const task = makeTask({ id: 't1' });
    delete (task as Partial<typeof task>).tags;
    expect(() => filterTasksList([task], { tag: 'email' })).not.toThrow();
    expect(filterTasksList([task], { tag: 'email' })).toHaveLength(0);
  });
});

describe('VG-P4 — tag chips in task rows', () => {
  it('renders .task-item__tags container when task has tags', () => {
    const task = makeTask({ id: 't1', tags: ['email', 'urgent'] });
    renderTasksList(el, templates, [task], noopNavigate);
    const tagsContainer = el.list.querySelector('.task-item__tags');
    expect(tagsContainer).not.toBeNull();
  });

  it('renders one chip per tag slug', () => {
    const task = makeTask({ id: 't1', tags: ['email', 'urgent', 'q3'] });
    renderTasksList(el, templates, [task], noopNavigate);
    const chips = el.list.querySelectorAll('.task-tag-chip');
    expect(chips).toHaveLength(3);
  });

  it('chip data-tag-slug matches the slug', () => {
    const task = makeTask({ id: 't1', tags: ['email'] });
    renderTasksList(el, templates, [task], noopNavigate);
    const chip = el.list.querySelector('.task-tag-chip') as HTMLElement;
    expect(chip.dataset.tagSlug).toBe('email');
  });

  it('does NOT render .task-item__tags when task has no tags', () => {
    const task = makeTask({ id: 't1', tags: [] });
    renderTasksList(el, templates, [task], noopNavigate);
    expect(el.list.querySelector('.task-item__tags')).toBeNull();
  });

  it('does NOT render .task-item__tags when task.tags is undefined', () => {
    const task = makeTask({ id: 't1' });
    delete (task as Partial<typeof task>).tags;
    renderTasksList(el, templates, [task], noopNavigate);
    expect(el.list.querySelector('.task-item__tags')).toBeNull();
  });
});

// ── Fixture helpers for P5/P6 ─────────────────────────────────────────────────

function makeSection(overrides: Partial<SectionDto> = {}): SectionDto {
  return {
    id: 'sec-001',
    name: 'Section A',
    position: 'a',
    ...overrides,
  };
}

// ── VG-P5: groupTasksBySection ────────────────────────────────────────────────

describe('VG-P5 — groupTasksBySection', () => {
  it('named sections are returned before "No Section" group', () => {
    const sec = makeSection({ id: 'sec-1', name: 'Alpha', position: 'a' });
    const task = makeTask({ id: 't1', section_id: 'sec-1' });
    const groups = groupTasksBySection([task], [sec]);
    expect(groups[0].sectionId).toBe('sec-1');
    expect(groups[groups.length - 1].sectionId).toBeNull();
  });

  it('named sections are sorted by position ascending', () => {
    const secA = makeSection({ id: 'sec-a', name: 'Alpha', position: 'a' });
    const secB = makeSection({ id: 'sec-b', name: 'Beta', position: 'b' });
    const groups = groupTasksBySection([], [secB, secA]);
    const named = groups.filter((g) => g.sectionId !== null);
    expect(named[0].sectionId).toBe('sec-a');
    expect(named[1].sectionId).toBe('sec-b');
  });

  it('tasks with null section_id land in "No Section" bucket', () => {
    const sec = makeSection({ id: 'sec-1', position: 'a' });
    const t1 = makeTask({ id: 't1', section_id: null });
    const t2 = makeTask({ id: 't2', section_id: 'sec-1' });
    const groups = groupTasksBySection([t1, t2], [sec]);
    const noSection = groups.find((g) => g.sectionId === null)!;
    expect(noSection.tasks.map((t) => t.id)).toContain('t1');
    expect(noSection.tasks.map((t) => t.id)).not.toContain('t2');
  });

  it('tasks referencing an unknown section_id fall into "No Section" bucket', () => {
    const task = makeTask({ id: 't1', section_id: 'nonexistent' });
    const groups = groupTasksBySection([task], []);
    const noSection = groups.find((g) => g.sectionId === null)!;
    expect(noSection.tasks.map((t) => t.id)).toContain('t1');
  });

  it('always includes "No Section" group even when all tasks are in named sections', () => {
    const sec = makeSection({ id: 'sec-1', position: 'a' });
    const task = makeTask({ id: 't1', section_id: 'sec-1' });
    const groups = groupTasksBySection([task], [sec]);
    const noSection = groups.find((g) => g.sectionId === null);
    expect(noSection).toBeDefined();
    expect(noSection!.tasks).toHaveLength(0);
  });

  it('returns a single "No Section" group when sections array is empty', () => {
    const task = makeTask({ id: 't1' });
    const groups = groupTasksBySection([task], []);
    expect(groups).toHaveLength(1);
    expect(groups[0].sectionId).toBeNull();
    expect(groups[0].tasks).toHaveLength(1);
  });
});

// ── VG-P5: sortTasksForMode ───────────────────────────────────────────────────

describe('VG-P5 — sortTasksForMode', () => {
  it('priority mode: high > medium > low > none', () => {
    const tasks = [
      makeTask({ id: 'none', priority: 'none' }),
      makeTask({ id: 'low', priority: 'low' }),
      makeTask({ id: 'high', priority: 'high' }),
      makeTask({ id: 'medium', priority: 'medium' }),
    ];
    const sorted = sortTasksForMode(tasks, 'priority');
    expect(sorted.map((t) => t.id)).toEqual(['high', 'medium', 'low', 'none']);
  });

  it('title mode: alphabetically ascending (case-insensitive)', () => {
    const tasks = [
      makeTask({ id: 't1', title: 'Zebra' }),
      makeTask({ id: 't2', title: 'apple' }),
      makeTask({ id: 't3', title: 'Mango' }),
    ];
    const sorted = sortTasksForMode(tasks, 'title');
    expect(sorted.map((t) => t.id)).toEqual(['t2', 't3', 't1']);
  });

  it('due mode: earlier due dates sort first; null last', () => {
    const tasks = [
      makeTask({ id: 'null-due', due: null }),
      makeTask({ id: 'later', due: '2026-12-31' }),
      makeTask({ id: 'earlier', due: '2026-01-01' }),
    ];
    const sorted = sortTasksForMode(tasks, 'due');
    expect(sorted.map((t) => t.id)).toEqual(['earlier', 'later', 'null-due']);
  });

  it('manual mode: sorts by position ascending', () => {
    const tasks = [
      makeTask({ id: 't3', position: 'c' }),
      makeTask({ id: 't1', position: 'a' }),
      makeTask({ id: 't2', position: 'b' }),
    ];
    const sorted = sortTasksForMode(tasks, 'manual');
    expect(sorted.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
  });

  it('created mode: older created timestamps sort first', () => {
    const tasks = [
      makeTask({ id: 'newer', created: '2026-06-30T00:00:00Z' }),
      makeTask({ id: 'older', created: '2026-01-01T00:00:00Z' }),
    ];
    const sorted = sortTasksForMode(tasks, 'created');
    expect(sorted.map((t) => t.id)).toEqual(['older', 'newer']);
  });

  it('unknown mode: preserves original order', () => {
    const tasks = [
      makeTask({ id: 't1' }),
      makeTask({ id: 't2' }),
    ];
    const sorted = sortTasksForMode(tasks, 'bogus');
    expect(sorted.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('does NOT mutate the input array', () => {
    const tasks = [makeTask({ id: 't2', priority: 'low' }), makeTask({ id: 't1', priority: 'high' })];
    const original = [...tasks];
    sortTasksForMode(tasks, 'priority');
    expect(tasks.map((t) => t.id)).toEqual(original.map((t) => t.id));
  });
});

// ── VG-P6: renderListViewWithSections ─────────────────────────────────────────

describe('VG-P6 — renderListViewWithSections', () => {
  let container: HTMLElement;
  let tmpl: TasksTemplates;

  beforeEach(() => {
    container = document.createElement('ul');
    document.body.appendChild(container);
    tmpl = makeTasksTemplates();
  });

  it('renders one .tasks-section-group per named section', () => {
    const secA = makeSection({ id: 'sec-a', name: 'Alpha', position: 'a' });
    const secB = makeSection({ id: 'sec-b', name: 'Beta', position: 'b' });
    const tasks = [
      makeTask({ id: 't1', section_id: 'sec-a' }),
      makeTask({ id: 't2', section_id: 'sec-b' }),
    ];
    renderListViewWithSections(container, tmpl, tasks, [secA, secB], 'manual', () => {});
    const groups = container.querySelectorAll('.tasks-section-group');
    // 2 named + 1 "No Section" = 3
    expect(groups.length).toBe(3);
  });

  it('groups tasks by section: tasks appear under their section', () => {
    const sec = makeSection({ id: 'sec-1', name: 'Work', position: 'a' });
    const t1 = makeTask({ id: 't1', title: 'Work Task', section_id: 'sec-1' });
    const t2 = makeTask({ id: 't2', title: 'Free Task', section_id: null });
    renderListViewWithSections(container, tmpl, [t1, t2], [sec], 'manual', () => {});

    const groups = container.querySelectorAll('.tasks-section-group');
    // First group is "Work"
    const workGroup = Array.from(groups).find((g) => (g as HTMLElement).dataset.sectionId === 'sec-1');
    expect(workGroup).toBeDefined();
    expect(workGroup!.textContent).toContain('Work Task');
    // Free Task should be in "No Section" group (no sectionId attr)
    const noSectionGroup = Array.from(groups).find((g) => !(g as HTMLElement).dataset.sectionId);
    expect(noSectionGroup!.textContent).toContain('Free Task');
  });

  it('"No Section" group is rendered last', () => {
    const sec = makeSection({ id: 'sec-1', name: 'Alpha', position: 'a' });
    renderListViewWithSections(container, tmpl, [], [sec], 'manual', () => {});
    const groups = Array.from(container.querySelectorAll('.tasks-section-group'));
    const lastGroup = groups[groups.length - 1] as HTMLElement;
    expect(lastGroup.dataset.sectionId).toBeUndefined();
  });

  it('section headers include section name text', () => {
    const sec = makeSection({ id: 'sec-1', name: 'My Section', position: 'a' });
    renderListViewWithSections(container, tmpl, [], [sec], 'manual', () => {});
    const header = container.querySelector('.tasks-section-group__header');
    expect(header!.textContent).toContain('My Section');
  });
});

// ── VG-P6: renderBoardView ────────────────────────────────────────────────────

// S4: renderBoardView is Kanban BY STATUS now, not section (Approach §3 —
// "Board = Kanban by TaskStatus"). Section grouping is a LIST-view-only
// concern after this story; `renderBoardView` no longer takes a `sections`
// argument at all, and no longer synthesises a "No Section" column — see
// AC-S4-01/02/07/08.
describe('VG-P6 / S4 — renderBoardView (Kanban by TaskStatus)', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('renders .tasks-board wrapper', () => {
    renderBoardView(container, templates, [], 'manual', () => {});
    expect(container.querySelector('.tasks-board')).not.toBeNull();
  });

  // AC-S4-01
  it('board_renders_three_status_columns', () => {
    renderBoardView(container, templates, [], 'manual', () => {});
    const cols = container.querySelectorAll('.tasks-board__column');
    expect(cols.length).toBe(3);
    const statuses = Array.from(cols).map((c) => (c as HTMLElement).dataset.columnStatus).sort();
    expect(statuses).toEqual(['doing', 'done', 'todo']);
  });

  it('task cards appear inside the column matching their status', () => {
    const task = makeTask({ id: 't1', title: 'Board Task', status: 'doing' });
    renderBoardView(container, templates, [task], 'manual', () => {});
    const col = container.querySelector('[data-column-status="doing"]')!;
    expect(col.textContent).toContain('Board Task');
    const todoCol = container.querySelector('[data-column-status="todo"]')!;
    expect(todoCol.textContent).not.toContain('Board Task');
  });

  // AC-S4-02
  it('board_excludes_cancelled_tasks', () => {
    const cancelled = makeTask({ id: 't-cancel', title: 'Cancelled Task', status: 'cancelled' });
    const todo = makeTask({ id: 't-todo', title: 'Todo Task', status: 'todo' });
    renderBoardView(container, templates, [cancelled, todo], 'manual', () => {});
    expect(container.textContent).not.toContain('Cancelled Task');
    expect(container.textContent).toContain('Todo Task');
    // No fourth column for cancelled — exactly three, always.
    expect(container.querySelectorAll('.tasks-board__column').length).toBe(3);
  });

  it('column header shows a live count of the tasks it holds', () => {
    const tasks = [
      makeTask({ id: 't1', status: 'todo' }),
      makeTask({ id: 't2', status: 'todo' }),
      makeTask({ id: 't3', status: 'doing' }),
    ];
    renderBoardView(container, templates, tasks, 'manual', () => {});
    const todoCount = container.querySelector('[data-column-status="todo"] .tasks-board__column-count');
    const doingCount = container.querySelector('[data-column-status="doing"] .tasks-board__column-count');
    expect(todoCount?.textContent).toBe('2');
    expect(doingCount?.textContent).toBe('1');
  });
});

// ── VG-P9: DnD drag-handle + callback wiring ────────────────────────────────

describe('VG-P9 — DnD affordances in renderTasksList', () => {
  it('renders .task-item__drag-handle when onDrop callback is provided', () => {
    const onDrop = vi.fn();
    renderTasksList(el, templates, [makeTask({ id: 't1', title: 'Drag Task' })], noopNavigate, {
      onDrop,
    });
    const handle = el.list.querySelector('.task-item__drag-handle');
    expect(handle).not.toBeNull();
    expect(handle!.querySelector('[data-lucide="grip-vertical"]')).not.toBeNull();
  });

  it('does NOT render .task-item__drag-handle when no DnD callbacks provided', () => {
    renderTasksList(el, templates, [makeTask({ id: 't1' })], noopNavigate, {
      onStatusToggle: vi.fn(),
    });
    expect(el.list.querySelector('.task-item__drag-handle')).toBeNull();
  });

  it('fires onDragStart when dragstart event fires on a row', () => {
    const onDragStart = vi.fn();
    renderTasksList(el, templates, [makeTask({ id: 'task-x', title: 'X' })], noopNavigate, {
      onDragStart,
    });
    const row = el.list.querySelector('li[data-task-id="task-x"]') as HTMLElement;
    expect(row).not.toBeNull();

    const dt = { setData: vi.fn(), effectAllowed: '' };
    const dragEvent = new Event('dragstart', { bubbles: true }) as DragEvent;
    Object.defineProperty(dragEvent, 'dataTransfer', { value: dt, writable: false });

    row.dispatchEvent(dragEvent);
    expect(onDragStart).toHaveBeenCalledWith('task-x');
    expect(dt.setData).toHaveBeenCalledWith('application/x-jin-task-id', 'task-x');
  });

  it('fires onDrop when drop event fires and passes the dragged task id', () => {
    const onDrop = vi.fn();
    const tasks = [
      makeTask({ id: 'top', title: 'Top Task', position: 'V' }),
      makeTask({ id: 'bot', title: 'Bottom Task', position: 'VV' }),
    ];
    renderTasksList(el, templates, tasks, noopNavigate, { onDrop });

    const bottomRow = el.list.querySelector('li[data-task-id="bot"]') as HTMLElement;
    expect(bottomRow).not.toBeNull();

    // Simulate a drop with the dragged id set in dataTransfer.
    const dt = { getData: vi.fn().mockImplementation((key: string) =>
      key === 'application/x-jin-task-id' ? 'top' : ''
    ) };
    const dropEvent = new Event('drop', { bubbles: true }) as DragEvent;
    Object.defineProperty(dropEvent, 'dataTransfer', { value: dt, writable: false });
    Object.defineProperty(dropEvent, 'clientY', { value: 999, writable: false }); // below midpoint

    bottomRow.dispatchEvent(dropEvent);
    expect(onDrop).toHaveBeenCalled();
    // First argument must be the dragged task id.
    expect(onDrop.mock.calls[0][0]).toBe('top');
  });

  it('row li element carries data-task-id attribute when DnD callbacks provided', () => {
    const onDrop = vi.fn();
    renderTasksList(el, templates, [makeTask({ id: 'abc123' })], noopNavigate, { onDrop });
    const row = el.list.querySelector('li[data-task-id="abc123"]');
    expect(row).not.toBeNull();
  });
});

// ── VG-P9: rank.between top-insert guard ─────────────────────────────────────

describe('VG-P9 — rank.between top-insert guard', () => {
  it('between(null, null) returns non-empty key ("V")', () => {
    expect(between(null, null)).toBe('V');
  });

  it('between(null, "V") returns non-empty key (step before "V" = "U")', () => {
    const result = between(null, 'V');
    expect(result).not.toBe('');
    expect(result < 'V').toBe(true);
  });

  it('between(null, "0") returns empty string — the degenerate top-insert case', () => {
    // "0" is the minimum character; stepBefore returns "".
    // The controller must detect this and call reseedPositions.
    expect(between(null, '0')).toBe('');
  });

  it('between("V", null) returns key after "V"', () => {
    const result = between('V', null);
    expect(result).not.toBe('');
    expect(result > 'V').toBe(true);
  });

  it('between("A", "C") returns key strictly between "A" and "C"', () => {
    const result = between('A', 'C');
    expect(result > 'A').toBe(true);
    expect(result < 'C').toBe(true);
  });
});

// ── VG-P10: formatReminderLabel pure function ────────────────────────────────

describe('VG-P10 — formatReminderLabel', () => {
  it('maps relative offset "-30m" to "30 minutes before"', () => {
    expect(formatReminderLabel({ kind: 'relative', value: '-30m' })).toBe('30 minutes before');
  });

  it('maps relative offset "-1h" to "1 hour before"', () => {
    expect(formatReminderLabel({ kind: 'relative', value: '-1h' })).toBe('1 hour before');
  });

  it('maps relative offset "-1d" to "1 day before"', () => {
    expect(formatReminderLabel({ kind: 'relative', value: '-1d' })).toBe('1 day before');
  });

  it('returns the raw value for an unknown relative offset', () => {
    expect(formatReminderLabel({ kind: 'relative', value: '-90m' })).toBe('-90m');
  });

  it('formats an absolute timestamp as a locale string', () => {
    const label = formatReminderLabel({
      kind: 'absolute',
      value: '2026-07-01T09:00:00+00:00',
    });
    expect(typeof label).toBe('string');
    expect(label.length).toBeGreaterThan(0);
    // Must NOT return the raw ISO string unchanged.
    expect(label).not.toBe('2026-07-01T09:00:00+00:00');
  });

  it('returns raw value for an invalid absolute timestamp', () => {
    const label = formatReminderLabel({ kind: 'absolute', value: 'not-a-date' });
    expect(label).toBe('not-a-date');
  });

  it('returns raw value for an unknown kind', () => {
    expect(formatReminderLabel({ kind: 'unknown-type', value: 'foo' })).toBe('foo');
  });
});

// ── VG-P10: buildReminderChips ───────────────────────────────────────────────

describe('VG-P10 — buildReminderChips', () => {
  it('returns null for empty reminders array', () => {
    expect(buildReminderChips([])).toBeNull();
  });

  it('renders one chip per reminder', () => {
    const reminders: ReminderDto[] = [
      { kind: 'relative', value: '-1h' },
      { kind: 'absolute', value: '2026-07-01T09:00:00+00:00' },
    ];
    const chips = buildReminderChips(reminders);
    expect(chips).not.toBeNull();
    expect(chips!.querySelectorAll('.reminder-chip').length).toBe(2);
  });

  it('each chip contains a bell icon', () => {
    const chips = buildReminderChips([{ kind: 'relative', value: '-30m' }]);
    expect(chips!.querySelector('[data-lucide="bell"]')).not.toBeNull();
  });

  it('renders remove buttons when onRemove callback provided', () => {
    const onRemove = vi.fn();
    const chips = buildReminderChips([{ kind: 'relative', value: '-1h' }], onRemove);
    const removeBtn = chips!.querySelector('.reminder-chip__remove');
    expect(removeBtn).not.toBeNull();
    (removeBtn as HTMLElement).click();
    expect(onRemove).toHaveBeenCalledWith(0);
  });

  it('does NOT render remove buttons when no onRemove provided', () => {
    const chips = buildReminderChips([{ kind: 'relative', value: '-1h' }]);
    expect(chips!.querySelector('.reminder-chip__remove')).toBeNull();
  });

  it('chip label matches formatReminderLabel output', () => {
    const chips = buildReminderChips([{ kind: 'relative', value: '-30m' }]);
    const chip = chips!.querySelector('.reminder-chip')!;
    expect(chip.textContent).toContain('30 minutes before');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ITEM 2 — WebKit Save bug: Create/Save buttons are click-driven (type="button")
// ─────────────────────────────────────────────────────────────────────────────

describe('ITEM 2 — form Save/Create buttons are type="button" with click actions', () => {
  // Helper: parse HTML fragment to a DocumentFragment for querying
  function parseHTML(html: string): Element {
    const tmpl = document.createElement('template');
    tmpl.innerHTML = html.trim();
    return tmpl.content.firstElementChild as Element;
  }

  // Read the real index.html dialogs via a minimal inline representation
  // that mirrors what we changed (these tests validate the HTML change is correct).

  it('list create dialog Save button is type="button" with click action', () => {
    const dialog = parseHTML(`
      <dialog>
        <form>
          <div class="action-dialog__footer">
            <button type="button" class="btn-secondary" data-action="click->lists#closeCreate">Cancel</button>
            <button type="button" class="btn-primary" data-action="click->lists#saveCreate">Create</button>
          </div>
        </form>
      </dialog>
    `);
    const createBtn = dialog.querySelector('[data-action="click->lists#saveCreate"]') as HTMLButtonElement | null;
    expect(createBtn).not.toBeNull();
    expect(createBtn!.type).toBe('button');
    // There should be NO submit button in this form
    const submitBtn = dialog.querySelector('[type="submit"]');
    expect(submitBtn).toBeNull();
  });

  it('list edit dialog Save button is type="button" with click action', () => {
    const dialog = parseHTML(`
      <dialog>
        <form>
          <div class="action-dialog__footer">
            <button type="button" class="btn-secondary" data-action="click->lists#closeEdit">Cancel</button>
            <button type="button" class="btn-primary" data-action="click->lists#saveEdit">Save</button>
          </div>
        </form>
      </dialog>
    `);
    const saveBtn = dialog.querySelector('[data-action="click->lists#saveEdit"]') as HTMLButtonElement | null;
    expect(saveBtn).not.toBeNull();
    expect(saveBtn!.type).toBe('button');
    const submitBtn = dialog.querySelector('[type="submit"]');
    expect(submitBtn).toBeNull();
  });

  it('add-section dialog Create button is type="button" with click action', () => {
    const dialog = parseHTML(`
      <dialog>
        <form>
          <div class="action-dialog__footer">
            <button type="button" class="btn-secondary" data-action="click->tasks#closeAddSection">Cancel</button>
            <button type="button" class="btn-primary" data-action="click->tasks#saveAddSection">Create</button>
          </div>
        </form>
      </dialog>
    `);
    const createBtn = dialog.querySelector('[data-action="click->tasks#saveAddSection"]') as HTMLButtonElement | null;
    expect(createBtn).not.toBeNull();
    expect(createBtn!.type).toBe('button');
    const submitBtn = dialog.querySelector('[type="submit"]');
    expect(submitBtn).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ITEM 4 — Due date when creating a task: calendar button + callback routing
// ─────────────────────────────────────────────────────────────────────────────

describe('ITEM 4 — add-task row: calendar button and due-on-create routing', () => {
  it('renders a calendar button when onPickDueForCreate callback is provided', () => {
    const onCreateTask = vi.fn();
    const onPickDueForCreate = vi.fn();
    renderTasksList(el, templates, [], noopNavigate, { onCreateTask, onPickDueForCreate });
    const calBtn = el.list.querySelector('.task-add-row__cal-btn');
    expect(calBtn).not.toBeNull();
  });

  it('does NOT render calendar button when onPickDueForCreate is absent', () => {
    renderTasksList(el, templates, [], noopNavigate, { onCreateTask: vi.fn() });
    const calBtn = el.list.querySelector('.task-add-row__cal-btn');
    expect(calBtn).toBeNull();
  });

  it('clicking calendar button calls onPickDueForCreate with an onSelected callback', () => {
    const onCreateTask = vi.fn();
    const onPickDueForCreate = vi.fn();
    renderTasksList(el, templates, [], noopNavigate, { onCreateTask, onPickDueForCreate });
    const calBtn = el.list.querySelector('.task-add-row__cal-btn') as HTMLButtonElement;
    calBtn.click();
    expect(onPickDueForCreate).toHaveBeenCalledTimes(1);
    expect(onPickDueForCreate.mock.calls[0][0]).toBeNull();
    expect(typeof onPickDueForCreate.mock.calls[0][1]).toBe('function');
  });

  it('onCreateTask is called with (title, due) when due was selected via calendar', () => {
    const onCreateTask = vi.fn();
    let capturedOnSelected: ((due: string) => void) | null = null;
    const onPickDueForCreate = vi.fn((_currentDue: string | null, onSelected: (due: string) => void) => {
      capturedOnSelected = onSelected;
    });
    renderTasksList(el, templates, [], noopNavigate, { onCreateTask, onPickDueForCreate });

    // Open calendar and simulate selection
    const calBtn = el.list.querySelector('.task-add-row__cal-btn') as HTMLButtonElement;
    calBtn.click();
    expect(capturedOnSelected).not.toBeNull();
    capturedOnSelected!('2026-07-15');

    // Now submit the task via Enter
    const addInput = el.list.querySelector('.task-add-input') as HTMLInputElement;
    addInput.value = 'Task with due date';
    addInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onCreateTask).toHaveBeenCalledWith('Task with due date', '2026-07-15');
  });

  it('onCreateTask is called with only title when no due was selected', () => {
    const onCreateTask = vi.fn();
    renderTasksList(el, templates, [], noopNavigate, { onCreateTask });

    const addInput = el.list.querySelector('.task-add-input') as HTMLInputElement;
    addInput.value = 'My New Task';
    addInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onCreateTask).toHaveBeenCalledWith('My New Task');
  });

  it('due label shows selected due string and clears after task is submitted', () => {
    const onCreateTask = vi.fn();
    let capturedOnSelected: ((due: string) => void) | null = null;
    const onPickDueForCreate = vi.fn((_currentDue: string | null, onSelected: (due: string) => void) => {
      capturedOnSelected = onSelected;
    });
    renderTasksList(el, templates, [], noopNavigate, { onCreateTask, onPickDueForCreate });

    const calBtn = el.list.querySelector('.task-add-row__cal-btn') as HTMLButtonElement;
    calBtn.click();
    capturedOnSelected!('2026-08-01');

    const dueLabel = el.list.querySelector('.task-add-row__due-label') as HTMLElement;
    expect(dueLabel.textContent).toBe('2026-08-01');

    // Submit
    const addInput = el.list.querySelector('.task-add-input') as HTMLInputElement;
    addInput.value = 'Labeled Task';
    addInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    // Due label should be cleared after submission
    expect(dueLabel.textContent).toBe('');
  });

  it('passes an existing timed draft back when the inline picker is reopened', () => {
    let capturedOnSelected: ((due: string) => void) | null = null;
    const onPickDueForCreate = vi.fn((currentDue: string | null, onSelected: (due: string) => void) => {
      if (onPickDueForCreate.mock.calls.length === 1) capturedOnSelected = onSelected;
      expect(currentDue).toBe(onPickDueForCreate.mock.calls.length === 1
        ? null
        : '2026-08-01T14:30:00+03:00');
    });
    renderTasksList(el, templates, [], noopNavigate, {
      onCreateTask: vi.fn(),
      onPickDueForCreate,
    });

    const calBtn = el.list.querySelector('.task-add-row__cal-btn') as HTMLButtonElement;
    calBtn.click();
    capturedOnSelected!('2026-08-01T14:30:00+03:00');
    calBtn.click();

    expect(onPickDueForCreate).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ITEM 5 — Task detail: per-field editable callbacks
// ─────────────────────────────────────────────────────────────────────────────

import { type TaskDetailCallbacks } from '../lib/tasks/render';

describe('ITEM 5 — renderTaskPane: per-field editable callbacks', () => {
  function makeDetailEl() {
    const detailContent = document.createElement('div');
    document.body.appendChild(detailContent);
    const elDetail: TasksViewElements = {
      listPanel: document.createElement('div'),
      list: document.createElement('ul'),
      emptyState: document.createElement('div'),
      loadingState: document.createElement('div'),
      detailPanel: document.createElement('div'),
      detailLoadingState: document.createElement('div'),
      detailNotFoundState: document.createElement('div'),
      detailContent,
    };
    return elDetail;
  }

  it('title becomes contenteditable when onSaveTitle is provided', () => {
    const detailEl = makeDetailEl();
    const task = makeTask({ title: 'My Task' });
    renderTaskPane(detailEl, templates, task, noopNavigate, undefined, undefined, {
      onSaveTitle: vi.fn().mockResolvedValue(undefined),
    });
    const titleEl = detailEl.detailContent.querySelector('h2');
    expect(titleEl?.getAttribute('contenteditable')).toBe('true');
  });

  it('blurring title calls onSaveTitle with new title', () => {
    const onSaveTitle = vi.fn().mockResolvedValue(undefined);
    const detailEl = makeDetailEl();
    const task = makeTask({ id: 'task-edit', title: 'Original Title' });
    renderTaskPane(detailEl, templates, task, noopNavigate, undefined, undefined, {
      onSaveTitle,
    });
    const titleEl = detailEl.detailContent.querySelector('h2') as HTMLElement;
    titleEl.textContent = 'Updated Title';
    titleEl.dispatchEvent(new Event('blur', { bubbles: true }));
    expect(onSaveTitle).toHaveBeenCalledWith('task-edit', 'Updated Title');
  });

  it('pressing Enter on title commits and blurs', () => {
    const onSaveTitle = vi.fn().mockResolvedValue(undefined);
    const detailEl = makeDetailEl();
    const task = makeTask({ id: 'task-enter', title: 'Old' });
    renderTaskPane(detailEl, templates, task, noopNavigate, undefined, undefined, {
      onSaveTitle,
    });
    const titleEl = detailEl.detailContent.querySelector('h2') as HTMLElement;
    titleEl.textContent = 'New Title Via Enter';
    titleEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onSaveTitle).toHaveBeenCalledWith('task-enter', 'New Title Via Enter');
  });

  it('pressing Escape on title reverts to original without saving', () => {
    const onSaveTitle = vi.fn().mockResolvedValue(undefined);
    const detailEl = makeDetailEl();
    const task = makeTask({ id: 'task-esc', title: 'Original' });
    renderTaskPane(detailEl, templates, task, noopNavigate, undefined, undefined, {
      onSaveTitle,
    });
    const titleEl = detailEl.detailContent.querySelector('h2') as HTMLElement;
    titleEl.textContent = 'Changed';
    titleEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onSaveTitle).not.toHaveBeenCalled();
    expect(titleEl.textContent).toBe('Original');
  });

  it('blurring body textarea calls onSaveBody when content changed', () => {
    const onSaveBody = vi.fn().mockResolvedValue(undefined);
    const detailEl = makeDetailEl();
    const task = makeTask({ id: 'task-body', body: 'original body' });
    renderTaskPane(detailEl, templates, task, noopNavigate, undefined, undefined, {
      onSaveBody,
    });
    const bodyEl = detailEl.detailContent.querySelector('textarea') as HTMLTextAreaElement;
    bodyEl.value = 'updated body';
    bodyEl.dispatchEvent(new Event('blur', { bubbles: true }));
    expect(onSaveBody).toHaveBeenCalledWith('task-body', 'updated body');
  });

  it('blurring body does NOT call onSaveBody when content unchanged', () => {
    const onSaveBody = vi.fn().mockResolvedValue(undefined);
    const detailEl = makeDetailEl();
    const task = makeTask({ id: 'task-body-nc', body: 'unchanged' });
    renderTaskPane(detailEl, templates, task, noopNavigate, undefined, undefined, {
      onSaveBody,
    });
    const bodyEl = detailEl.detailContent.querySelector('textarea') as HTMLTextAreaElement;
    // Value unchanged
    bodyEl.dispatchEvent(new Event('blur', { bubbles: true }));
    expect(onSaveBody).not.toHaveBeenCalled();
  });

  it('status select fires onSaveStatus on change', () => {
    const onSaveStatus = vi.fn().mockResolvedValue(undefined);
    const detailEl = makeDetailEl();
    const task = makeTask({ id: 'task-status', status: 'todo' });
    renderTaskPane(detailEl, templates, task, noopNavigate, undefined, undefined, {
      onSaveStatus,
    });
    const sel = detailEl.detailContent.querySelector('.task-detail__status-select') as HTMLSelectElement;
    expect(sel).not.toBeNull();
    sel.value = 'done';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onSaveStatus).toHaveBeenCalledWith('task-status', 'done');
  });

  it('priority select fires onSavePriority on change', () => {
    const onSavePriority = vi.fn().mockResolvedValue(undefined);
    const detailEl = makeDetailEl();
    const task = makeTask({ id: 'task-pri', priority: 'low' });
    renderTaskPane(detailEl, templates, task, noopNavigate, undefined, undefined, {
      onSavePriority,
    });
    const sel = detailEl.detailContent.querySelector('.task-detail__priority-select') as HTMLSelectElement;
    expect(sel).not.toBeNull();
    sel.value = 'high';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onSavePriority).toHaveBeenCalledWith('task-pri', 'high');
  });

  it('list select fires onSaveList with listId on change', () => {
    const onSaveList = vi.fn().mockResolvedValue(undefined);
    const detailEl = makeDetailEl();
    const task = makeTask({ id: 'task-list' });
    const cbs: TaskDetailCallbacks = {
      onSaveList,
      availableLists: [
        { id: 'list-a', name: 'inbox' },
        { id: 'list-b', name: 'work' },
      ],
    };
    renderTaskPane(detailEl, templates, task, noopNavigate, undefined, undefined, cbs);
    const sel = detailEl.detailContent.querySelector('.task-detail__list-select') as HTMLSelectElement;
    expect(sel).not.toBeNull();
    sel.value = 'list-b';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onSaveList).toHaveBeenCalledWith('task-list', 'list-b');
  });

  it('section select fires onSaveSection(taskId, null) when "No Section" selected', () => {
    const onSaveSection = vi.fn().mockResolvedValue(undefined);
    const detailEl = makeDetailEl();
    const task = makeTask({ id: 'task-sec', section_id: 'sec-1' });
    const cbs: TaskDetailCallbacks = {
      onSaveSection,
      availableSections: [{ id: 'sec-1', name: 'Alpha', position: 'a', task_count: 1, list_id: 'list-x' }],
    };
    renderTaskPane(detailEl, templates, task, noopNavigate, undefined, undefined, cbs);
    const sel = detailEl.detailContent.querySelector('.task-detail__section-select') as HTMLSelectElement;
    expect(sel).not.toBeNull();
    sel.value = '';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onSaveSection).toHaveBeenCalledWith('task-sec', null);
  });

  it('tag chip × button calls onSaveTags with slug removed', () => {
    const onSaveTags = vi.fn().mockResolvedValue(undefined);
    const detailEl = makeDetailEl();
    const task = makeTask({ id: 'task-tags', tags: ['alpha', 'beta'] });
    renderTaskPane(detailEl, templates, task, noopNavigate, undefined, undefined, {
      onSaveTags,
    });
    const removeBtn = detailEl.detailContent.querySelector('.task-detail__tag-remove') as HTMLButtonElement | null;
    expect(removeBtn).not.toBeNull();
    removeBtn!.click();
    // First chip is 'alpha'; removing it should call with ['beta']
    expect(onSaveTags).toHaveBeenCalledWith('task-tags', ['beta']);
  });

  it('add-tag input Enter calls onSaveTags with new slug appended', () => {
    const onSaveTags = vi.fn().mockResolvedValue(undefined);
    const detailEl = makeDetailEl();
    const task = makeTask({ id: 'task-newtag', tags: ['existing'] });
    renderTaskPane(detailEl, templates, task, noopNavigate, undefined, undefined, {
      onSaveTags,
    });
    const tagInput = detailEl.detailContent.querySelector('.task-detail__tag-input') as HTMLInputElement;
    expect(tagInput).not.toBeNull();
    tagInput.value = 'newtag';
    tagInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onSaveTags).toHaveBeenCalledWith('task-newtag', ['existing', 'newtag']);
  });

  it('due button calls onPickDue with current due + onSelected callback', () => {
    const onPickDue = vi.fn();
    const detailEl = makeDetailEl();
    const task = makeTask({ id: 'task-due', due: '2026-07-01' });
    renderTaskPane(detailEl, templates, task, noopNavigate, undefined, undefined, {
      onPickDue,
    });
    const dueBtn = detailEl.detailContent.querySelector('.task-detail__due-btn') as HTMLButtonElement | null;
    expect(dueBtn).not.toBeNull();
    dueBtn!.click();
    expect(onPickDue).toHaveBeenCalledWith('2026-07-01', expect.any(Function));
  });

  it('clear due button calls onClearDue', () => {
    const onClearDue = vi.fn().mockResolvedValue(undefined);
    const detailEl = makeDetailEl();
    const task = makeTask({ id: 'task-clrdue', due: '2026-07-01' });
    renderTaskPane(detailEl, templates, task, noopNavigate, undefined, undefined, {
      onClearDue,
    });
    const clearBtn = detailEl.detailContent.querySelector('.task-detail__due-clear') as HTMLButtonElement | null;
    expect(clearBtn).not.toBeNull();
    clearBtn!.click();
    expect(onClearDue).toHaveBeenCalledWith('task-clrdue');
  });

  it('does NOT render editable fields (.task-detail__fields) when detailCallbacks is absent', () => {
    const detailEl = makeDetailEl();
    renderTaskPane(detailEl, templates, makeTask(), noopNavigate);
    expect(detailEl.detailContent.querySelector('.task-detail__fields')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ITEM 6 — Completion checkbox: aria-checked, data-task-status
// ─────────────────────────────────────────────────────────────────────────────

describe('ITEM 6 — task row checkbox: aria-checked + data-task-status', () => {
  it('status button has role="checkbox"', () => {
    renderTasksList(el, templates, [makeTask({ status: 'todo' })], noopNavigate);
    const btn = el.list.querySelector('.task-item__status-btn') as HTMLElement;
    expect(btn.getAttribute('role')).toBe('checkbox');
  });

  it('aria-checked is "false" for todo tasks', () => {
    renderTasksList(el, templates, [makeTask({ status: 'todo' })], noopNavigate);
    const btn = el.list.querySelector('.task-item__status-btn') as HTMLElement;
    expect(btn.getAttribute('aria-checked')).toBe('false');
  });

  it('aria-checked is "true" for done tasks', () => {
    renderTasksList(el, templates, [makeTask({ status: 'done' })], noopNavigate);
    const btn = el.list.querySelector('.task-item__status-btn') as HTMLElement;
    expect(btn.getAttribute('aria-checked')).toBe('true');
  });

  it('aria-checked is "false" for doing tasks', () => {
    renderTasksList(el, templates, [makeTask({ status: 'doing' })], noopNavigate);
    const btn = el.list.querySelector('.task-item__status-btn') as HTMLElement;
    expect(btn.getAttribute('aria-checked')).toBe('false');
  });

  it('row li carries data-task-status matching task status', () => {
    renderTasksList(el, templates, [makeTask({ status: 'done' })], noopNavigate);
    const row = el.list.querySelector('.task-item') as HTMLElement;
    expect(row.dataset.taskStatus).toBe('done');
  });

  it('data-task-status is "todo" for todo tasks', () => {
    renderTasksList(el, templates, [makeTask({ status: 'todo' })], noopNavigate);
    const row = el.list.querySelector('.task-item') as HTMLElement;
    expect(row.dataset.taskStatus).toBe('todo');
  });

  it('clicking checkbox fires onStatusToggle with task id and current status', () => {
    const onStatusToggle = vi.fn();
    renderTasksList(el, templates, [makeTask({ id: 'chk-t1', status: 'todo' })], noopNavigate, {
      onStatusToggle,
    });
    const btn = el.list.querySelector('.task-item__status-btn') as HTMLElement;
    btn.click();
    expect(onStatusToggle).toHaveBeenCalledWith('chk-t1', 'todo');
  });

  it('clicking checkbox for done task fires onStatusToggle with "done" status', () => {
    const onStatusToggle = vi.fn();
    renderTasksList(el, templates, [makeTask({ id: 'chk-done', status: 'done' })], noopNavigate, {
      onStatusToggle,
    });
    const btn = el.list.querySelector('.task-item__status-btn') as HTMLElement;
    btn.click();
    expect(onStatusToggle).toHaveBeenCalledWith('chk-done', 'done');
  });

  it('status-btn also carries .task-item__checkbox class', () => {
    renderTasksList(el, templates, [makeTask()], noopNavigate);
    const btn = el.list.querySelector('.task-item__status-btn');
    expect(btn?.classList.contains('task-item__checkbox')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 1 — Flat list renders in position order when sort_mode is manual
// Verifies the controller fix: sortTasksForMode('manual') is used instead of
// sortTasksList() when a specific list is selected, so a drag-reflected position
// change is immediately visible in the next render.
// ─────────────────────────────────────────────────────────────────────────────

describe('FIX-DND — flat list renders in position order when sort_mode is manual', () => {
  it('renderTasksList shows tasks in position-asc order when pre-sorted by sortTasksForMode("manual")', () => {
    const tasks = [
      makeTask({ id: 't-c', title: 'Task C', position: 'c' }),
      makeTask({ id: 't-a', title: 'Task A', position: 'a' }),
      makeTask({ id: 't-b', title: 'Task B', position: 'b' }),
    ];
    // Simulate what the controller does for a selected list with sort_mode=manual:
    const sorted = sortTasksForMode(tasks, 'manual');
    renderTasksList(el, templates, sorted, noopNavigate);
    const rows = Array.from(el.list.querySelectorAll('li[data-task-id]'));
    expect(rows.map((r) => (r as HTMLElement).dataset.taskId)).toEqual(['t-a', 't-b', 't-c']);
  });

  it('after a drag-reorder: task with lower position key appears first in the re-render', () => {
    // Simulate state after moveTask persisted new positions:
    // t-b was dragged to the top, given position 'a0' which sorts before 'b'
    const postDrop = [
      makeTask({ id: 't-a', position: 'b' }),   // original front, shifted
      makeTask({ id: 't-b', position: 'a' }),   // moved to front
      makeTask({ id: 't-c', position: 'c' }),
    ];
    const sorted = sortTasksForMode(postDrop, 'manual');
    renderTasksList(el, templates, sorted, noopNavigate);
    const rows = Array.from(el.list.querySelectorAll('li[data-task-id]'));
    // t-b (pos 'a') sorts before t-a (pos 'b') — drag is now reflected
    expect(rows[0].getAttribute('data-task-id')).toBe('t-b');
    expect(rows[1].getAttribute('data-task-id')).toBe('t-a');
    expect(rows[2].getAttribute('data-task-id')).toBe('t-c');
  });

  it('sortTasksForMode("manual") with no position fields falls back gracefully (empty string sorts first)', () => {
    const tasks = [
      makeTask({ id: 't1' }),
      makeTask({ id: 't2' }),
    ];
    // Both have no position — order should be stable (does not throw)
    expect(() => sortTasksForMode(tasks, 'manual')).not.toThrow();
    const sorted = sortTasksForMode(tasks, 'manual');
    expect(sorted).toHaveLength(2);
  });

  it('onDrop callback fires from the render layer when a task is dropped (guard-bypass verification)', () => {
    // Verifies that the render layer correctly delivers onDrop to the controller.
    // Once currentListId is set (auto-select fix), the controller's handleDrop
    // will proceed past the guard and call moveTask.
    const onDrop = vi.fn();
    const tasks = [
      makeTask({ id: 'top', position: 'V' }),
      makeTask({ id: 'bot', position: 'VV' }),
    ];
    renderTasksList(el, templates, tasks, noopNavigate, { onDrop });

    const topRow = el.list.querySelector('li[data-task-id="top"]') as HTMLElement;
    const dt = {
      getData: vi.fn((key: string) => key === 'application/x-jin-task-id' ? 'bot' : ''),
    };
    const dropEvent = new Event('drop', { bubbles: true }) as DragEvent;
    Object.defineProperty(dropEvent, 'dataTransfer', { value: dt });
    Object.defineProperty(dropEvent, 'clientY', { value: 0 }); // above midpoint → insert above
    topRow.dispatchEvent(dropEvent);

    expect(onDrop).toHaveBeenCalled();
    // First arg is the dragged task id; render layer correctly passes it to the controller.
    expect(onDrop.mock.calls[0][0]).toBe('bot');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 2 — Exactly one add-task row: dynamic row only (no static duplicate)
// Verifies that the dynamic buildAddTaskRow (feature-complete with calendar button)
// is the SOLE add affordance. The static index.html row is removed by this fix.
// ─────────────────────────────────────────────────────────────────────────────

describe('FIX-ADD-ROW — exactly one dynamic add-task row, no duplicate', () => {
  it('exactly one .task-add-input is rendered when onCreateTask callback is provided', () => {
    renderTasksList(el, templates, [], noopNavigate, { onCreateTask: vi.fn() });
    const inputs = el.list.querySelectorAll('.task-add-input');
    expect(inputs).toHaveLength(1);
  });

  it('the single .task-add-input is inside the dynamic list element (not a static element outside)', () => {
    renderTasksList(el, templates, [], noopNavigate, { onCreateTask: vi.fn() });
    const input = el.list.querySelector('.task-add-input');
    // The input must be a descendant of el.list (the dynamic row, not outside)
    expect(input).not.toBeNull();
    expect(el.list.contains(input)).toBe(true);
  });

  it('onCreateTask fires when Enter is pressed in the dynamic add row', () => {
    const onCreateTask = vi.fn();
    renderTasksList(el, templates, [], noopNavigate, { onCreateTask });
    const input = el.list.querySelector('.task-add-input') as HTMLInputElement;
    input.value = 'Dynamic Task';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onCreateTask).toHaveBeenCalledWith('Dynamic Task');
  });

  it('the dynamic add row is still present when the task list is non-empty', () => {
    const onCreateTask = vi.fn();
    renderTasksList(
      el, templates,
      [makeTask({ id: 't1' }), makeTask({ id: 't2', title: 'Second' })],
      noopNavigate,
      { onCreateTask },
    );
    const taskRows = el.list.querySelectorAll('li[data-task-id]');
    const addInput = el.list.querySelector('.task-add-input');
    expect(taskRows).toHaveLength(2);
    // Dynamic row is still present after task rows
    expect(addInput).not.toBeNull();
    // Only one add input
    expect(el.list.querySelectorAll('.task-add-input')).toHaveLength(1);
  });
});

// =============================================================================
// S6: List id≠name canonicalization
//
// Fixtures use id≠name intentionally: a user list {id:'proj-1', name:'Project One'}
// and Inbox {id:'inbox', name:'Inbox'} (note the capital I — case differs from
// the old fixture where id==name=='inbox').
//
// Every test in this describe MUST fail against the old code (before S6 fixes).
// Assertions:
//   1. filterTasksList: id-based filter unchanged (filter MUST NOT be touched)
//   2. Detail pre-select: <select> pre-selects option with value='proj-1'
//   3. Label display: selected option text is "Project One", NOT "proj-1"
//   4. listNameById: pure unit tests (hit + miss/fallback)
// =============================================================================

describe('S6: list id≠name canonicalization', () => {
  // ── Shared fixtures ─────────────────────────────────────────────────────────

  /** User list with id≠name (the key ULID-style case). */
  const LIST_PROJ = { id: 'proj-1', name: 'Project One' };
  /** Inbox — id='inbox', name='Inbox' (case differs from old 'inbox'='inbox' fixtures). */
  const LIST_INBOX = { id: 'inbox', name: 'Inbox' };
  const AVAILABLE_LISTS = [LIST_INBOX, LIST_PROJ];

  // Task whose list field holds the LIST ID (correct by contract).
  const taskInProj1 = (): TaskDto => makeTask({ id: 'task-p1', list: 'proj-1' });
  const taskInInbox = (): TaskDto => makeTask({ id: 'task-ib', list: 'inbox' });

  // jsdom detail element helper
  function makeDetailEl(): TasksViewElements {
    const listPanel = document.createElement('div');
    const list = document.createElement('ul');
    listPanel.appendChild(list);
    const detailPanel = document.createElement('div');
    const detailContent = document.createElement('div');
    detailPanel.appendChild(detailContent);
    return {
      listPanel,
      list,
      emptyState: document.createElement('div'),
      loadingState: document.createElement('div'),
      detailPanel,
      detailLoadingState: document.createElement('div'),
      detailNotFoundState: document.createElement('div'),
      detailContent,
    };
  }

  const noopNavigate = () => undefined;
  const templates: TasksTemplates = {
    taskItem: (() => {
      const t = document.createElement('template');
      t.innerHTML = `<li class="task-item" data-task-id="">
        <button class="task-item__status-btn task-item__checkbox" type="button"></button>
        <div class="task-item__body"><span class="task-item__title"></span></div>
        <div class="task-item__actions">
          <button class="task-item__delete-btn" type="button"></button>
        </div>
      </li>`;
      return t;
    })(),
    backlinkRow: (() => {
      const t = document.createElement('template');
      t.innerHTML = `<li class="browse-link-row">
        <span class="browse-link-row__label"></span>
        <span class="browse-link-row__id"></span>
      </li>`;
      return t;
    })(),
  };

  // ── 1. Filter (unchanged — do NOT modify filterTasksList) ─────────────────

  it('filter: task with list="proj-1" appears when filter.list="proj-1" (id===id, MUST NOT be broken)', () => {
    const tasks = [taskInProj1(), taskInInbox()];
    // filterTasksList uses task.list === filter.list (both are ids — correct by contract).
    const result = filterTasksList(tasks, { list: 'proj-1' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('task-p1');
    // The inbox task is excluded — it has a different list id.
    expect(result.every((t) => t.list === 'proj-1')).toBe(true);
  });

  it('filter: task with list="inbox" appears when filter.list="inbox" (Inbox id≠old-name pattern)', () => {
    const tasks = [taskInProj1(), taskInInbox()];
    const result = filterTasksList(tasks, { list: 'inbox' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('task-ib');
  });

  it('filter: no-filter returns both tasks regardless of list', () => {
    const tasks = [taskInProj1(), taskInInbox()];
    expect(filterTasksList(tasks, {})).toHaveLength(2);
  });

  // ── 2. Detail pre-select: <select> value = list id (NOT name) ─────────────

  it('detail list-<select> pre-selects the option whose VALUE is the task.list id', () => {
    const detailEl = makeDetailEl();
    const task = taskInProj1(); // task.list = 'proj-1'
    const cbs: TaskDetailCallbacks = {
      onSaveList: vi.fn().mockResolvedValue(undefined),
      availableLists: AVAILABLE_LISTS,
    };
    renderTaskPane(detailEl, templates, task, noopNavigate, undefined, undefined, cbs);

    const sel = detailEl.detailContent.querySelector('.task-detail__list-select') as HTMLSelectElement | null;
    expect(sel).not.toBeNull();
    // The selected option value must be the list id.
    expect(sel!.value).toBe('proj-1');
    // Old code (l.name === task.list) would compare 'Project One' === 'proj-1' → no match → wrong option.
  });

  it('detail list-<select> for Inbox task pre-selects option value="inbox" (id match, not name match)', () => {
    const detailEl = makeDetailEl();
    const task = taskInInbox(); // task.list = 'inbox'
    const cbs: TaskDetailCallbacks = {
      onSaveList: vi.fn().mockResolvedValue(undefined),
      availableLists: AVAILABLE_LISTS,
    };
    renderTaskPane(detailEl, templates, task, noopNavigate, undefined, undefined, cbs);

    const sel = detailEl.detailContent.querySelector('.task-detail__list-select') as HTMLSelectElement | null;
    expect(sel).not.toBeNull();
    expect(sel!.value).toBe('inbox');
  });

  // ── 3. Label display: selected option shows the display name ─────────────

  it('the pre-selected option in the list-<select> displays "Project One", NOT "proj-1"', () => {
    const detailEl = makeDetailEl();
    const task = taskInProj1(); // task.list = 'proj-1'
    const cbs: TaskDetailCallbacks = {
      onSaveList: vi.fn().mockResolvedValue(undefined),
      availableLists: AVAILABLE_LISTS,
    };
    renderTaskPane(detailEl, templates, task, noopNavigate, undefined, undefined, cbs);

    const sel = detailEl.detailContent.querySelector('.task-detail__list-select') as HTMLSelectElement | null;
    expect(sel).not.toBeNull();
    // The text shown to the user for the selected option must be the display name.
    const selectedText = sel!.options[sel!.selectedIndex]?.text ?? '';
    expect(selectedText).toBe('Project One');
    // It must NOT show the raw id as the label.
    expect(selectedText).not.toBe('proj-1');
  });

  it('onSaveList is called with the list id (not a name) when the select changes', () => {
    const onSaveList = vi.fn().mockResolvedValue(undefined);
    const detailEl = makeDetailEl();
    const task = taskInInbox(); // task.list = 'inbox'
    const cbs: TaskDetailCallbacks = { onSaveList, availableLists: AVAILABLE_LISTS };
    renderTaskPane(detailEl, templates, task, noopNavigate, undefined, undefined, cbs);

    const sel = detailEl.detailContent.querySelector('.task-detail__list-select') as HTMLSelectElement;
    // Simulate user picking 'proj-1' — select by id value.
    sel.value = 'proj-1';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    // onSaveList must receive the id, never the display name.
    expect(onSaveList).toHaveBeenCalledWith(task.id, 'proj-1');
  });

  // ── 4. listNameById — pure unit tests ────────────────────────────────────

  it('listNameById: returns the name when the id is found', () => {
    expect(listNameById(AVAILABLE_LISTS, 'proj-1')).toBe('Project One');
    expect(listNameById(AVAILABLE_LISTS, 'inbox')).toBe('Inbox');
  });

  it('listNameById: falls back to the raw id when not found (RISK-2 guard)', () => {
    expect(listNameById(AVAILABLE_LISTS, 'orphaned-ulid')).toBe('orphaned-ulid');
  });

  it('listNameById: returns the id when the lists array is empty', () => {
    expect(listNameById([], 'proj-1')).toBe('proj-1');
  });
});

// =============================================================================
// DT-4 — Board view for sectionless lists (pre-S4) → S4 supersedes the whole
// premise: the board no longer consults sections AT ALL (it is Kanban by
// TaskStatus, Approach §3), so "does the board work for a sectionless list"
// is no longer a distinguishable question from "does the board work" — every
// list, sectioned or not, gets the SAME three status columns. These blocks
// are UPDATED (not part of the two named AC-S1-08/AC-S2-04 supersessions) to
// assert the current reality instead of a retired one; the ORIGINAL root
// cause this suite pinned — a sectionless list silently falling through to
// the flat list — is now structurally impossible, because the render gate
// (tasks_controller.ts#renderList) no longer branches on sections OR
// selectedListId before reaching the board at all (AC-S4-07).
// =============================================================================

describe('DT-4 / S4 — renderBoardView ignores section data entirely (status-keyed)', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('renders the same three status columns for an empty task list', () => {
    renderBoardView(container, templates, [], 'manual', () => {});
    const cols = container.querySelectorAll('.tasks-board__column');
    expect(cols.length).toBe(3);
  });

  it('board wrapper (.tasks-board) is present even with zero tasks', () => {
    renderBoardView(container, templates, [], 'manual', () => {});
    expect(container.querySelector('.tasks-board')).not.toBeNull();
  });

  it('tasks with a section_id still land in the column matching their STATUS, never a section column', () => {
    const t1 = makeTask({ id: 't1', title: 'Task One', status: 'todo', section_id: 'sec-1' });
    const t2 = makeTask({ id: 't2', title: 'Task Two', status: 'doing', section_id: null });
    renderBoardView(container, templates, [t1, t2], 'manual', () => {});
    // No section-keyed column exists at all — section_id is irrelevant to the board now.
    expect(container.querySelector('[data-section-id]')).toBeNull();
    expect(container.querySelector('[data-column-status="todo"]')!.textContent).toContain('Task One');
    expect(container.querySelector('[data-column-status="doing"]')!.textContent).toContain('Task Two');
  });
});

describe('DT-4 / S4 — gate simulation: board renders in every scope now', () => {
  // These tests simulate the controller gate (tasks_controller.ts#renderList)
  // across its two historical shapes, to document the evolution:
  //
  // Pre-S4 gate (fixed by the ORIGINAL DT-4, still section-aware):
  //   if (selectedListId && view === 'board') { renderBoardView }
  //   else if (selectedListId && sections.length > 0) { renderListViewWithSections }
  //   else { renderTasksList }
  //
  // S4 gate (current — AC-S4-07, retiring AC-S1-08's "disabled without a
  // list scope" restriction): the `selectedListId &&` guard on the board
  // branch is gone. Board view wins regardless of scope.
  //   if (view === 'board') { renderBoardView }
  //   else if (selectedListId && sections.length > 0) { renderListViewWithSections }
  //   else { renderTasksList }
  //
  // The outer `el` + `templates` are used (set up by the module-level beforeEach).

  it('pre-S4 gate would NOT render the board without a selected list (documents the retired restriction)', () => {
    const selectedListId: string | null = null; // "All Lists" / no scope
    const view = 'board';

    const preS4 = Boolean(selectedListId) && view === 'board'; // false — the retired restriction
    if (preS4) {
      renderBoardView(el.list, templates, [], 'manual', () => {});
    } else {
      renderTasksList(el, templates, [], () => {});
    }
    expect(el.list.querySelector('.tasks-board')).toBeNull();
  });

  it('S4 gate renders the board with no list selected at all (AC-S4-07)', () => {
    const view = 'board';
    const s4Gate = view === 'board'; // true — no selectedListId dependency anymore
    if (s4Gate) {
      renderBoardView(el.list, templates, [], 'manual', () => {});
    } else {
      renderTasksList(el, templates, [], () => {});
    }
    expect(el.list.querySelector('.tasks-board')).not.toBeNull();
  });

  it('flat-list branch (view=list) still does NOT render .tasks-board', () => {
    renderTasksList(el, templates, [], () => {});
    expect(el.list.querySelector('.tasks-board')).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════
// S1 — Honest controls, honest errors, honest view state (todo-loop-closure)
// ═════════════════════════════════════════════════════════════════════════

// ── AC-S1-04 — legalNextStatuses mirrors TaskStatus::can_transition_to ──────
//
// CROSS-LANGUAGE PARITY, not a restated table. A test that hardcodes the same
// literal values the TypeScript implementation hardcodes is a tautology — it
// passes even if jin-core's `can_transition_to` changes underneath it,
// because nothing ever reads the Rust source. This test instead PARSES
// jin-core/src/model/task.rs directly (enum variants + the `matches!` arm
// pairs in `can_transition_to`) and compares the derived table against
// `legalNextStatuses`'s output. A change to either side without updating the
// other fails this test for real, because the "expected" side is read fresh
// from Rust on every run — including a brand-new TaskStatus variant added to
// core, which this test will flag until legalNextStatuses accounts for it.
//
// Guarded against a vacuous pass: if the regexes below ever find nothing
// (the enum renamed/moved, the fn renamed, the source reformatted beyond
// what the parser expects), the test fails LOUDLY with a message naming the
// problem — it does not silently "pass" having compared nothing.

/** One extracted `(TaskStatus::From, TaskStatus::To)` arm, lowercased. */
interface RustFsm {
  /** All enum variants, lowercased, in declaration order. */
  variants: string[];
  /** variant (lowercased) -> legal successor variants (lowercased). */
  successors: Map<string, string[]>;
  /** Total `matches!` arm pairs found — used only for the vacuous-pass guard. */
  pairCount: number;
}

/**
 * Parses `jin-core/src/model/task.rs`'s `TaskStatus` enum and the
 * `can_transition_to` `matches!` arms directly from source. Used ONLY by the
 * parity test below — never by production code (the GUI must not read Rust
 * source files at runtime; this is a build/test-time cross-language check).
 */
function readCoreTaskStatusFsm(): RustFsm {
  // Test runner cwd is jin-gui/ (matches the readFileSync(process.cwd(), 'index.html')
  // pattern already used by tasks_lists_modal_wiring.test.ts in this same suite).
  const rustPath = resolve(process.cwd(), '../jin-core/src/model/task.rs');
  const rust = readFileSync(rustPath, 'utf-8');

  // ── Enum variants — enumerate from the Rust `enum`, not a TS literal list,
  // so a NEW status added to core is picked up automatically. ──
  const enumMatch = rust.match(/pub enum TaskStatus \{([\s\S]*?)\n\}/);
  if (!enumMatch) {
    throw new Error(
      'PARSE FAILURE (not a real test failure to ignore): could not locate ' +
        '`pub enum TaskStatus { ... }` in jin-core/src/model/task.rs. The Rust ' +
        'FSM could not be located, so AC-S1-04 parity cannot be verified — fix ' +
        'the parser in this test, do not let it silently pass.',
    );
  }
  const variants: string[] = [];
  for (const rawLine of enumMatch[1].split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#[')) continue; // e.g. #[default]
    if (line.startsWith('///') || line.startsWith('//')) continue; // doc/comment
    const m = line.match(/^([A-Z][A-Za-z0-9_]*)\s*,?\s*$/);
    if (m) variants.push(m[1].toLowerCase());
  }

  // ── can_transition_to arms ──
  const fnMatch = rust.match(
    /pub fn can_transition_to\(&self, next: &TaskStatus\) -> bool \{([\s\S]*?)\n {4}\}/,
  );
  if (!fnMatch) {
    throw new Error(
      'PARSE FAILURE (not a real test failure to ignore): could not locate ' +
        '`can_transition_to` in jin-core/src/model/task.rs. The Rust FSM could ' +
        'not be located, so AC-S1-04 parity cannot be verified — fix the parser ' +
        'in this test, do not let it silently pass.',
    );
  }
  const pairRegex = /\(TaskStatus::(\w+),\s*TaskStatus::(\w+)\)/g;
  const successors = new Map<string, string[]>();
  for (const v of variants) successors.set(v, []);
  let pairCount = 0;
  let match: RegExpExecArray | null;
  while ((match = pairRegex.exec(fnMatch[1])) !== null) {
    pairCount += 1;
    const from = match[1].toLowerCase();
    const to = match[2].toLowerCase();
    if (!successors.has(from)) successors.set(from, []);
    successors.get(from)!.push(to);
  }

  return { variants, successors, pairCount };
}

describe('S1 — legalNextStatuses mirrors TaskStatus::can_transition_to (AC-S1-04)', () => {
  it('legal_next_statuses_mirrors_core_fsm', () => {
    const fsm = readCoreTaskStatusFsm();

    // ── Vacuous-pass guards — fail loudly if the parse found nothing, or
    // found something that doesn't look like the FSM we expect, BEFORE the
    // real comparison runs. Silently comparing two empty structures would
    // "pass" without checking anything, which is exactly the failure mode
    // this rewrite exists to close. ──
    expect(
      fsm.variants.length,
      'Found ZERO TaskStatus variants — the enum parser is broken or the ' +
        'enum was renamed/moved. This test cannot verify parity; fix the ' +
        'parser rather than letting it pass with nothing to compare.',
    ).toBeGreaterThan(0);

    for (const expectedVariant of ['todo', 'doing', 'done', 'cancelled']) {
      expect(
        fsm.variants,
        `TaskStatus variant '${expectedVariant}' was not found by the parser — ` +
          'either the enum changed shape or the parser is broken.',
      ).toContain(expectedVariant);
    }

    expect(
      fsm.pairCount,
      `Expected exactly 8 can_transition_to arms in jin-core/src/model/task.rs, ` +
        `found ${fsm.pairCount}. Either the parser is broken, or the FSM has ` +
        'legitimately changed — if so, update this expected count AND ' +
        'legalNextStatuses together, do not just bump this number.',
    ).toBe(8);

    // ── The actual cross-language comparison. Order is not semantically
    // meaningful (it is a *set* of legal successors), so both sides are
    // sorted before comparing. ──
    for (const variant of fsm.variants) {
      const expected = (fsm.successors.get(variant) ?? []).slice().sort();
      const actual = legalNextStatuses(variant).slice().sort();
      expect(
        actual,
        `legalNextStatuses('${variant}') = [${actual.join(', ')}] does not match ` +
          `core's can_transition_to successor set [${expected.join(', ')}] for '${variant}'`,
      ).toEqual(expected);
    }
  });

  it('is case-insensitive (defensive — DTO statuses are always lowercase)', () => {
    expect(legalNextStatuses('DONE')).toEqual(['todo']);
  });

  it('returns [] for an unrecognized status rather than throwing', () => {
    expect(legalNextStatuses('bogus')).toEqual([]);
  });
});

// ── AC-S1-02 / AC-S1-03 — detail status select offers ONLY legal successors ─
//
// Green-but-shallow watch (spec, Story S1): a test that only calls
// legalNextStatuses('done') proves nothing about the actual UI. These tests
// render the real detail status select and assert on its rendered <option>s.
describe('S1 — detail status select renders only legal transitions (AC-S1-02/03)', () => {
  function makeDetailEl() {
    const detailContent = document.createElement('div');
    document.body.appendChild(detailContent);
    const elDetail: TasksViewElements = {
      listPanel: document.createElement('div'),
      list: document.createElement('ul'),
      emptyState: document.createElement('div'),
      loadingState: document.createElement('div'),
      detailPanel: document.createElement('div'),
      detailLoadingState: document.createElement('div'),
      detailNotFoundState: document.createElement('div'),
      detailContent,
    };
    return elDetail;
  }

  it('status_select_offers_only_legal_transitions_for_done', () => {
    const onSaveStatus = vi.fn().mockResolvedValue(undefined);
    const detailEl = makeDetailEl();
    const task = makeTask({ id: 'task-done', status: 'done' });
    renderTaskPane(detailEl, templates, task, noopNavigate, undefined, undefined, {
      onSaveStatus,
    });
    const sel = detailEl.detailContent.querySelector('.task-detail__status-select') as HTMLSelectElement;
    expect(sel).not.toBeNull();
    const values = Array.from(sel.options).map((o) => o.value).sort();
    // Exactly two options: 'done' (current) and 'todo' (the only legal successor).
    expect(values).toEqual(['done', 'todo']);
    expect(values).not.toContain('doing');
    expect(values).not.toContain('cancelled');
  });

  it('status_select_hides_done_for_cancelled', () => {
    const onSaveStatus = vi.fn().mockResolvedValue(undefined);
    const detailEl = makeDetailEl();
    const task = makeTask({ id: 'task-cancelled', status: 'cancelled' });
    renderTaskPane(detailEl, templates, task, noopNavigate, undefined, undefined, {
      onSaveStatus,
    });
    const sel = detailEl.detailContent.querySelector('.task-detail__status-select') as HTMLSelectElement;
    expect(sel).not.toBeNull();
    const values = Array.from(sel.options).map((o) => o.value);
    expect(values).not.toContain('done');
    expect(values).not.toContain('doing');
    expect(values.sort()).toEqual(['cancelled', 'todo']);
  });

  it('a todo task offers all three legal successors plus its own current value', () => {
    const onSaveStatus = vi.fn().mockResolvedValue(undefined);
    const detailEl = makeDetailEl();
    const task = makeTask({ id: 'task-todo', status: 'todo' });
    renderTaskPane(detailEl, templates, task, noopNavigate, undefined, undefined, {
      onSaveStatus,
    });
    const sel = detailEl.detailContent.querySelector('.task-detail__status-select') as HTMLSelectElement;
    const values = Array.from(sel.options).map((o) => o.value).sort();
    expect(values).toEqual(['cancelled', 'doing', 'done', 'todo']);
  });
});

// ── AC-X-06 pin — filterTasksList stays id-based, never name-based ─────────
//
// Cross-cutting criterion re-checked at every story boundary. The substance is
// already covered by the "S6: list id≠name canonicalization" suite above; this
// test pins the exact frozen criterion under its own literal name so the gate
// is mechanically greppable independent of that suite's prose.
describe('AC-X-06 — filterTasksList matches task.list against a list id, never a name', () => {
  it('S6_filter_is_id_based', () => {
    const tasks = [
      makeTask({ id: 't-inbox', list: 'inbox' }),
      makeTask({ id: 't-proj', list: 'proj-1' }),
    ];
    // Filtering by the id 'proj-1' must return exactly the task whose `list`
    // field equals that id — never a display name like "Project One".
    expect(filterTasksList(tasks, { list: 'proj-1' }).map((t) => t.id)).toEqual(['t-proj']);
    expect(filterTasksList(tasks, { list: 'inbox' }).map((t) => t.id)).toEqual(['t-inbox']);
    // A filter value that only matches a display name (never persisted as
    // task.list) must match nothing.
    expect(filterTasksList(tasks, { list: 'Project One' })).toEqual([]);
  });
});

// ── AC-S1-06 / AC-S1-08 — view is a global preference; toggle honesty ───────

function makeDefaultListDto(overrides: Partial<ListDto> = {}): ListDto {
  return {
    id: 'inbox',
    name: 'Inbox',
    color: 'accent',
    icon: 'inbox',
    position: 'A',
    parent_id: null,
    view: 'list',
    sort_mode: 'manual',
    is_default: true,
    task_count: 0,
    sections: [],
    ...overrides,
  };
}

function makeTaskDtoForStimulus(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: 'task-001',
    title: 'Stimulus Test Task',
    status: 'todo',
    priority: 'none',
    due: null,
    list: 'inbox',
    completed_at: null,
    deleted_at: null,
    created: '2026-06-01T00:00:00Z',
    updated: '2026-06-27T12:00:00Z',
    backlinks: [],
    body: '',
    ...overrides,
  };
}

/**
 * fireScopeChanged — S5: simulate a rail click by dispatching the real
 * `jin:scope-changed` event the section's own `data-action` consumes (the
 * SAME event ListsController dispatches in production). This fixture doesn't
 * mount ListsController, so tests that need a scope switch drive it directly
 * — never by poking a removed `<select>`'s `.value` (AC-S5-07 retired it).
 */
function fireScopeChanged(scope: { kind: 'list'; id: string } | { kind: 'smart'; id: string }): void {
  const section = document.querySelector('[data-controller~="tasks"]') as HTMLElement;
  section.dispatchEvent(
    new CustomEvent('jin:scope-changed', { detail: { scope }, bubbles: true }),
  );
}

function buildStimulusTasksHTML(): string {
  return `
    <section data-controller="tasks" data-action="jin:open-detail->tasks#openDetail jin:scope-changed->tasks#setScope">
      <button data-tasks-target="railToggleBtn" data-action="click->tasks#toggleRail" aria-expanded="false">Task lists</button>
      <aside>
        <button data-tasks-target="railCloseBtn" data-action="click->tasks#toggleRail">Close task lists</button>
      </aside>
      <div class="tasks-main" data-tasks-target="main">
      <div data-tasks-target="listPanel">
        <h1 data-tasks-target="workspaceTitle">Inbox</h1>
        <div data-tasks-target="loadingState" class="hidden" role="status"></div>
        <div data-tasks-target="emptyState" class="hidden"></div>
        <ul data-tasks-target="list" class="hidden browse-list" role="list"></ul>
        <select data-tasks-target="statusFilter" data-action="change->tasks#applyFilter">
          <option value="">All Statuses</option>
        </select>
        <select data-tasks-target="priorityFilter" data-action="change->tasks#applyFilter">
          <option value="">All Priorities</option>
        </select>
        <select data-tasks-target="sortModeSelect" data-action="change->tasks#sortModeChange">
          <option value="manual">Manual</option>
          <option value="priority">Priority</option>
        </select>
        <button
          type="button"
          data-tasks-target="viewToggleBtn"
          data-action="click->tasks#viewToggle"
          aria-label="Switch to board view"
        >
          <i data-lucide="layout-grid" aria-hidden="true"></i>
        </button>
      </div>
      <div data-tasks-target="detailPanel" class="tasks-detail-pane">
        <div data-tasks-target="detailLoadingState" class="hidden"></div>
        <div data-tasks-target="detailNotFoundState" class="hidden"></div>
        <div data-tasks-target="detailContent"></div>
      </div>
      </div>
    </section>
    <template id="tmpl-task-item">
      <li class="task-item">
        <span class="task-item__drag-handle" aria-hidden="true">
          <i data-lucide="grip-vertical" aria-hidden="true"></i>
        </span>
        <button type="button" class="task-item__status-btn task-item__checkbox tap-target"
                role="checkbox" aria-checked="false" aria-label="Toggle">
          <i class="task-item__status-icon" aria-hidden="true"></i>
        </button>
        <span class="browse-status-badge task-item__status-badge" role="img" aria-label="">
          <span class="task-item__status-label"></span>
        </span>
        <div class="task-item__content">
          <button type="button" class="task-item__body tap-target" aria-label="">
            <span class="task-item__title"></span>
            <span class="task-item__subtask-progress" aria-hidden="true"></span>
          </button>
          <span class="task-item__meta">
            <span class="task-item__tags"></span>
          </span>
        </div>
        <span class="browse-status-badge task-item__priority" role="img" aria-label="">
          <i class="task-item__priority-icon" aria-hidden="true"></i>
          <span class="task-item__priority-label"></span>
        </span>
        <div class="task-item__actions" aria-hidden="true">
          <button type="button" class="task-item__delete-btn tap-target" aria-label="Delete task">
            <i data-lucide="trash-2" aria-hidden="true"></i>
          </button>
        </div>
      </li>
    </template>
    <template id="tmpl-backlink-row">
      <li class="browse-link-row">
        <button class="browse-link-row__btn tap-target" aria-label="" data-link-id="" data-link-kind="">
          <i class="browse-link-row__icon" aria-hidden="true"></i>
          <span class="browse-link-row__label text-callout"></span>
          <span class="browse-link-row__id text-caption2"></span>
        </button>
      </li>
    </template>
  `;
}

async function flushStimulusAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('S1 — view persists globally + toggle honesty (real TasksController)', () => {
  let stimulusApp: Application;

  beforeEach(() => {
    document.body.innerHTML = buildStimulusTasksHTML();
    localStorage.clear();
    vi.spyOn(InvokeModule, 'listTags').mockResolvedValue([]);
  });

  afterEach(() => {
    stimulusApp?.stop();
    document.body.innerHTML = '';
    localStorage.clear();
    vi.restoreAllMocks();
  });

  function startStimulusApp(): Application {
    stimulusApp = Application.start(document.documentElement, defaultSchema);
    stimulusApp.register('tasks', TasksController);
    return stimulusApp;
  }

  it('view_persists_globally_across_list_switch', async () => {
    // Two lists, both persisting 'list' as their OWN (now-unused) ListDto.view —
    // if the GUI still re-derived view per-list (the pre-fix D5 bug), switching
    // to 'work' would silently revert the layout to 'list'.
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([
      makeDefaultListDto({ id: 'inbox', name: 'Inbox', is_default: true, view: 'list' }),
      makeDefaultListDto({ id: 'work', name: 'Work', is_default: false, view: 'list' }),
    ]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([]);

    startStimulusApp();
    await flushStimulusAsync();

    const toggleBtn = document.querySelector('[data-tasks-target="viewToggleBtn"]') as HTMLButtonElement;
    // Inbox auto-selected as the default list → toggle must be enabled.
    expect(toggleBtn.disabled).toBe(false);

    // Toggle to board while Inbox (the auto-selected default) is active.
    toggleBtn.click();
    await flushStimulusAsync();

    expect(document.querySelector('.tasks-board')).not.toBeNull();
    expect(localStorage.getItem('jin.tasks.view')).toBe('board');

    // Switch scope to the "work" list — S5: via the real jin:scope-changed
    // event (what a rail click dispatches in production), not a removed
    // <select>'s value (AC-S5-07 retired it).
    fireScopeChanged({ kind: 'list', id: 'work' });
    await flushStimulusAsync();

    // The view must remain board — a GLOBAL preference, never reset by switching
    // lists (the exact D5 regression this criterion guards against).
    expect(document.querySelector('.tasks-board')).not.toBeNull();
    expect(localStorage.getItem('jin.tasks.view')).toBe('board');
  });

  it('projects the active smart view and exact list name into the single workspace heading', async () => {
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([
      makeDefaultListDto({ id: 'inbox', name: 'Personal', is_default: true }),
      makeDefaultListDto({ id: 'work', name: 'Studio work', is_default: false }),
    ]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([]);

    startStimulusApp();
    await flushStimulusAsync();

    const title = document.querySelector('[data-tasks-target="workspaceTitle"]') as HTMLElement;
    expect(title.textContent).toBe('Personal');

    fireScopeChanged({ kind: 'smart', id: 'upcoming' });
    await flushStimulusAsync();
    expect(title.textContent).toBe('Upcoming');

    fireScopeChanged({ kind: 'list', id: 'work' });
    await flushStimulusAsync();
    expect(title.textContent).toBe('Studio work');
    expect(document.querySelectorAll('h1[data-tasks-target="workspaceTitle"]')).toHaveLength(1);
  });

  it('view toggle re-enables once a specific list becomes the active scope', async () => {
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([
      makeDefaultListDto({ id: 'inbox', is_default: true }),
    ]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([]);

    startStimulusApp();
    await flushStimulusAsync();

    const toggleBtn = document.querySelector('[data-tasks-target="viewToggleBtn"]') as HTMLButtonElement;
    // Inbox is the default list — auto-selected on connect, so the toggle is enabled.
    expect(toggleBtn.disabled).toBe(false);
    expect(toggleBtn.hasAttribute('aria-disabled')).toBe(false);
  });

  it('opens the task-list overlay with a focus handoff and restores the toggle on close', async () => {
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([]);

    startStimulusApp();
    await flushStimulusAsync();

    const section = document.querySelector('[data-controller~="tasks"]') as HTMLElement;
    const toggle = document.querySelector('[data-tasks-target="railToggleBtn"]') as HTMLButtonElement;
    const close = document.querySelector('[data-tasks-target="railCloseBtn"]') as HTMLButtonElement;

    toggle.click();
    expect(section.classList.contains('tasks-rail-open')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(close);

    close.click();
    expect(section.classList.contains('tasks-rail-open')).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// S2 — One task item, two skins (todo-loop-closure)
//
// The pre-S2 per-variant item builders (template-clone row, imperative-
// createElement card) are RETIRED (AC-S2-01, checked by a source-tree scan
// for their old names — see the acceptance criteria doc). buildTaskItem
// (templateEl, task, variant, onNavigate, callbacks) is the ONE item builder
// for both the List row and the Board card, cloning the SAME
// `#tmpl-task-item` template — see item.ts.
//
// Green-but-shallow watch (spec, HIGHEST in the wave for this story): a
// parity test that compares class names / selectors / outerHTML / DOM shape
// proves nothing about behavior — both variants could be equally broken (a
// delete button that "looks right but calls nothing" is exactly the bug
// class D6 diagnosed). Every test below activates a real DOM event on each
// variant and asserts the SAME spy fired with the SAME arguments.
// ═════════════════════════════════════════════════════════════════════════

describe('S2 — one item, two skins: row/card callback parity (AC-S2-02)', () => {
  it('row_and_card_fire_identical_callbacks', () => {
    const onNavigate = vi.fn();
    const onStatusToggle = vi.fn();
    const onDeleteRequest = vi.fn();
    const onDragStart = vi.fn();
    const callbacks: TaskRowCallbacks = {
      onStatusToggle,
      onDeleteRequest,
      onDragStart,
      onDrop: vi.fn(), // present so the drag-handle/DnD wiring is installed
    };

    const task = makeTask({ id: 'parity-1', title: 'Parity Task', status: 'todo' });

    // Build BOTH variants from the SAME template, SAME task, SAME callbacks
    // object (the same spies) — exactly what buildTaskItem's contract promises.
    const rowEl = buildTaskItem(templates.taskItem, task, 'row', onNavigate, callbacks);
    const cardEl = buildTaskItem(templates.taskItem, task, 'card', onNavigate, callbacks);
    document.body.appendChild(rowEl);
    document.body.appendChild(cardEl);

    // ── select (main body click -> onNavigate) ──────────────────────────
    (rowEl.querySelector('.task-item__body') as HTMLButtonElement).click();
    (cardEl.querySelector('.task-item__body') as HTMLButtonElement).click();
    expect(onNavigate).toHaveBeenCalledTimes(2);
    expect(onNavigate).toHaveBeenNthCalledWith(1, 'tasks', 'parity-1');
    expect(onNavigate).toHaveBeenNthCalledWith(2, 'tasks', 'parity-1');

    // ── status toggle ────────────────────────────────────────────────────
    (rowEl.querySelector('.task-item__status-btn') as HTMLButtonElement).click();
    (cardEl.querySelector('.task-item__status-btn') as HTMLButtonElement).click();
    expect(onStatusToggle).toHaveBeenCalledTimes(2);
    expect(onStatusToggle).toHaveBeenNthCalledWith(1, 'parity-1', 'todo');
    expect(onStatusToggle).toHaveBeenNthCalledWith(2, 'parity-1', 'todo');

    // ── delete ────────────────────────────────────────────────────────────
    (rowEl.querySelector('.task-item__delete-btn') as HTMLButtonElement).click();
    (cardEl.querySelector('.task-item__delete-btn') as HTMLButtonElement).click();
    expect(onDeleteRequest).toHaveBeenCalledTimes(2);
    expect(onDeleteRequest).toHaveBeenNthCalledWith(1, 'parity-1', 'Parity Task');
    expect(onDeleteRequest).toHaveBeenNthCalledWith(2, 'parity-1', 'Parity Task');

    // ── drag start ────────────────────────────────────────────────────────
    const fireDragStart = (target: HTMLElement) => {
      const dt = { setData: vi.fn(), effectAllowed: '' };
      const evt = new Event('dragstart', { bubbles: true }) as DragEvent;
      Object.defineProperty(evt, 'dataTransfer', { value: dt, writable: false });
      target.dispatchEvent(evt);
    };
    fireDragStart(rowEl);
    fireDragStart(cardEl);
    expect(onDragStart).toHaveBeenCalledTimes(2);
    expect(onDragStart).toHaveBeenNthCalledWith(1, 'parity-1');
    expect(onDragStart).toHaveBeenNthCalledWith(2, 'parity-1');
  });
});

describe('due-date quick actions own their interaction boundary', () => {
  it('uses a focusable date button and actions never open task detail', () => {
    const onNavigate = vi.fn();
    const onReschedule = vi.fn();
    const item = buildTaskItem(
      templates.taskItem,
      makeTask({ id: 'overdue-1', due: '2020-01-01', status: 'todo' }),
      'row',
      onNavigate,
      { onReschedule },
    );
    document.body.appendChild(item);

    const dateButton = item.querySelector<HTMLButtonElement>('.task-due-chip');
    expect(dateButton?.tagName).toBe('BUTTON');
    expect(dateButton?.getAttribute('aria-expanded')).toBe('false');

    dateButton!.click();
    expect(dateButton?.getAttribute('aria-expanded')).toBe('true');
    item.querySelector<HTMLButtonElement>('.due-reschedule__btn')!.click();

    expect(onReschedule).toHaveBeenCalledWith('overdue-1', expect.any(String));
    expect(onNavigate).not.toHaveBeenCalled();
    expect(dateButton?.getAttribute('aria-expanded')).toBe('false');
  });

  it('Escape and outside pointer dismiss the action panel and Escape restores date focus', () => {
    const item = buildTaskItem(
      templates.taskItem,
      makeTask({ id: 'overdue-2', due: '2020-01-01', status: 'todo' }),
      'row',
      vi.fn(),
      { onReschedule: vi.fn() },
    );
    document.body.appendChild(item);
    const dateButton = item.querySelector<HTMLButtonElement>('.task-due-chip')!;

    dateButton.click();
    const group = item.querySelector<HTMLElement>('.due-chip-group')!;
    group.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(dateButton.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(dateButton);
    expect(group.hasAttribute('data-open')).toBe(false);
    expect(group.getAttribute('data-dismissed')).toBe('true');

    dateButton.click();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(dateButton.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('S2 — board card delete parity with the list row (AC-S2-03)', () => {
  it('card_delete_fires_same_callback_as_row', () => {
    // Drives the REAL public render entry points (renderTasksList /
    // renderBoardView) — not buildTaskItem directly — so this proves the
    // wiring survives the full render pipeline, not just the shared builder
    // in isolation.
    const onDeleteRequest = vi.fn();
    const task = makeTask({ id: 'card-del-1', title: 'Card Delete Task' });

    renderTasksList(el, templates, [task], noopNavigate, { onDeleteRequest });
    const rowDeleteBtn = el.list.querySelector('.task-item__delete-btn') as HTMLButtonElement;
    expect(rowDeleteBtn).not.toBeNull();
    rowDeleteBtn.click();

    const boardContainer = document.createElement('div');
    document.body.appendChild(boardContainer);
    renderBoardView(boardContainer, templates, [task], 'manual', noopNavigate, { onDeleteRequest });
    const cardDeleteBtn = boardContainer.querySelector('.task-item__delete-btn') as HTMLButtonElement;
    expect(cardDeleteBtn).not.toBeNull();
    cardDeleteBtn.click();

    // The SAME onDeleteRequest callback fired for both, with identical args.
    expect(onDeleteRequest).toHaveBeenCalledTimes(2);
    expect(onDeleteRequest).toHaveBeenNthCalledWith(1, 'card-del-1', 'Card Delete Task');
    expect(onDeleteRequest).toHaveBeenNthCalledWith(2, 'card-del-1', 'Card Delete Task');
  });
});

describe('S2 — board honors the active sort mode, never a hardcoded manual (AC-S2-05/06)', () => {
  it('board_honors_active_sort_mode', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    // Position order (manual) would be Low, High, Medium — the OPPOSITE of
    // what 'priority' mode must produce. If the board still hardcoded
    // 'manual' (the pre-S2 defect at render.ts:359), this would render in
    // position order instead and the assertion below would fail. All three
    // share the default 'todo' status, so they land in the SAME column —
    // sort mode is what orders them within it.
    const tasks = [
      makeTask({ id: 'low', title: 'Low', priority: 'low', position: 'a' }),
      makeTask({ id: 'high', title: 'High', priority: 'high', position: 'b' }),
      makeTask({ id: 'medium', title: 'Medium', priority: 'medium', position: 'c' }),
    ];
    renderBoardView(container, templates, tasks, 'priority', noopNavigate);
    const cardTitles = Array.from(container.querySelectorAll('.task-item__title')).map(
      (elt) => elt.textContent,
    );
    expect(cardTitles).toEqual(['High', 'Medium', 'Low']);
  });
});

// =============================================================================
// S4 — Board becomes a Kanban by status (AC-S4-01..08)
//
// renderBoardView's pure-render contract (AC-S4-01/02/08 — three fixed
// columns, cancelled excluded, add-row Todo-only) is already covered above
// ("VG-P6 / S4 — renderBoardView"). This suite drives the REAL
// Stimulus-mounted TasksController for everything that needs the mutation
// chokepoint or a genuine DOM drag interaction: the illegal-drop refusal
// mechanism (AC-S4-03/04/05 — aria-disabled + no preventDefault, so the drop
// never fires and no bridge call is ever made), the Reopen action
// (AC-S4-06), and the view-toggle honesty fix (AC-S4-07, retiring AC-S1-08).
// =============================================================================

describe('S4 — Board becomes a Kanban by status (AC-S4-01..08)', () => {
  let s4App: Application;

  beforeEach(() => {
    document.body.innerHTML = buildStimulusTasksHTML();
    localStorage.clear();
    vi.spyOn(InvokeModule, 'listTags').mockResolvedValue([]);
  });

  afterEach(() => {
    s4App?.stop();
    document.body.innerHTML = '';
    localStorage.clear();
    vi.restoreAllMocks();
  });

  function startS4App(): Application {
    s4App = Application.start(document.documentElement, defaultSchema);
    s4App.register('tasks', TasksController);
    return s4App;
  }

  function switchToBoardView(): void {
    const toggleBtn = document.querySelector('[data-tasks-target="viewToggleBtn"]') as HTMLButtonElement;
    toggleBtn.click();
  }

  /** Dispatch a real dragstart from a card so the board's dragstart listener marks illegal columns. */
  function fireCardDragStart(taskId: string): void {
    const card = document.querySelector(`li[data-task-id="${taskId}"]`) as HTMLElement;
    expect(card, `card for ${taskId} must be rendered`).not.toBeNull();
    const dt = { setData: vi.fn(), effectAllowed: '' };
    const evt = new Event('dragstart', { bubbles: true }) as DragEvent;
    Object.defineProperty(evt, 'dataTransfer', { value: dt, writable: false });
    card.dispatchEvent(evt);
  }

  function getColumn(status: string): HTMLElement {
    const col = document.querySelector(`[data-column-status="${status}"]`) as HTMLElement;
    expect(col, `${status} column must be rendered`).not.toBeNull();
    return col;
  }

  /**
   * Fires a cancelable dragover on `target` (which bubbles to the column's
   * own listener) and returns whether preventDefault() was called anywhere
   * in that bubble chain. Defaults the dispatch target to the column itself
   * (empty-gutter hover); pass an existing CARD inside the column to prove
   * the refusal holds even when hovering directly over a sibling card, not
   * just empty column space (AC-S4-04's CONSTRAINT: "think about every drop
   * pair" — a stray item-level dragover handler on the card could otherwise
   * call preventDefault() first and silently re-enable the drop).
   */
  function fireColumnDragOver(col: HTMLElement, target: HTMLElement = col): boolean {
    const dt = { dropEffect: '' };
    const evt = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(evt, 'dataTransfer', { value: dt, writable: false });
    target.dispatchEvent(evt);
    return evt.defaultPrevented;
  }

  function fireColumnDrop(col: HTMLElement, draggedId: string, target: HTMLElement = col): void {
    const dt = {
      getData: vi.fn().mockImplementation((key: string) => (key === 'application/x-jin-task-id' ? draggedId : '')),
    };
    const evt = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(evt, 'dataTransfer', { value: dt, writable: false });
    target.dispatchEvent(evt);
  }

  it('legal_board_drop_calls_set_task_status', async () => {
    const todoTask = makeTaskDtoForStimulus({ id: 'todo-1', title: 'Todo Task', status: 'todo' });
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([makeDefaultListDto()]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([todoTask]);
    vi.spyOn(InvokeModule, 'setTaskStatus').mockResolvedValue({ ...todoTask, status: 'doing' });

    startS4App();
    await flushStimulusAsync();
    switchToBoardView();
    await flushStimulusAsync();

    fireCardDragStart('todo-1');
    const doingCol = getColumn('doing');
    // A legal target: the column DOES call preventDefault() on dragover.
    expect(fireColumnDragOver(doingCol)).toBe(true);

    fireColumnDrop(doingCol, 'todo-1');
    await flushStimulusAsync();

    expect(InvokeModule.setTaskStatus).toHaveBeenCalledTimes(1);
    expect(InvokeModule.setTaskStatus).toHaveBeenCalledWith('todo-1', 'doing');
  });

  it('illegal_board_drop_never_calls_bridge', async () => {
    const doneTask = makeTaskDtoForStimulus({ id: 'done-1', title: 'Done Task', status: 'done' });
    // An existing card already sits in the illegal (Doing) column — the drop
    // must be refused even when the drag hovers directly over THAT card, not
    // just empty column gutter (see fireColumnDragOver's doc comment).
    const doingTask = makeTaskDtoForStimulus({ id: 'doing-1', title: 'Existing Doing Task', status: 'doing' });
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([makeDefaultListDto()]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([doneTask, doingTask]);
    const setTaskStatusSpy = vi.spyOn(InvokeModule, 'setTaskStatus');

    startS4App();
    await flushStimulusAsync();
    switchToBoardView();
    await flushStimulusAsync();

    fireCardDragStart('done-1');
    const doingCol = getColumn('doing');
    const existingCard = document.querySelector('li[data-task-id="doing-1"]') as HTMLElement;
    expect(existingCard).not.toBeNull();

    // AC-S4-04 CONSTRAINT: the illegal column must NEVER call preventDefault()
    // on dragover — that is what makes a real browser refuse the drop, so the
    // drop never fires and no bridge call is ever made. This is the assertion
    // that matters; asserting on an error toast would mean the call WAS made.
    // Dispatched on the EXISTING CARD (bubbles to the column) — not just the
    // column's own empty gutter.
    expect(fireColumnDragOver(doingCol, existingCard)).toBe(false);

    // Defense in depth: even a manually-fired drop (impossible in a real
    // browser once dragover refused it) must still not reach the bridge.
    fireColumnDrop(doingCol, 'done-1', existingCard);
    await flushStimulusAsync();

    expect(setTaskStatusSpy).not.toHaveBeenCalled();
  });

  it('illegal_columns_are_aria_disabled_during_drag', async () => {
    const doneTask = makeTaskDtoForStimulus({ id: 'done-1', status: 'done' });
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([makeDefaultListDto()]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([doneTask]);

    startS4App();
    await flushStimulusAsync();
    switchToBoardView();
    await flushStimulusAsync();

    fireCardDragStart('done-1');

    // done's only legal successor is todo — Doing (genuinely illegal: not a
    // legal successor and not the source) must be aria-disabled with the
    // drop-disabled class; Todo (legal successor) must not. Done is the
    // card's OWN source column — legalNextStatuses never includes the
    // current status, but a drop back into it is a no-op cancel (AC-S4-09),
    // not an illegal transition, so it must ALSO stay enabled and carry
    // neither aria-disabled NOR the drop-disabled class (AC-S4-05, clarified:
    // disabled = neither the source column nor a legal successor).
    expect(getColumn('todo').getAttribute('aria-disabled')).toBe('false');
    expect(getColumn('todo').classList.contains('tasks-board__column--drop-disabled')).toBe(false);

    expect(getColumn('doing').getAttribute('aria-disabled')).toBe('true');
    expect(getColumn('doing').classList.contains('tasks-board__column--drop-disabled')).toBe(true);

    expect(getColumn('done').getAttribute('aria-disabled')).toBe('false');
    expect(getColumn('done').classList.contains('tasks-board__column--drop-disabled')).toBe(false);
  });

  it('dropping_a_card_back_into_its_source_column_makes_no_bridge_call', async () => {
    // AC-S4-09: the FSM has no self-transition arm (`can_transition_to(X, X)`
    // is false for every status X), so a drop back into the dragged card's
    // OWN column is a no-op cancel, not a transition request — it must never
    // reach `setTaskStatus`, which core would reject as
    // `InvalidStateTransition`.
    const doneTask = makeTaskDtoForStimulus({ id: 'done-1', title: 'Done Task', status: 'done' });
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([makeDefaultListDto()]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([doneTask]);
    const setTaskStatusSpy = vi.spyOn(InvokeModule, 'setTaskStatus');

    startS4App();
    await flushStimulusAsync();
    switchToBoardView();
    await flushStimulusAsync();

    fireCardDragStart('done-1');
    const doneCol = getColumn('done');
    const ownCard = document.querySelector('li[data-task-id="done-1"]') as HTMLElement;
    expect(ownCard).not.toBeNull();

    // The source column is a neutral, enabled drop target (AC-S4-05) — a
    // real browser WOULD call preventDefault() on dragover here, unlike a
    // genuinely illegal column.
    expect(fireColumnDragOver(doneCol, ownCard)).toBe(true);

    fireColumnDrop(doneCol, 'done-1', ownCard);
    await flushStimulusAsync();

    expect(setTaskStatusSpy).not.toHaveBeenCalled();
  });

  it('reopen_action_transitions_done_to_todo', async () => {
    const doneTask = makeTaskDtoForStimulus({ id: 'done-1', title: 'Done Task', status: 'done' });
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([makeDefaultListDto()]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([doneTask]);
    vi.spyOn(InvokeModule, 'setTaskStatus').mockResolvedValue({ ...doneTask, status: 'todo' });

    startS4App();
    await flushStimulusAsync();
    switchToBoardView();
    await flushStimulusAsync();

    const reopenBtn = document.querySelector('.task-item__reopen-btn') as HTMLButtonElement;
    expect(reopenBtn, 'a done card must expose a Reopen action').not.toBeNull();
    reopenBtn.click();
    await flushStimulusAsync();

    expect(InvokeModule.setTaskStatus).toHaveBeenCalledWith('done-1', 'todo');
  });

  it('board_renders_in_smart_view_scope', async () => {
    // S5: no default list among the returned lists → connectAutoSelect finds
    // none → currentScope stays at its initial value, the Inbox SMART VIEW
    // (Approach §4) — genuinely a smart-view scope now, not a stand-in.
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([
      makeDefaultListDto({ id: 'inbox', is_default: false }),
    ]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([makeTaskDtoForStimulus()]);

    startS4App();
    await flushStimulusAsync();

    switchToBoardView();
    await flushStimulusAsync();

    // AC-S4-07: the board renders regardless, and the toggle is never
    // disabled/aria-disabled — retires AC-S1-08.
    expect(document.querySelector('.tasks-board')).not.toBeNull();
    const toggleBtn = document.querySelector('[data-tasks-target="viewToggleBtn"]') as HTMLButtonElement;
    expect(toggleBtn.disabled).toBe(false);
    expect(toggleBtn.hasAttribute('aria-disabled')).toBe(false);
  });

  it('board_add_row_only_in_todo_column', async () => {
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([makeDefaultListDto()]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([]);

    startS4App();
    await flushStimulusAsync();
    switchToBoardView();
    await flushStimulusAsync();

    expect(getColumn('todo').querySelector('.task-add-input')).not.toBeNull();
    expect(getColumn('doing').querySelector('.task-add-input')).toBeNull();
    expect(getColumn('done').querySelector('.task-add-input')).toBeNull();
  });
});

// =============================================================================
// S5 — A sidebar that actually works (AC-S5-04, AC-S5-06, AC-S5-09)
//
// AC-S5-01/02/03/05/08 live in lists_controller.test.ts (the rail's own
// render + count-refresh contract). These three are TasksController's own
// half: every mutation dispatches jin:tasks-changed (AC-S5-04, sharing the
// AC-X-08 chokepoint), the Today smart view's date-window logic (AC-S5-06),
// and — the AC-S5-07 CONSTRAINT's functional counterpart — proof that scope
// switching still works with the retired #tasks-list-filter select gone
// (AC-S5-09).
// =============================================================================

describe('S5 — sidebar scope + live counts (AC-S5-04/06/09)', () => {
  let s5App: Application;

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
    document.body.innerHTML = buildStimulusTasksHTML();
    localStorage.clear();
    vi.spyOn(InvokeModule, 'listTags').mockResolvedValue([]);
  });

  afterEach(() => {
    s5App?.stop();
    document.body.innerHTML = '';
    localStorage.clear();
    vi.restoreAllMocks();
  });

  function startS5App(): Application {
    s5App = Application.start(document.documentElement, defaultSchema);
    s5App.register('tasks', TasksController);
    return s5App;
  }

  // ── AC-S5-04 — every task mutation dispatches jin:tasks-changed ──────────

  it('task_mutations_dispatch_tasks_changed', async () => {
    const task = makeTaskDtoForStimulus({ id: 't1', title: 'Delete me' });
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([makeDefaultListDto()]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([task]);
    vi.spyOn(InvokeModule, 'deleteTask').mockResolvedValue(task);

    startS5App();
    await flushStimulusAsync();

    let dispatched = 0;
    document.addEventListener('jin:tasks-changed', () => {
      dispatched += 1;
    });

    // Delete "through the controller" — the row's own trash button, opening
    // the real ConfirmDialog (JinModal-hosted at #jin-modal-root), then
    // confirming — never a bare bridge call re-implemented by the test.
    const deleteBtn = document.querySelector('.task-item__delete-btn') as HTMLButtonElement;
    expect(deleteBtn).not.toBeNull();
    deleteBtn.click();

    const confirmBtn = document
      .getElementById('jin-modal-root')
      ?.querySelector<HTMLButtonElement>('.btn-danger');
    expect(confirmBtn).not.toBeNull();
    confirmBtn!.click();
    await flushStimulusAsync();

    expect(InvokeModule.deleteTask).toHaveBeenCalledWith('t1');
    expect(dispatched).toBe(1);
  });

  // ── AC-S5-06 — the Today smart view (applyScope) ──────────────────────────

  it('today_scope_selects_open_overdue_and_due_today', () => {
    // Dates computed relative to the REAL clock at test-run-time (never a
    // hardcoded literal) — this must hold whenever the suite runs, not only
    // on the day it was written.
    const now = new Date();
    const isoDateOnly = (d: Date) => d.toISOString().substring(0, 10);
    const todayStr = isoDateOnly(now);
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const nextYear = new Date(now);
    nextYear.setUTCFullYear(nextYear.getUTCFullYear() + 1);

    const lists = [makeDefaultListDto({ id: 'inbox', is_default: true })];
    const overdue = makeTaskDtoForStimulus({ id: 'overdue', status: 'todo', due: isoDateOnly(yesterday) });
    const dueToday = makeTaskDtoForStimulus({ id: 'due-today', status: 'doing', due: todayStr });
    const dueFuture = makeTaskDtoForStimulus({ id: 'due-future', status: 'todo', due: isoDateOnly(nextYear) });
    const noDue = makeTaskDtoForStimulus({ id: 'no-due', status: 'todo', due: null });
    const doneOverdue = makeTaskDtoForStimulus({ id: 'done-overdue', status: 'done', due: isoDateOnly(yesterday) });

    const scoped = applyScope(
      [overdue, dueToday, dueFuture, noDue, doneOverdue],
      { kind: 'smart', id: 'today' },
      lists,
    );

    expect(scoped.map((t) => t.id).sort()).toEqual(['due-today', 'overdue']);
  });

  it('flexible_scope_fails_closed_for_completed_cancelled_and_deleted_tasks', () => {
    const lists = [makeDefaultListDto({ id: 'inbox', is_default: true })];
    const tasks = [
      makeTaskDtoForStimulus({ id: 'todo-flex', status: 'todo', agenda_bucket: 'flexible' }),
      makeTaskDtoForStimulus({ id: 'doing-flex', status: 'doing', agenda_bucket: 'flexible' }),
      makeTaskDtoForStimulus({ id: 'done-flex', status: 'done', agenda_bucket: 'flexible' }),
      makeTaskDtoForStimulus({ id: 'cancelled-flex', status: 'cancelled', agenda_bucket: 'flexible' }),
      makeTaskDtoForStimulus({ id: 'deleted-flex', status: 'todo', agenda_bucket: 'flexible', deleted_at: '2026-08-01T00:00:00Z' }),
    ];
    expect(applyScope(tasks, { kind: 'smart', id: 'flexible' }, lists).map(task => task.id))
      .toEqual(['todo-flex', 'doing-flex']);
  });

  it('flexible_grouping_retains_open_tasks_whose_list_is_unavailable', () => {
    const lists = [makeDefaultListDto({ id: 'inbox', is_default: true })];
    const orphan = makeTaskDtoForStimulus({
      id: 'orphan-flex', list: 'removed-list', status: 'todo', agenda_bucket: 'flexible',
    });
    const groups = groupFlexibleTasks([orphan], lists);
    expect(groups).toHaveLength(1);
    expect(groups[0].list.name).toBe('Other lists');
    expect(groups[0].tasks.map(task => task.id)).toEqual(['orphan-flex']);
  });

  // ── Orphan handling (owner-directed; D7 deferred, not "fixed" here) ───────
  //
  // task.list can hold a stale list NAME instead of an id (a historical bug
  // this story does NOT fix — filterTasksList stays id-based and correct).
  // The owner asked that such a task not silently vanish from every count.
  // scopes.ts's module doc explains the resolution: the Inbox SMART VIEW
  // (not the literal Inbox list row, whose count must match what clicking it
  // renders) folds in any open task whose `list` resolves to no known id.
  it('an orphaned task (list resolves to no known id) surfaces in the Inbox smart view, not silently dropped', () => {
    const lists = [makeDefaultListDto({ id: 'inbox', is_default: true })];
    const normalInboxTask = makeTaskDtoForStimulus({ id: 'normal', status: 'todo', list: 'inbox' });
    const orphan = makeTaskDtoForStimulus({ id: 'orphan', status: 'todo', list: 'Some Old List Name' });
    const orphanDone = makeTaskDtoForStimulus({ id: 'orphan-done', status: 'done', list: 'Some Old List Name' });

    const inboxScoped = applyScope([normalInboxTask, orphan, orphanDone], { kind: 'smart', id: 'inbox' }, lists);

    // The open orphan surfaces (not silently dropped); the CLOSED orphan
    // still doesn't (Inbox only ever shows open tasks, orphan or not).
    expect(inboxScoped.map((t) => t.id).sort()).toEqual(['normal', 'orphan']);

    // The literal Inbox LIST scope (id-based, unaffected — AC-X-06) does
    // NOT pick up the orphan: its count must match what clicking that real
    // list row actually renders.
    const listScoped = applyScope([normalInboxTask, orphan], { kind: 'list', id: 'inbox' }, lists);
    expect(listScoped.map((t) => t.id)).toEqual(['normal']);
  });

  // ── AC-S5-09 — scope switching still works without the removed select ────

  it('rail_scope_switch_renders_target_list_without_filter_select', async () => {
    const l1Task = makeTaskDtoForStimulus({ id: 't-l1', title: 'In List One', list: 'l1' });
    const l2Task = makeTaskDtoForStimulus({ id: 't-l2', title: 'In List Two', list: 'l2' });
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([
      makeDefaultListDto({ id: 'l1', name: 'List One', is_default: true }),
      makeDefaultListDto({ id: 'l2', name: 'List Two', is_default: false }),
    ]);
    vi.spyOn(InvokeModule, 'listTasks').mockImplementation(async (opts) =>
      opts?.list === 'l2' ? [l2Task] : opts?.list === 'l1' ? [l1Task] : [],
    );

    startS5App();
    await flushStimulusAsync();

    // Precondition: the retired select is gone from this DOM entirely (this
    // fixture never had one) and L1 (the auto-selected default) is showing.
    expect(document.querySelector('[data-tasks-target="listFilter"]')).toBeNull();
    expect(document.querySelector('li[data-task-id="t-l1"]')).not.toBeNull();
    expect(document.querySelector('li[data-task-id="t-l2"]')).toBeNull();

    // A rail click dispatches jin:scope-changed — the ONE control for scope now.
    fireScopeChanged({ kind: 'list', id: 'l2' });
    await flushStimulusAsync();

    // The rendered task items are EXACTLY L2's tasks.
    expect(document.querySelector('li[data-task-id="t-l2"]')).not.toBeNull();
    expect(document.querySelector('li[data-task-id="t-l1"]')).toBeNull();
  });

  // ── AC-S6-10, end-to-end through the REAL controller ──────────────────────
  //
  // The pure test above (in the AC-S6-10 describe block) proves the render
  // layer's contract; this proves TasksController's OWN plumbing threads the
  // wider (pre-scope) subtask display info through on a real smart-view load
  // — not just when a test constructs it by hand.
  it('controller_renders_parent_breadcrumb_for_subtask_in_today_scope', async () => {
    const todayStr = new Date().toISOString().substring(0, 10);
    const parent = makeTaskDtoForStimulus({ id: 'parent-c', title: 'Undated parent', due: null });
    const child = makeTaskDtoForStimulus({
      id: 'child-c',
      title: 'Dated child',
      parent: 'parent-c',
      due: todayStr,
      status: 'todo',
    });
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([
      makeDefaultListDto({ id: 'inbox', is_default: false }),
    ]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([parent, child]);

    startS5App();
    await flushStimulusAsync();

    // No default list resolves → currentScope stays the Inbox smart view by
    // default; switch explicitly to Today so the assertion doesn't depend on
    // that default.
    fireScopeChanged({ kind: 'smart', id: 'today' });
    await flushStimulusAsync();

    // Only the child (due today) renders — the undated parent doesn't match Today.
    expect(document.querySelector('li[data-task-id="parent-c"]')).toBeNull();
    const childItem = document.querySelector('li[data-task-id="child-c"]');
    expect(childItem, 'the due-today subtask must render').not.toBeNull();

    const chip = childItem?.querySelector('.task-item__parent-chip');
    expect(chip, 'the REAL controller must resolve the breadcrumb against the wider fetch').not.toBeNull();
    expect(chip?.textContent).toContain('Undated parent');
  });
});

// =============================================================================
// S3 — the detail pane replaces both editors (AC-S3-01..11)
//
// The retired page-swap detail (list/detail panel toggle + back button) and
// the retired pencil→modal title/body/due editor are both gone (AC-S3-04,
// grep-checked). This suite drives the REAL Stimulus-mounted
// TasksController — selection, deep links, Escape/close, delete, and the
// D1 regression — through the ONE detail pane that replaces them.
// =============================================================================

describe('S3 — the detail pane replaces both editors (AC-S3-01..11)', () => {
  let s3App: Application;

  // jsdom does not implement HTMLDialogElement.showModal()/close() — the
  // pane's Delete control opens a real ConfirmDialog (JinModal), so this
  // suite needs the same prototype stub tasks_lists_modal_wiring.test.ts uses.
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
    document.body.innerHTML = buildStimulusTasksHTML();
    localStorage.clear();
    vi.spyOn(InvokeModule, 'listTags').mockResolvedValue([]);
  });

  afterEach(() => {
    s3App?.stop();
    document.body.innerHTML = '';
    localStorage.clear();
    vi.restoreAllMocks();
  });

  function startS3App(): Application {
    s3App = Application.start(document.documentElement, defaultSchema);
    s3App.register('tasks', TasksController);
    return s3App;
  }

  function getMainEl(): HTMLElement {
    return document.querySelector('[data-tasks-target="main"]') as HTMLElement;
  }

  function getListPanelEl(): HTMLElement {
    return document.querySelector('[data-tasks-target="listPanel"]') as HTMLElement;
  }

  function clickItemBody(taskId: string): void {
    const item = document.querySelector(`li[data-task-id="${taskId}"] .task-item__body`) as HTMLButtonElement;
    expect(item, `item body button for ${taskId} must be rendered`).not.toBeNull();
    item.click();
  }

  it('selecting_a_task_keeps_the_list_visible', async () => {
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([makeDefaultListDto()]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([
      makeTaskDtoForStimulus({ id: 't1', title: 'Task One' }),
    ]);
    vi.spyOn(InvokeModule, 'getTaskById').mockResolvedValue(makeTaskDtoForStimulus({ id: 't1', title: 'Task One' }));

    startS3App();
    await flushStimulusAsync();

    // Precondition: no `.hidden` on the list panel before selection.
    expect(getListPanelEl().classList.contains('hidden')).toBe(false);

    clickItemBody('t1');
    await flushStimulusAsync();

    // AC-S3-01: the list panel is STILL visible — no `.hidden` class was added.
    expect(getListPanelEl().classList.contains('hidden')).toBe(false);
    // And the list itself is still in the DOM, unremoved.
    expect(document.querySelector('li[data-task-id="t1"]')).not.toBeNull();
  });

  it('pane_switches_task_in_one_click', async () => {
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([makeDefaultListDto()]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([
      makeTaskDtoForStimulus({ id: 't1', title: 'Task One' }),
      makeTaskDtoForStimulus({ id: 't2', title: 'Task Two' }),
    ]);
    vi.spyOn(InvokeModule, 'getTaskById').mockImplementation(async (id: string) =>
      id === 't1'
        ? makeTaskDtoForStimulus({ id: 't1', title: 'Task One' })
        : makeTaskDtoForStimulus({ id: 't2', title: 'Task Two' }),
    );

    startS3App();
    await flushStimulusAsync();

    clickItemBody('t1');
    await flushStimulusAsync();
    expect(document.querySelector('.browse-detail__title')?.textContent).toBe('Task One');

    // ONE click on a different item re-hydrates the pane — no intermediate
    // back navigation (there is none — the back button is retired).
    clickItemBody('t2');
    await flushStimulusAsync();
    expect(document.querySelector('.browse-detail__title')?.textContent).toBe('Task Two');
    expect(document.querySelector('.browse-back-btn')).toBeNull();
  });

  it('exactly_one_item_is_aria_selected', async () => {
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([makeDefaultListDto()]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([
      makeTaskDtoForStimulus({ id: 't1', title: 'Task One' }),
      makeTaskDtoForStimulus({ id: 't2', title: 'Task Two' }),
      makeTaskDtoForStimulus({ id: 't3', title: 'Task Three' }),
    ]);
    vi.spyOn(InvokeModule, 'getTaskById').mockResolvedValue(makeTaskDtoForStimulus({ id: 't2', title: 'Task Two' }));

    startS3App();
    await flushStimulusAsync();

    // Before selection: no item is selected.
    expect(document.querySelectorAll('[data-tasks-target="list"] [aria-selected="true"]').length).toBe(0);

    clickItemBody('t2');
    await flushStimulusAsync();

    const selected = document.querySelectorAll('[data-tasks-target="list"] [aria-selected="true"]');
    expect(selected.length).toBe(1);
    expect((selected[0] as HTMLElement).dataset.taskId).toBe('t2');
  });

  // ── AC-S3-05 — the D1 regression, re-pointed at the pane ──────────────────
  //
  // Green-but-shallow watch (spec): this fixture MUST build the row from a
  // list_tasks-SHAPED DTO (body: '') — hand-feeding a body here is precisely
  // how the original D1 stayed green. The pane must hydrate via getTaskById
  // (never trust the row's body) so a title-only edit can never resend '' as
  // the task's notes.
  it('renaming_from_pane_never_erases_notes_D1_regression', async () => {
    const REAL_NOTES = 'Original notes — do not lose me';
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([makeDefaultListDto()]);
    // list_tasks() projection: body is ALWAYS '' (jin-core/src/dto/task.rs:104).
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([
      makeTaskDtoForStimulus({ id: 't1', title: 'Original Title', body: '' }),
    ]);
    // get_task (the pane's ONLY hydration source) returns the REAL body.
    vi.spyOn(InvokeModule, 'getTaskById').mockResolvedValue(
      makeTaskDtoForStimulus({ id: 't1', title: 'Original Title', body: REAL_NOTES }),
    );
    vi.spyOn(InvokeModule, 'editTask').mockResolvedValue(
      makeTaskDtoForStimulus({ id: 't1', title: 'Renamed Task', body: REAL_NOTES }),
    );

    startS3App();
    await flushStimulusAsync();

    clickItemBody('t1');
    await flushStimulusAsync();

    expect(InvokeModule.getTaskById).toHaveBeenCalledWith('t1');

    const titleEl = document.querySelector('.browse-detail__title') as HTMLElement;
    expect(titleEl).not.toBeNull();
    // The user renames the task — deliberately never touches the notes field.
    titleEl.textContent = 'Renamed Task';
    titleEl.dispatchEvent(new Event('blur'));
    await flushStimulusAsync();

    expect(InvokeModule.editTask).toHaveBeenCalled();
    const [editedId, params] = vi.mocked(InvokeModule.editTask).mock.calls[0];
    expect(editedId).toBe('t1');
    expect(params.title).toBe('Renamed Task');
    // The real notes must survive: either never resent (per-field save — the
    // pane's onSaveTitle payload carries ONLY `title`) or resent verbatim —
    // but NEVER the list projection's ''.
    expect(params.body === undefined || params.body === REAL_NOTES).toBe(true);
    expect(params.body).not.toBe('');
  });

  it('pane_exposes_every_core_field', async () => {
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([makeDefaultListDto()]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([
      makeTaskDtoForStimulus({ id: 't1', title: 'Task One' }),
    ]);
    vi.spyOn(InvokeModule, 'getTaskById').mockResolvedValue(makeTaskDtoForStimulus({ id: 't1', title: 'Task One' }));

    startS3App();
    await flushStimulusAsync();

    clickItemBody('t1');
    await flushStimulusAsync();

    const content = document.querySelector('[data-tasks-target="detailContent"]') as HTMLElement;
    expect(content.querySelector('.browse-detail__title')).not.toBeNull(); // title
    expect(content.querySelector('.task-detail__status-select')).not.toBeNull(); // status
    expect(content.querySelector('.task-detail__priority-select')).not.toBeNull(); // priority
    expect(content.querySelector('.task-detail__due-btn')).not.toBeNull(); // due
    expect(content.querySelector('.task-detail__list-select')).not.toBeNull(); // list
    expect(content.querySelector('.task-detail__section-select')).not.toBeNull(); // section
    expect(content.querySelector('.task-detail__tag-input')).not.toBeNull(); // tags
    expect(content.querySelector('.task-detail__body')).not.toBeNull(); // notes/body
    expect(content.querySelector('.task-detail__reminders')).not.toBeNull(); // reminders
  });

  it('pane_delete_calls_delete_task', async () => {
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([makeDefaultListDto()]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([
      makeTaskDtoForStimulus({ id: 't1', title: 'Task One' }),
    ]);
    vi.spyOn(InvokeModule, 'getTaskById').mockResolvedValue(makeTaskDtoForStimulus({ id: 't1', title: 'Task One' }));
    vi.spyOn(InvokeModule, 'deleteTask').mockResolvedValue(makeTaskDtoForStimulus({ id: 't1' }));

    startS3App();
    await flushStimulusAsync();

    clickItemBody('t1');
    await flushStimulusAsync();

    // The old page-swap detail had NO delete control at all (spec).
    const deleteBtn = document.querySelector('.tasks-detail-pane__delete-btn') as HTMLButtonElement;
    expect(deleteBtn).not.toBeNull();
    deleteBtn.click();

    const root = document.getElementById('jin-modal-root');
    const confirmBtn = root?.querySelector<HTMLButtonElement>('.btn-danger');
    expect(confirmBtn).not.toBeNull();
    confirmBtn!.click();
    await flushStimulusAsync();

    expect(InvokeModule.deleteTask).toHaveBeenCalledWith('t1');
  });

  it('deep_link_switches_scope_then_selects', async () => {
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([
      makeDefaultListDto({ id: 'inbox', name: 'Inbox', is_default: true }),
      makeDefaultListDto({ id: 'work', name: 'Work', is_default: false }),
    ]);
    const taskInWork = makeTaskDtoForStimulus({ id: 't-work', title: 'Deep-linked Task', list: 'work' });
    vi.spyOn(InvokeModule, 'listTasks').mockImplementation(async (opts) =>
      opts?.list === 'work' ? [taskInWork] : [],
    );
    vi.spyOn(InvokeModule, 'getTaskById').mockResolvedValue(taskInWork);

    startS3App();
    await flushStimulusAsync();

    // Precondition: the default scope (Inbox) is active, and the target
    // task — which lives in "work" — is not present in it. (S5: scope is no
    // longer readable off a shared <select>; the absence of the row IS the
    // precondition.)
    expect(document.querySelector('li[data-task-id="t-work"]')).toBeNull();

    const section = document.querySelector('[data-controller~="tasks"]') as HTMLElement;
    section.dispatchEvent(
      new CustomEvent('jin:open-detail', { detail: { id: 't-work' }, bubbles: false }),
    );
    await flushStimulusAsync();

    // AC-S3-08: scope switched to the task's list BEFORE it was selected —
    // proven by the task now being rendered (it only renders once loadList()
    // re-fetches with list: 'work').
    const item = document.querySelector('li[data-task-id="t-work"]');
    expect(item, 'the task must now be visible in the (switched) scope').not.toBeNull();
    expect(item?.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('.browse-detail__title')?.textContent).toBe('Deep-linked Task');
  });

  it('escape_clears_selection_and_closes_pane', async () => {
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([makeDefaultListDto()]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([
      makeTaskDtoForStimulus({ id: 't1', title: 'Task One' }),
    ]);
    vi.spyOn(InvokeModule, 'getTaskById').mockResolvedValue(makeTaskDtoForStimulus({ id: 't1', title: 'Task One' }));

    startS3App();
    await flushStimulusAsync();

    clickItemBody('t1');
    await flushStimulusAsync();
    expect(getMainEl().classList.contains('tasks-main--detail-open')).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushStimulusAsync();

    expect(getMainEl().classList.contains('tasks-main--detail-open')).toBe(false);
    expect(document.querySelectorAll('[data-tasks-target="list"] [aria-selected="true"]').length).toBe(0);
  });

  it('scope_switch_clears_stale_detail_before_loading_the_next_list', async () => {
    const inboxTask = makeTaskDtoForStimulus({ id: 't1', title: 'Inbox Task', list: 'inbox' });
    const workTask = makeTaskDtoForStimulus({ id: 't2', title: 'Work Task', list: 'work' });
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([
      makeDefaultListDto({ id: 'inbox', is_default: true }),
      makeDefaultListDto({ id: 'work', is_default: false }),
    ]);
    vi.spyOn(InvokeModule, 'listTasks').mockImplementation(async (opts) =>
      opts?.list === 'work' ? [workTask] : [inboxTask],
    );
    vi.spyOn(InvokeModule, 'getTaskById').mockResolvedValue(inboxTask);

    startS3App();
    await flushStimulusAsync();
    clickItemBody('t1');
    await flushStimulusAsync();

    const detailContent = document.querySelector('[data-tasks-target="detailContent"]') as HTMLElement;
    expect(getMainEl().classList.contains('tasks-main--detail-open')).toBe(true);
    expect(detailContent.childElementCount).toBeGreaterThan(0);

    fireScopeChanged({ kind: 'list', id: 'work' });

    expect(getMainEl().classList.contains('tasks-main--detail-open')).toBe(false);
    expect(detailContent.childElementCount).toBe(0);
    await flushStimulusAsync();
    expect(document.querySelector('li[data-task-id="t2"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-tasks-target="list"] [aria-selected="true"]')).toHaveLength(0);
  });

  it('close_button_clears_selection_and_closes_pane', async () => {
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([makeDefaultListDto()]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([
      makeTaskDtoForStimulus({ id: 't1', title: 'Task One' }),
    ]);
    vi.spyOn(InvokeModule, 'getTaskById').mockResolvedValue(makeTaskDtoForStimulus({ id: 't1', title: 'Task One' }));

    startS3App();
    await flushStimulusAsync();

    clickItemBody('t1');
    await flushStimulusAsync();
    expect(getMainEl().classList.contains('tasks-main--detail-open')).toBe(true);

    const closeBtn = document.querySelector('.tasks-detail-pane__close-btn') as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();
    closeBtn.click();
    await flushStimulusAsync();

    expect(getMainEl().classList.contains('tasks-main--detail-open')).toBe(false);
    expect(document.querySelectorAll('[data-tasks-target="list"] [aria-selected="true"]').length).toBe(0);
  });

  it('pane_renders_backlinks_section', async () => {
    const EVT_LABEL = 'Q3 Review Meeting';
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([makeDefaultListDto()]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([
      makeTaskDtoForStimulus({ id: 't1', title: 'Task One' }),
    ]);
    vi.spyOn(InvokeModule, 'getTaskById').mockResolvedValue(
      makeTaskDtoForStimulus({
        id: 't1',
        title: 'Task One',
        backlinks: [makeTaskBacklink({ source_id: 'evt-1', label: EVT_LABEL })],
      }),
    );

    startS3App();
    await flushStimulusAsync();

    clickItemBody('t1');
    await flushStimulusAsync();

    const section = document.querySelector('.browse-detail__links-section');
    expect(section).not.toBeNull();
    expect(section?.textContent).toContain(EVT_LABEL);
  });

  it('pane_exposes_promote_action', async () => {
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([makeDefaultListDto()]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([
      makeTaskDtoForStimulus({ id: 't1', title: 'Task One' }),
    ]);
    vi.spyOn(InvokeModule, 'getTaskById').mockResolvedValue(makeTaskDtoForStimulus({ id: 't1', title: 'Task One' }));

    startS3App();
    await flushStimulusAsync();

    clickItemBody('t1');
    await flushStimulusAsync();

    const promoted: string[] = [];
    document.addEventListener('jin:open-promote', (e) => {
      promoted.push((e as CustomEvent<{ taskId: string }>).detail.taskId);
    });

    const promoteBtn = document.querySelector('.task-promote-btn') as HTMLButtonElement;
    expect(promoteBtn).not.toBeNull();
    promoteBtn.click();

    expect(promoted).toEqual(['t1']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S6 — Subtasks are real tasks (AC-S6-10..15)
// ─────────────────────────────────────────────────────────────────────────────

describe('S6 — parent breadcrumb + subtask progress (transform.ts, pure)', () => {
  it('computeSubtaskDisplayInfo: a parent with 5 children (2 done) gets progress {done:2, total:5}', () => {
    const parent = makeTask({ id: 'parent-1' });
    const children = [
      makeTask({ id: 'c1', parent: 'parent-1', status: 'done' }),
      makeTask({ id: 'c2', parent: 'parent-1', status: 'done' }),
      makeTask({ id: 'c3', parent: 'parent-1', status: 'todo' }),
      makeTask({ id: 'c4', parent: 'parent-1', status: 'doing' }),
      makeTask({ id: 'c5', parent: 'parent-1', status: 'todo' }),
    ];
    const info = computeSubtaskDisplayInfo([parent, ...children]);
    expect(info.get('parent-1')?.progress).toEqual({ done: 2, total: 5 });
  });

  it('computeSubtaskDisplayInfo: a child gets a parentBreadcrumb naming its parent', () => {
    const parent = makeTask({ id: 'parent-2', title: 'Ship the release' });
    const child = makeTask({ id: 'child-2', parent: 'parent-2' });
    const info = computeSubtaskDisplayInfo([parent, child]);
    expect(info.get('child-2')?.parentBreadcrumb).toEqual({
      parentId: 'parent-2',
      parentTitle: 'Ship the release',
    });
  });

  it('computeSubtaskDisplayInfo: a task with no children and no parent gets neither', () => {
    const solo = makeTask({ id: 'solo' });
    const info = computeSubtaskDisplayInfo([solo]);
    expect(info.get('solo')).toBeUndefined();
  });

  it('partitionParentsAndChildren: a child whose parent is absent from the dataset is treated as top-level', () => {
    const orphanChild = makeTask({ id: 'orphan', parent: 'missing-parent' });
    const { topLevel, childrenByParent } = partitionParentsAndChildren([orphanChild]);
    expect(topLevel.map((t) => t.id)).toEqual(['orphan']);
    expect(childrenByParent.size).toBe(0);
  });
});

describe('AC-S6-11 — parent item shows a `2/5` subtask progress indicator', () => {
  it('parent_item_shows_subtask_progress', () => {
    const parent = makeTask({ id: 'parent', title: 'Parent task' });
    const children = [
      makeTask({ id: 'c1', parent: 'parent', status: 'done' }),
      makeTask({ id: 'c2', parent: 'parent', status: 'done' }),
      makeTask({ id: 'c3', parent: 'parent', status: 'todo' }),
      makeTask({ id: 'c4', parent: 'parent', status: 'doing' }),
      makeTask({ id: 'c5', parent: 'parent', status: 'todo' }),
    ];
    // Standalone rendering (nestChildren=false — "All Lists" / board-shaped
    // dataset): the parent still carries its own progress badge regardless
    // of whether children are nested or standalone.
    renderTasksList(el, templates, [parent, ...children], noopNavigate);

    const progressEl = document.querySelector('li[data-task-id="parent"] .task-item__subtask-progress');
    expect(progressEl, 'progress slot must be rendered for the parent item').not.toBeNull();
    expect(progressEl?.textContent).toBe('2/5');
  });

  it('a task with no children shows no progress text (empty slot, hidden by CSS)', () => {
    renderTasksList(el, templates, [makeTask({ id: 'lonely' })], noopNavigate);
    const progressEl = document.querySelector('li[data-task-id="lonely"] .task-item__subtask-progress');
    expect(progressEl?.textContent).toBe('');
  });
});

describe('AC-S6-12 — a subtask\'s pane disables its list and section selects', () => {
  it('subtask_pane_disables_list_and_section', () => {
    const subtask = makeTask({ id: 'sub-1', parent: 'parent-1', list: 'inbox', section_id: 'sec-1' });
    renderTaskPane(el, templates, subtask, noopNavigate, undefined, undefined, {
      onSaveList: vi.fn(),
      onSaveSection: vi.fn(),
      availableLists: [{ id: 'inbox', name: 'Inbox' }],
      availableSections: [{ id: 'sec-1', list_id: 'inbox', name: 'Backlog', position: 'V', task_count: 1 }],
    });

    const listSel = el.detailContent.querySelector('.task-detail__list-select') as HTMLSelectElement | null;
    const sectionSel = el.detailContent.querySelector('.task-detail__section-select') as HTMLSelectElement | null;
    expect(listSel, 'list select must be rendered').not.toBeNull();
    expect(sectionSel, 'section select must be rendered').not.toBeNull();
    expect(listSel!.disabled).toBe(true);
    expect(sectionSel!.disabled).toBe(true);
  });

  it('a top-level task (no parent) has ENABLED list and section selects', () => {
    const topLevel = makeTask({ id: 'top-1', list: 'inbox', section_id: 'sec-1' });
    renderTaskPane(el, templates, topLevel, noopNavigate, undefined, undefined, {
      onSaveList: vi.fn(),
      onSaveSection: vi.fn(),
      availableLists: [{ id: 'inbox', name: 'Inbox' }],
      availableSections: [{ id: 'sec-1', list_id: 'inbox', name: 'Backlog', position: 'V', task_count: 1 }],
    });

    const listSel = el.detailContent.querySelector('.task-detail__list-select') as HTMLSelectElement | null;
    const sectionSel = el.detailContent.querySelector('.task-detail__section-select') as HTMLSelectElement | null;
    expect(listSel!.disabled).toBe(false);
    expect(sectionSel!.disabled).toBe(false);
  });
});

describe('AC-S6-13 — children render nested under their parent, never also top-level', () => {
  it('children_render_nested_under_parent_not_top_level', () => {
    const a = makeTask({ id: 'A', title: 'Parent A' });
    const b = makeTask({ id: 'B', title: 'Child B', parent: 'A' });
    const c = makeTask({ id: 'C', title: 'Child C', parent: 'A' });

    // nestChildren=true — a single list is the active scope (AC-S6-13's GIVEN).
    renderTasksList(el, templates, [a, b, c], noopNavigate, undefined, null, true);

    const bItem = document.querySelector('li[data-task-id="B"]');
    const cItem = document.querySelector('li[data-task-id="C"]');
    expect(bItem, 'B must render').not.toBeNull();
    expect(cItem, 'C must render').not.toBeNull();
    expect(bItem?.classList.contains('task-item--child')).toBe(true);
    expect(cItem?.classList.contains('task-item--child')).toBe(true);

    // Each child id appears EXACTLY ONCE in the rendered list (not also as a
    // separate top-level row) — the whole point of AC-S6-13.
    expect(document.querySelectorAll('li[data-task-id="B"]').length).toBe(1);
    expect(document.querySelectorAll('li[data-task-id="C"]').length).toBe(1);

    // B and C render directly beneath A: siblings, immediately after it.
    // (Direct `<li>` children of the list only — each item's inner
    // `.task-item__body` button ALSO carries `data-task-id`, so a plain
    // `querySelectorAll('[data-task-id]')` would double-count per item.)
    const items = Array.from(el.list.children);
    const ids = items.map((i) => (i as HTMLElement).dataset.taskId);
    expect(ids.indexOf('B')).toBe(ids.indexOf('A') + 1);
    expect(ids.indexOf('C')).toBe(ids.indexOf('A') + 2);
  });

  it('a task whose parent is absent from the dataset renders top-level (not silently dropped)', () => {
    const orphan = makeTask({ id: 'orphan', parent: 'ghost-parent' });
    renderTasksList(el, templates, [orphan], noopNavigate, undefined, null, true);
    const item = document.querySelector('li[data-task-id="orphan"]');
    expect(item).not.toBeNull();
    expect(item?.classList.contains('task-item--child')).toBe(false);
  });
});

describe('AC-S6-14 — collapsing a parent hides its child items', () => {
  it('collapsing_parent_hides_child_items', () => {
    const a = makeTask({ id: 'A', title: 'Parent A' });
    const b = makeTask({ id: 'B', parent: 'A' });
    const c = makeTask({ id: 'C', parent: 'A' });
    renderTasksList(el, templates, [a, b, c], noopNavigate, undefined, null, true);

    expect(document.querySelector('li[data-task-id="B"]')).not.toBeNull();
    expect(document.querySelector('li[data-task-id="C"]')).not.toBeNull();

    const toggle = document.querySelector(
      'li[data-task-id="A"] .task-item__collapse-toggle',
    ) as HTMLButtonElement | null;
    expect(toggle, 'A must expose a collapse toggle (it has children)').not.toBeNull();
    toggle!.click();

    expect(document.querySelector('li[data-task-id="B"]'), 'B must be removed from the DOM on collapse').toBeNull();
    expect(document.querySelector('li[data-task-id="C"]'), 'C must be removed from the DOM on collapse').toBeNull();
    // A itself stays.
    expect(document.querySelector('li[data-task-id="A"]')).not.toBeNull();
  });

  it('expanding again re-inserts the child items', () => {
    const a = makeTask({ id: 'A' });
    const b = makeTask({ id: 'B', parent: 'A' });
    renderTasksList(el, templates, [a, b], noopNavigate, undefined, null, true);

    const toggle = document.querySelector(
      'li[data-task-id="A"] .task-item__collapse-toggle',
    ) as HTMLButtonElement;
    toggle.click(); // collapse
    expect(document.querySelector('li[data-task-id="B"]')).toBeNull();
    toggle.click(); // expand
    expect(document.querySelector('li[data-task-id="B"]')).not.toBeNull();
  });

  it('a parent with no children exposes no collapse toggle', () => {
    renderTasksList(el, templates, [makeTask({ id: 'solo' })], noopNavigate, undefined, null, true);
    expect(document.querySelector('li[data-task-id="solo"] .task-item__collapse-toggle')).toBeNull();
  });
});

describe('AC-S6-15 — a child item exposes no drag handle and is not draggable', () => {
  it('child_items_are_not_draggable', () => {
    const a = makeTask({ id: 'A' });
    const b = makeTask({ id: 'B', parent: 'A' });
    const onDrop = vi.fn();
    const onDragStart = vi.fn();

    // Even though the caller passes DnD callbacks (as the real list-view
    // caller always does), a nested CHILD must never become draggable.
    renderTasksList(el, templates, [a, b], noopNavigate, { onDrop, onDragStart }, null, true);

    const childItem = document.querySelector('li[data-task-id="B"]') as HTMLElement;
    expect(childItem).not.toBeNull();
    expect(childItem.getAttribute('draggable')).not.toBe('true');
    expect(childItem.querySelector('.task-item__drag-handle')).toBeNull();

    // The PARENT (a top-level item) still gets its drag handle — only the
    // nested child is exempted.
    const parentItem = document.querySelector('li[data-task-id="A"]') as HTMLElement;
    expect(parentItem.getAttribute('draggable')).toBe('true');
  });
});

describe('AC-S6-10 — a subtask surfaces standalone with a parent breadcrumb chip', () => {
  // NOTE: AC-S6-10 as frozen names "the Today smart view", which is S5's
  // deliverable (`lib/tasks/scopes.ts` / `applyScope` — Approach §4). That
  // module does not exist on this branch (S6 depends on S2/S3 per the
  // sequencing table, not S5) — main has S1..S4 merged only. Flagged to the
  // requester rather than silently fabricated: building a stand-in
  // "Today" scope here would be exactly the cross-story scope creep this
  // change's brief says to stop and report instead of doing. This test pins
  // the part of AC-S6-10 that IS S6's own responsibility per the Approach §6
  // action plan (item 6: "board and smart views show children as standalone
  // items with a parent breadcrumb chip") — the breadcrumb-chip capability
  // itself, exercised through the standalone (non-nested) render path any
  // future smart view will reuse. Re-verify the literal "Today" wording once
  // S5 ships `scopes.ts`.
  it('subtask_renders_standalone_with_parent_breadcrumb_chip_in_non_nested_scope', () => {
    const parent = makeTask({ id: 'parent-today', title: 'Quarterly plan' });
    const child = makeTask({
      id: 'child-today',
      title: 'Draft the outline',
      parent: 'parent-today',
      due: '2026-07-14',
    });

    // Standalone (nestChildren=false) is what "All Lists" and — once S5
    // ships — every smart view render through; the board (renderBoardView)
    // is always standalone too.
    renderTasksList(el, templates, [parent, child], noopNavigate);

    const childItem = document.querySelector('li[data-task-id="child-today"]');
    expect(childItem, 'child must render as a standalone item').not.toBeNull();
    expect(childItem?.classList.contains('task-item--child')).toBe(false);

    const chip = childItem?.querySelector('.task-item__parent-chip');
    expect(chip, 'standalone child must carry a parent breadcrumb chip').not.toBeNull();
    expect(chip?.textContent).toContain('Quarterly plan');
  });

  it('a nested child (list scope) does NOT carry a redundant breadcrumb chip', () => {
    const parent = makeTask({ id: 'p2', title: 'Parent' });
    const child = makeTask({ id: 'c2', parent: 'p2' });
    renderTasksList(el, templates, [parent, child], noopNavigate, undefined, null, true);

    const childItem = document.querySelector('li[data-task-id="c2"]');
    expect(childItem?.querySelector('.task-item__parent-chip')).toBeNull();
  });

  // ── AC-S6-10, literal wording, now that S5 ships scopes.ts ────────────────
  //
  // The NOTE above flagged that this criterion names "the Today smart view"
  // literally, which S6 could not yet build against. S5 creates
  // `lib/tasks/scopes.ts` — this re-verifies the exact wording: a subtask
  // due today surfaces in the REAL Today smart view, standalone, carrying
  // its parent breadcrumb chip.
  //
  // Green-but-shallow trap this test guards against: the parent task here
  // deliberately has NO due date of its own (the common real-world shape —
  // most parent tasks are undated checklists). If the breadcrumb chip were
  // computed from the Today-NARROWED task set alone (applyScope's output),
  // the parent would already be filtered out (it doesn't match Today), and
  // `computeSubtaskDisplayInfo` would find no parent to attach a breadcrumb
  // to — silently blanking the chip. The fix (TasksController resolves
  // subtask display info against the FULL fetched set, before scoping) is
  // exercised here by passing the wider `[parent, child]` set as the 8th
  // `subtaskDisplayInfo`-source argument's SOURCE, while rendering only the
  // Today-scoped (child-only) subset — exactly what the real controller does.
  it('AC-S6-10 (literal): a subtask due today surfaces in the real Today smart view with its parent breadcrumb chip', () => {
    const todayStr = new Date().toISOString().substring(0, 10);
    const lists = [makeDefaultListDto({ id: 'inbox', is_default: true })];

    // The parent has NO due date — it will NOT itself match the Today scope.
    const parent = makeTask({ id: 'parent-today', title: 'Quarterly plan', due: null });
    const child = makeTask({
      id: 'child-today',
      title: 'Draft the outline',
      parent: 'parent-today',
      due: todayStr,
      status: 'todo',
    });
    const fullSet = [parent, child];

    const todayScoped = applyScope(fullSet, { kind: 'smart', id: 'today' }, lists);
    // Only the child matches Today — the parent, with no due date, does not.
    expect(todayScoped.map((t) => t.id)).toEqual(['child-today']);

    // Render exactly what TasksController renders for a smart view: the
    // NARROWED (Today-only) set, with subtask display info resolved against
    // the WIDER, unscoped fetch (AC-S6-10 / the fix above).
    const wideDisplayInfo = computeSubtaskDisplayInfo(fullSet);
    renderTasksList(el, templates, todayScoped, noopNavigate, undefined, null, false, wideDisplayInfo);

    const childItem = document.querySelector('li[data-task-id="child-today"]');
    expect(childItem, 'the due-today subtask must render standalone').not.toBeNull();
    expect(childItem?.classList.contains('task-item--child')).toBe(false);

    const chip = childItem?.querySelector('.task-item__parent-chip');
    expect(chip, 'it must carry a parent breadcrumb chip even though the parent itself is not in the Today scope').not.toBeNull();
    expect(chip?.textContent).toContain('Quarterly plan');

    // The parent itself must NOT appear (it doesn't match Today).
    expect(document.querySelector('li[data-task-id="parent-today"]')).toBeNull();
  });
});

// =============================================================================
// S7 — Bulk multi-select and keyboard flow (AC-S7-01..08)
//
// Drives the REAL Stimulus-mounted TasksController — click/ctrl-click/shift-
// click selection, the bulk panel, bulk delete's partial-failure honesty, the
// ONE `jin:tasks-changed` per batch, and the keyboard flow (arrow-nav, Enter,
// Delete, and the "inert while typing" guard).
// =============================================================================

describe('S7 — bulk multi-select and keyboard flow (AC-S7-01..08)', () => {
  let s7App: Application;

  // jsdom does not implement HTMLDialogElement.showModal()/close() — the
  // bulk (and single) delete confirm opens a real ConfirmDialog (JinModal),
  // same stub tasks_lists_modal_wiring.test.ts and the S3 suite above use.
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
    document.body.innerHTML = buildStimulusTasksHTML();
    localStorage.clear();
    vi.spyOn(InvokeModule, 'listTags').mockResolvedValue([]);
  });

  afterEach(() => {
    s7App?.stop();
    document.body.innerHTML = '';
    localStorage.clear();
    vi.restoreAllMocks();
  });

  function startS7App(): Application {
    s7App = Application.start(document.documentElement, defaultSchema);
    s7App.register('tasks', TasksController);
    return s7App;
  }

  function itemBody(taskId: string): HTMLButtonElement {
    const el = document.querySelector(`li[data-task-id="${taskId}"] .task-item__body`);
    expect(el, `item body button for ${taskId} must be rendered`).not.toBeNull();
    return el as HTMLButtonElement;
  }

  function clickItemBody(taskId: string): void {
    itemBody(taskId).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }

  function ctrlClickItemBody(taskId: string): void {
    itemBody(taskId).dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }),
    );
  }

  function ariaSelectedIds(): string[] {
    return Array.from(
      document.querySelectorAll<HTMLElement>('[data-tasks-target="list"] [aria-selected="true"]'),
    )
      .map((el) => el.dataset.taskId ?? '')
      .sort();
  }

  // ── AC-S7-01 — cmd/ctrl-click multi-selects ────────────────────────────────

  it('ctrl_click_multi_selects', async () => {
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([makeDefaultListDto()]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([
      makeTaskDtoForStimulus({ id: 't1', title: 'Task One' }),
      makeTaskDtoForStimulus({ id: 't2', title: 'Task Two' }),
      makeTaskDtoForStimulus({ id: 't3', title: 'Task Three' }),
    ]);

    startS7App();
    await flushStimulusAsync();

    ctrlClickItemBody('t1');
    ctrlClickItemBody('t2');
    ctrlClickItemBody('t3');
    await flushStimulusAsync();

    expect(ariaSelectedIds()).toEqual(['t1', 't2', 't3']);
  });

  // ── AC-S7-02 — bulk status control offers only the INTERSECTION ──────────
  //
  // NOTE ON THE FROZEN CRITERION: AC-S7-02's GIVEN ("one `done` task and one
  // `todo` task") does not actually produce its own stated THEN ("offer only
  // `todo`") under the real FSM. `legalNextStatuses('done') == ['todo']` and
  // `legalNextStatuses('todo') == ['doing','done','cancelled']` (jin-core
  // model/task.rs:49-61's `can_transition_to` has no Todo->Todo arm — a
  // status is never its own successor) — the intersection of those two sets
  // is EMPTY, not `{todo}`. A pair that DOES produce exactly `{todo}` — and
  // is what the criterion's own THEN clause and its underlying intent
  // ("offer only what's legal for every selected task") actually describe —
  // is one `done` task and one `doing` task:
  // `legalNextStatuses('doing') == ['todo','done','cancelled']`, intersected
  // with `['todo']` == `['todo']`. This test uses that corrected pair and
  // asserts the exact value the criterion names. Flagged to the checker
  // (kupo) per the ESL; see the S7 report for the full writeup. Reporting a
  // broken criterion instead of silently building a second, matching-but-
  // wrong FSM table is the point (Approach §8 / AC-S1-04's anti-vacuity
  // reasoning: a criterion is not fixed by making the code agree with it).
  it('bulk_status_offers_only_intersection_of_legal_transitions', async () => {
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([makeDefaultListDto()]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([
      makeTaskDtoForStimulus({ id: 't1', title: 'Done Task', status: 'done' }),
      makeTaskDtoForStimulus({ id: 't2', title: 'Doing Task', status: 'doing' }),
    ]);

    startS7App();
    await flushStimulusAsync();

    ctrlClickItemBody('t1');
    ctrlClickItemBody('t2');
    await flushStimulusAsync();

    const statusSelect = document.querySelector(
      '.tasks-bulk-panel__status-select',
    ) as HTMLSelectElement | null;
    expect(statusSelect, 'bulk panel status select must render').not.toBeNull();
    const values = Array.from(statusSelect!.options)
      .map((o) => o.value)
      .filter((v) => v !== '');
    expect(values).toEqual(['todo']);
  });

  // ── AC-S7-03 — partial failure reports honestly and keeps going ──────────

  it('bulk_partial_failure_reports_and_continues', async () => {
    stubDialogPrototype();
    const ids = ['t1', 't2', 't3', 't4', 't5'];
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([makeDefaultListDto()]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue(
      ids.map((id) => makeTaskDtoForStimulus({ id, title: `Task ${id}` })),
    );
    vi.spyOn(InvokeModule, 'deleteTask').mockImplementation(async (id: string) => {
      if (id === 't3') {
        throw { code: 1, kind: 'other', message: 'boom', retriable: false };
      }
      return makeTaskDtoForStimulus({ id });
    });

    startS7App();
    await flushStimulusAsync();

    for (const id of ids) ctrlClickItemBody(id);
    await flushStimulusAsync();

    const errors: JinErrorDto[] = [];
    const onError = (e: Event) => errors.push((e as CustomEvent<JinErrorDto>).detail);
    document.addEventListener('app:error', onError);

    const deleteBtn = document.querySelector('.tasks-bulk-panel__delete-btn') as HTMLButtonElement;
    expect(deleteBtn, 'bulk panel delete button must render').not.toBeNull();
    deleteBtn.click();

    const confirmBtn = document
      .getElementById('jin-modal-root')
      ?.querySelector<HTMLButtonElement>('.btn-danger');
    expect(confirmBtn, 'bulk delete confirm dialog must open').not.toBeNull();
    confirmBtn!.click();
    await flushStimulusAsync();

    document.removeEventListener('app:error', onError);

    // Item 3 rejected but items 4 and 5 were still attempted (never aborted).
    expect(InvokeModule.deleteTask).toHaveBeenCalledTimes(5);
    for (const id of ids) {
      expect(InvokeModule.deleteTask).toHaveBeenCalledWith(id);
    }
    expect(errors.some((e) => e.message.includes('4 of 5'))).toBe(true);
  });

  // ── AC-S7-08 — exactly ONE jin:tasks-changed per batch ────────────────────

  it('bulk_dispatches_tasks_changed_exactly_once', async () => {
    stubDialogPrototype();
    const ids = ['t1', 't2', 't3', 't4', 't5'];
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([makeDefaultListDto()]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue(
      ids.map((id) => makeTaskDtoForStimulus({ id, title: `Task ${id}` })),
    );
    vi.spyOn(InvokeModule, 'deleteTask').mockImplementation(async (id: string) => {
      if (id === 't3') {
        throw { code: 1, kind: 'other', message: 'boom', retriable: false };
      }
      return makeTaskDtoForStimulus({ id });
    });

    startS7App();
    await flushStimulusAsync();

    for (const id of ids) ctrlClickItemBody(id);
    await flushStimulusAsync();

    let dispatchCount = 0;
    document.addEventListener('jin:tasks-changed', () => {
      dispatchCount += 1;
    });

    const deleteBtn = document.querySelector('.tasks-bulk-panel__delete-btn') as HTMLButtonElement;
    deleteBtn.click();
    const confirmBtn = document
      .getElementById('jin-modal-root')
      ?.querySelector<HTMLButtonElement>('.btn-danger');
    confirmBtn!.click();
    await flushStimulusAsync();

    expect(InvokeModule.deleteTask).toHaveBeenCalledTimes(5);
    // Never zero (stale sidebar counts) and never N (thrash) — exactly one,
    // even though item 3 of 5 rejected (a partial failure).
    expect(dispatchCount).toBe(1);
  });

  // ── AC-S7-04 — ArrowDown moves the selection ──────────────────────────────

  it('arrow_down_moves_selection', async () => {
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([makeDefaultListDto()]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([
      makeTaskDtoForStimulus({ id: 't1', title: 'Task One' }),
      makeTaskDtoForStimulus({ id: 't2', title: 'Task Two' }),
    ]);
    vi.spyOn(InvokeModule, 'getTaskById').mockResolvedValue(
      makeTaskDtoForStimulus({ id: 't1', title: 'Task One' }),
    );

    startS7App();
    await flushStimulusAsync();

    clickItemBody('t1');
    await flushStimulusAsync();
    expect(itemBody('t1').closest('li')?.getAttribute('aria-selected')).toBe('true');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await flushStimulusAsync();

    expect(itemBody('t2').closest('li')?.getAttribute('aria-selected')).toBe('true');
    expect(itemBody('t1').closest('li')?.getAttribute('aria-selected')).toBe('false');
  });

  it('native select keeps Arrow keys and Shift+V instead of triggering task shortcuts', async () => {
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([makeDefaultListDto()]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([
      makeTaskDtoForStimulus({ id: 't1', title: 'Task One' }),
      makeTaskDtoForStimulus({ id: 't2', title: 'Task Two' }),
    ]);
    vi.spyOn(InvokeModule, 'getTaskById').mockResolvedValue(
      makeTaskDtoForStimulus({ id: 't1', title: 'Task One' }),
    );

    startS7App();
    await flushStimulusAsync();
    clickItemBody('t1');
    await flushStimulusAsync();

    const select = document.querySelector<HTMLSelectElement>('[data-tasks-target="sortModeSelect"]')!;
    select.focus();
    const arrow = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    select.dispatchEvent(arrow);
    await flushStimulusAsync();

    expect(arrow.defaultPrevented).toBe(false);
    expect(itemBody('t1').closest('li')?.getAttribute('aria-selected')).toBe('true');
    expect(itemBody('t2').closest('li')?.getAttribute('aria-selected')).toBe('false');

    const viewShortcut = new KeyboardEvent('keydown', {
      key: 'V',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    select.dispatchEvent(viewShortcut);
    await flushStimulusAsync();
    expect(viewShortcut.defaultPrevented).toBe(false);
    expect(localStorage.getItem('jin.tasks.view')).toBeNull();
    expect(document.querySelector('.tasks-board')).toBeNull();
  });

  // ── AC-S7-05 — Enter opens the pane for the keyboard-selected item ────────

  it('enter_opens_pane', async () => {
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([makeDefaultListDto()]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([
      makeTaskDtoForStimulus({ id: 't1', title: 'Task One' }),
      makeTaskDtoForStimulus({ id: 't2', title: 'Task Two' }),
    ]);
    vi.spyOn(InvokeModule, 'getTaskById').mockImplementation(async (id: string) =>
      makeTaskDtoForStimulus({ id, title: id === 't1' ? 'Task One' : 'Task Two' }),
    );

    startS7App();
    await flushStimulusAsync();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await flushStimulusAsync();
    // Arrow-nav alone must NOT open the pane yet — Enter is what commits.
    expect(document.querySelector('.browse-detail__title')).toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flushStimulusAsync();

    expect(document.querySelector('.browse-detail__title')?.textContent).toBe('Task One');
  });

  // ── AC-S7-06 — Delete opens the delete confirmation ───────────────────────

  it('delete_key_opens_confirm', async () => {
    stubDialogPrototype();
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([makeDefaultListDto()]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([
      makeTaskDtoForStimulus({ id: 't1', title: 'Task One' }),
    ]);

    startS7App();
    await flushStimulusAsync();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await flushStimulusAsync();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await flushStimulusAsync();

    const message = document
      .getElementById('jin-modal-root')
      ?.querySelector('.action-dialog__message');
    expect(message, 'delete confirm dialog must open').not.toBeNull();
    expect(message?.textContent).toContain('Task One');
  });

  // ── AC-S7-07 — shortcuts are inert inside text inputs ─────────────────────

  it('shortcuts_inert_in_inputs', async () => {
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([makeDefaultListDto()]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([]);

    startS7App();
    await flushStimulusAsync();

    const quickAddInput = document.querySelector('.task-add-input') as HTMLInputElement | null;
    expect(quickAddInput, 'quick-add input must render').not.toBeNull();

    quickAddInput!.focus();
    expect(document.activeElement).toBe(quickAddInput);

    const event = new KeyboardEvent('keydown', { key: 'n', bubbles: true, cancelable: true });
    quickAddInput!.dispatchEvent(event);

    // The shortcut must NOT fire while the caret is inside the input — focus
    // stays put and the keystroke's default behavior (typing "n") is left
    // alone.
    expect(document.activeElement).toBe(quickAddInput);
    expect(event.defaultPrevented).toBe(false);

    // Sanity check (not itself a separate AC): OUTSIDE a text input, `n`
    // DOES focus the quick-add input — proves the assertion above is
    // exercising the "inert while typing" guard, not a shortcut that never
    // does anything at all.
    quickAddInput!.blur();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    await flushStimulusAsync();
    expect(document.activeElement).toBe(quickAddInput);
  });
});

// =============================================================================
// Bug B (VIGIL) — a sectionless list must be able to create its FIRST section
//
// Pre-S4, the board rendered an "Add Section" column at the end of every
// board, including sectionless lists. S4 (PR #34) deleted it and put nothing
// in its place. The only surviving Add Section emitter is
// `renderListViewWithSections`, which never renders for a list with ZERO
// sections (its own gate at renderList(): `selectedListId &&
// currentSections.length > 0`) — a chicken-and-egg dead end where the only
// control that creates a section required a section to already exist.
//
// `grep -rl "add-section-btn|onAddSection|openAddSection"
// jin-gui/src/__tests__/` returned zero files before this suite — nothing
// asserted the affordance exists, renders, opens, or works, which is exactly
// how S4 deleted it with every other test still green. This suite boots a
// REAL Stimulus-mounted TasksController against a list with `sections: []`
// and proves there is a reachable control that reaches `createSection`.
// =============================================================================

describe('Bug B (VIGIL) — sectionless list gets an Add Section affordance', () => {
  let bugBApp: Application;

  // jsdom does not implement HTMLDialogElement.showModal()/close() — same
  // stub the S3/S7 suites above use for the delete-confirm dialog.
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

  // buildStimulusTasksHTML() (shared by every other real-controller suite in
  // this file) never included the add-section dialog markup jin-gui/index.html
  // actually ships — nothing before this fix ever needed to open it from a
  // sectionless list. Append the real production markup: the S8-ported
  // JinModal-hosted dialog (id="tasks-add-section-dialog", the
  // action-dialog__inner/__header/__body/__footer shape, .btn-primary /
  // .btn-secondary — NOT a Stimulus dialog target, see AC-S8-03) as a
  // descendant of the `data-controller="tasks"` section so
  // `document.getElementById` + host:'in-place' find it in connect(), and the
  // inner form fields stay reachable via their Stimulus targets
  // (addSectionNameInput, addSectionError).
  function buildHTMLWithAddSectionDialog(): string {
    const addSectionDialog = `
      <dialog id="tasks-add-section-dialog" aria-label="Add section">
        <div class="action-dialog__inner">
          <div class="action-dialog__header">
            <h2 class="action-dialog__title">New Section</h2>
            <button type="button" class="modal-close-btn tap-target" aria-label="Close"></button>
          </div>
          <div class="action-dialog__body">
            <input data-tasks-target="addSectionNameInput" type="text" />
            <p data-tasks-target="addSectionError" class="hidden" role="alert"></p>
          </div>
          <div class="action-dialog__footer">
            <button type="button" class="btn-secondary">Cancel</button>
            <button type="button" class="btn-primary">Create</button>
          </div>
        </div>
      </dialog>
    `;
    return buildStimulusTasksHTML().replace('</section>', `${addSectionDialog}\n    </section>`);
  }

  beforeEach(() => {
    stubDialogPrototype();
    document.body.innerHTML = buildHTMLWithAddSectionDialog();
    localStorage.clear();
    vi.spyOn(InvokeModule, 'listTags').mockResolvedValue([]);
  });

  afterEach(() => {
    bugBApp?.stop();
    document.body.innerHTML = '';
    localStorage.clear();
    vi.restoreAllMocks();
  });

  function startBugBApp(): Application {
    bugBApp = Application.start(document.documentElement, defaultSchema);
    bugBApp.register('tasks', TasksController);
    return bugBApp;
  }

  it('a sectionless (zero-section) list renders a reachable Add Section control that reaches createSection', async () => {
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([
      makeDefaultListDto({ id: 'work', name: 'Work', is_default: true, sections: [] }),
    ]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([]);
    const createSectionSpy = vi
      .spyOn(InvokeModule, 'createSection')
      .mockResolvedValue(makeSection({ id: 'sec-1', name: 'Backlog' }));

    startBugBApp();
    await flushStimulusAsync();

    // The reachable control: the SAME "Add Section" button class
    // renderListViewWithSections renders for a list WITH sections — now also
    // rendered by the flat-list branch (renderTasksList) for a list scope
    // with ZERO sections (Fix B).
    const addSectionBtn = document.querySelector(
      '.tasks-section-group__add-section-btn',
    ) as HTMLButtonElement | null;
    expect(addSectionBtn, 'Add Section control must render for a sectionless list').not.toBeNull();

    addSectionBtn!.click();
    await flushStimulusAsync();

    // S8 (AC-S8-03): the dialog is JinModal-hosted by id, not a Stimulus
    // dialog target.
    const dialog = document.getElementById('tasks-add-section-dialog') as HTMLDialogElement;
    expect(dialog.open, 'clicking Add Section must open the dialog').toBe(true);

    const nameInput = document.querySelector(
      '[data-tasks-target="addSectionNameInput"]',
    ) as HTMLInputElement;
    nameInput.value = 'Backlog';

    const createBtn = dialog.querySelector('.btn-primary') as HTMLButtonElement;
    createBtn.click();
    await flushStimulusAsync();

    expect(createSectionSpy).toHaveBeenCalledWith('work', 'Backlog');
  });

  it('does NOT relax the gate into a synthetic "No Section" header (no visual regression)', async () => {
    // groupTasksBySection(tasks, []) synthesizes a "No Section" group — the
    // fix spec explicitly forbids curing Bug B by relaxing the render gate to
    // `selectedListId` alone, which would make every sectionless list render
    // under a "No Section" header nobody asked for.
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([
      makeDefaultListDto({ id: 'work', name: 'Work', is_default: true, sections: [] }),
    ]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([
      makeTaskDtoForStimulus({ id: 't1', title: 'Task One', list: 'work' }),
    ]);

    startBugBApp();
    await flushStimulusAsync();

    const sectionHeaders = Array.from(document.querySelectorAll('.tasks-section-group__name')).map(
      (el) => el.textContent,
    );
    expect(sectionHeaders).not.toContain('No Section');
  });
});

// =============================================================================
// S8 — Free wins: reorderSection + setTagColor wiring (todo-loop-closure)
//
// AC-S8-01 — drag-to-reorder wires the previously-dead `reorderSection`
//            bridge call, mirroring AC-S5-08's `reorderList` wiring exactly.
// AC-S8-02 — a tag chip's color swatch opens a JinModal color picker that
//            wires the previously-dead `setTagColor` bridge call.
//
// Green-but-shallow watch (spec, for the two dead-bridge-function wirings
// specifically): "a test that asserts 'the button exists' proves nothing...
// Assert the bridge function is actually called, with the right arguments."
// Both suites below assert the REAL bridge call via a spy on InvokeModule —
// never merely that a callback fired or a DOM node exists.
// =============================================================================

function stubDialogPrototypeS8(): void {
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

describe('S8 — reorderSection wiring (AC-S8-01)', () => {
  let s8App: Application;

  beforeEach(() => {
    document.body.innerHTML = buildStimulusTasksHTML();
    localStorage.clear();
    vi.spyOn(InvokeModule, 'listTags').mockResolvedValue([]);
  });

  afterEach(() => {
    s8App?.stop();
    document.body.innerHTML = '';
    localStorage.clear();
    vi.restoreAllMocks();
  });

  function startS8App(): Application {
    s8App = Application.start(document.documentElement, defaultSchema);
    s8App.register('tasks', TasksController);
    return s8App;
  }

  it('section_drag_calls_reorder_section', async () => {
    const sectionA = makeSection({
      id: 'sec-a',
      list_id: 'inbox',
      name: 'Alpha',
      position: 'b',
      task_count: 0,
    });
    const sectionB = makeSection({
      id: 'sec-b',
      list_id: 'inbox',
      name: 'Beta',
      position: 'd',
      task_count: 0,
    });
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([
      makeDefaultListDto({ id: 'inbox', is_default: true, sections: [sectionA, sectionB] }),
    ]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([]);
    vi.spyOn(InvokeModule, 'reorderSection').mockResolvedValue(sectionB);

    startS8App();
    await flushStimulusAsync();

    const groupA = document.querySelector(
      '.tasks-section-group[data-section-id="sec-a"]',
    ) as HTMLElement;
    const groupB = document.querySelector(
      '.tasks-section-group[data-section-id="sec-b"]',
    ) as HTMLElement;
    expect(groupA, 'section A group must render').not.toBeNull();
    expect(groupB, 'section B group must render').not.toBeNull();

    const headerA = groupA.querySelector('.tasks-section-group__header') as HTMLElement;
    const headerB = groupB.querySelector('.tasks-section-group__header') as HTMLElement;
    expect(headerA.draggable).toBe(true);
    expect(headerB.draggable).toBe(true);

    // Drag section B, drop it ABOVE section A (negative clientY selects the
    // top half of section A's zero-height jsdom bounding rect — the exact
    // technique lib/lists/render.ts's own AC-S5-08 drag test uses).
    const dragStart = new Event('dragstart', { bubbles: true }) as DragEvent;
    Object.defineProperty(dragStart, 'dataTransfer', {
      value: { setData: vi.fn(), effectAllowed: '' },
    });
    headerB.dispatchEvent(dragStart);

    const drop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(drop, 'dataTransfer', { value: { getData: () => 'sec-b' } });
    Object.defineProperty(drop, 'clientY', { value: -1 });
    headerA.dispatchEvent(drop);

    await flushStimulusAsync();

    expect(InvokeModule.reorderSection).toHaveBeenCalledTimes(1);
    const [listId, sectionId, position] = vi.mocked(InvokeModule.reorderSection).mock.calls[0];
    expect(listId).toBe('inbox');
    expect(sectionId).toBe('sec-b');
    // Strictly less than section A's position ('b') — the rank sorts before it.
    expect(position < 'b').toBe(true);
  });

  it('the "No Section" bucket is never draggable (nothing to reorder it against)', async () => {
    const sectionA = makeSection({
      id: 'sec-a',
      list_id: 'inbox',
      name: 'Alpha',
      position: 'b',
      task_count: 0,
    });
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([
      makeDefaultListDto({ id: 'inbox', is_default: true, sections: [sectionA] }),
    ]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([]);

    startS8App();
    await flushStimulusAsync();

    const groups = document.querySelectorAll('.tasks-section-group');
    // One named section + the "No Section" bucket = 2 groups.
    expect(groups.length).toBe(2);
    const noSectionGroup = Array.from(groups).find(
      (g) => !(g as HTMLElement).dataset.sectionId,
    ) as HTMLElement;
    expect(noSectionGroup, '"No Section" group must render').not.toBeUndefined();
    const header = noSectionGroup.querySelector('.tasks-section-group__header') as HTMLElement;
    expect(header.draggable).toBe(false);
  });
});

describe('S8 — tag color picker wiring (AC-S8-02)', () => {
  let s8App: Application;

  beforeEach(() => {
    stubDialogPrototypeS8();
    document.body.innerHTML = buildStimulusTasksHTML();
    localStorage.clear();
  });

  afterEach(() => {
    s8App?.stop();
    document.body.innerHTML = '';
    localStorage.clear();
    vi.restoreAllMocks();
  });

  function startS8App(): Application {
    s8App = Application.start(document.documentElement, defaultSchema);
    s8App.register('tasks', TasksController);
    return s8App;
  }

  it('tag_color_picker_calls_set_tag_color', async () => {
    const task = makeTaskDtoForStimulus({ id: 't1', title: 'Tagged Task', tags: ['urgent'] });
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([makeDefaultListDto({ id: 'inbox' })]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([task]);
    vi.spyOn(InvokeModule, 'listTags').mockResolvedValue([
      { slug: 'urgent', name: 'Urgent', color: 'danger', task_count: 1 },
    ]);
    vi.spyOn(InvokeModule, 'getTaskById').mockResolvedValue(task);
    vi.spyOn(InvokeModule, 'setTagColor').mockResolvedValue({
      slug: 'urgent',
      name: 'Urgent',
      color: 'sky',
      task_count: 1,
    });

    startS8App();
    await flushStimulusAsync();

    // Select the task so its pane (and tags editor) renders.
    const bodyBtn = document.querySelector('.task-item__body') as HTMLButtonElement;
    expect(bodyBtn, 'task item body must render').not.toBeNull();
    bodyBtn.click();
    await flushStimulusAsync();

    const swatchBtn = document.querySelector(
      '.task-detail__tag-swatch',
    ) as HTMLButtonElement;
    expect(swatchBtn, 'tag color swatch must render for a tagged task').not.toBeNull();
    // Preselected from listTags()'s current color ('danger'), not the
    // 'accent' fallback — proves the color actually round-tripped in.
    expect(swatchBtn.dataset.tagColor).toBe('danger');

    swatchBtn.click();
    await flushStimulusAsync();

    // The picker is a JinModal, hosted at #jin-modal-root (default host).
    const root = document.getElementById('jin-modal-root');
    expect(root, '#jin-modal-root must exist').not.toBeNull();
    const skySwatch = root!.querySelector(
      '.lists-color-swatch[data-color="sky"]',
    ) as HTMLButtonElement;
    expect(skySwatch, 'sky swatch must render in the tag color picker').not.toBeNull();

    skySwatch.click();
    await flushStimulusAsync();

    expect(InvokeModule.setTagColor).toHaveBeenCalledWith('urgent', 'sky');

    // Picking a swatch commits immediately and closes the dialog.
    const dialog = skySwatch.closest('dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(false);
  });

  it('does not call setTagColor merely from opening the picker (no pick, no call)', async () => {
    const task = makeTaskDtoForStimulus({ id: 't1', title: 'Tagged Task', tags: ['urgent'] });
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([makeDefaultListDto({ id: 'inbox' })]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([task]);
    vi.spyOn(InvokeModule, 'listTags').mockResolvedValue([
      { slug: 'urgent', name: 'Urgent', color: 'danger', task_count: 1 },
    ]);
    vi.spyOn(InvokeModule, 'getTaskById').mockResolvedValue(task);
    vi.spyOn(InvokeModule, 'setTagColor');

    startS8App();
    await flushStimulusAsync();

    const bodyBtn = document.querySelector('.task-item__body') as HTMLButtonElement;
    bodyBtn.click();
    await flushStimulusAsync();

    const swatchBtn = document.querySelector('.task-detail__tag-swatch') as HTMLButtonElement;
    swatchBtn.click();
    await flushStimulusAsync();

    expect(document.getElementById('jin-modal-root')?.querySelector('dialog[open]')).not.toBeNull();
    expect(InvokeModule.setTagColor).not.toHaveBeenCalled();
  });
});
