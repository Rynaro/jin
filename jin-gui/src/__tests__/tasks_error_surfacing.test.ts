// @vitest-environment jsdom
/**
 * tasks_error_surfacing.test.ts — S1 mutation chokepoint gate (Approach §8).
 *
 * Story S1 ("Honest controls, honest errors, honest view state") introduces
 * two wrappers on TasksController — `guarded()` and `mutate()` — so that no
 * bridge call in the tasks surface can fail silently, and every task mutation
 * dispatches `jin:tasks-changed` exactly once through one chokepoint rather
 * than N bespoke per-callback dispatches.
 *
 * AC-S1-05 — the detail priority save specifically surfaces app:error on
 *            rejection (the exact D10 defect: onSavePriority was a bare
 *            `await` with no catch at all).
 * AC-X-05  — any task/list bridge rejection surfaces via `app:error`, with no
 *            unhandled promise rejection escaping.
 * AC-X-08  — any of the six task-mutating bridge calls (createTask, editTask,
 *            setTaskStatus, moveTask, deleteTask, reseedPositions) dispatches
 *            `jin:tasks-changed` on success, via mutate() — never a bespoke
 *            per-callback dispatch.
 *
 * Mock strategy mirrors tasks_dnd_autoselect.test.ts: @tauri-apps/api/core is
 * mocked so invoke() never reaches the Tauri runtime; individual invoke.ts
 * exports are spied on per test.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Application, defaultSchema } from '@hotwired/stimulus';
import type { ListDto, TaskDto } from '../types/dto';
import type { JinErrorDto } from '../types/error';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));

vi.mock('../lib/icons', () => ({
  initIcons: vi.fn(),
}));

// Import AFTER mocks are established so the mock is active.
import TasksController from '../controllers/tasks_controller';
import * as InvokeModule from '../invoke';

// ── Fixture factories ─────────────────────────────────────────────────────────

function makeDefaultList(overrides: Partial<ListDto> = {}): ListDto {
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

function makeTaskDto(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: 'task-001',
    title: 'Test Task',
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

// ── Minimal DOM factory (mirrors tasks_dnd_autoselect.test.ts, + detail panel
//    wiring + view toggle + sort mode, needed by this file's scenarios) ──────

function buildTasksControllerHTML(): string {
  return `
    <section data-controller="tasks" data-action="jin:open-detail->tasks#openDetail">
      <div data-tasks-target="listPanel">
        <div data-tasks-target="loadingState" class="hidden" role="status"></div>
        <div data-tasks-target="emptyState" class="hidden"></div>
        <ul data-tasks-target="list" class="hidden browse-list" role="list"></ul>
        <select data-tasks-target="statusFilter" data-action="change->tasks#applyFilter">
          <option value="">All Statuses</option>
        </select>
        <select data-tasks-target="listFilter" data-action="change->tasks#applyFilter">
          <option value="">All Lists</option>
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
      <div data-tasks-target="detailPanel" class="hidden">
        <div data-tasks-target="detailLoadingState" class="hidden"></div>
        <div data-tasks-target="detailNotFoundState" class="hidden"></div>
        <div data-tasks-target="detailContent"></div>
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
          <button type="button" class="task-item__edit-btn tap-target" aria-label="Edit task">
            <i data-lucide="pencil" aria-hidden="true"></i>
          </button>
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

/** Wait for pending microtasks / promise resolutions to flush. */
async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// ── Internals cast — exercise the mutate()/guarded() chokepoint directly ────
//
// This suite's job is to prove the generic mutate()/guarded() plumbing (does
// each of the six AC-X-08 calls dispatch tasks-changed on success / app:error
// on rejection), not to re-test each individual UI trigger path — those have
// their own dedicated tests elsewhere (tasks_controller.test.ts,
// tasks_dnd_autoselect.test.ts, tasks_lists_modal_wiring.test.ts). Reaching
// into the real, Stimulus-mounted controller instance via a typed cast is a
// deliberate, narrow white-box technique for testing that shared mechanism.
type ControllerInternals = TasksController & {
  handleCreateTask: (title: string, due?: string) => Promise<void>;
  handleStatusToggle: (taskId: string, currentStatus: string) => Promise<void>;
  handleReschedule: (taskId: string, newDue: string) => Promise<void>;
  confirmDeleteTask: () => Promise<void>;
  handleDrop: (
    draggedId: string,
    sectionId: string | null,
    aboveId: string | null,
    belowId: string | null,
  ) => Promise<void>;
  pendingDeleteId: string | null;
  currentListId: string | null;
  currentTasks: TaskDto[];
  currentSortMode: string;
};

let app: Application;

beforeEach(() => {
  document.body.innerHTML = buildTasksControllerHTML();
  vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([makeDefaultList()]);
  vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([]);
  vi.spyOn(InvokeModule, 'listTags').mockResolvedValue([]);
});

afterEach(() => {
  app?.stop();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function startApp(): Application {
  app = Application.start(document.documentElement, defaultSchema);
  app.register('tasks', TasksController);
  return app;
}

function getController(): TasksController {
  const el = document.querySelector('[data-controller~="tasks"]') as HTMLElement;
  return app.getControllerForElementAndIdentifier(el, 'tasks') as TasksController;
}

function internals(): ControllerInternals {
  return getController() as unknown as ControllerInternals;
}

/** Capture every app:error dispatched during `action`, then remove the listener. */
async function captureErrors(action: () => Promise<void>): Promise<JinErrorDto[]> {
  const captured: JinErrorDto[] = [];
  const handler = (e: Event) => captured.push((e as CustomEvent<JinErrorDto>).detail);
  document.addEventListener('app:error', handler);
  await action();
  document.removeEventListener('app:error', handler);
  return captured;
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-S1-05 — the detail priority save specifically surfaces app:error
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-S1-05 — detail priority save rejection dispatches app:error', () => {
  it('priority_save_rejection_dispatches_app_error', async () => {
    const task = makeTaskDto({ id: 'task-pri', priority: 'low' });
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([task]);
    vi.spyOn(InvokeModule, 'getTaskById').mockResolvedValue(task);
    vi.spyOn(InvokeModule, 'editTask').mockRejectedValue({
      code: 2,
      kind: 'usage',
      message: 'bad priority',
      retriable: false,
    });

    startApp();
    await flushAsync();

    const section = document.querySelector('[data-controller~="tasks"]') as HTMLElement;

    const errors = await captureErrors(async () => {
      section.dispatchEvent(
        new CustomEvent('jin:open-detail', { detail: { id: 'task-pri' }, bubbles: false }),
      );
      await flushAsync();

      const sel = document.querySelector('.task-detail__priority-select') as HTMLSelectElement | null;
      expect(sel, 'priority select must be rendered by the detail pane').not.toBeNull();
      sel!.value = 'high';
      sel!.dispatchEvent(new Event('change', { bubbles: true }));
      await flushAsync();
    });

    // The bridge call was actually attempted (proves the wiring reached editTask)...
    expect(InvokeModule.editTask).toHaveBeenCalledWith('task-pri', { priority: 'high' });
    // ...and its rejection was NOT swallowed — it surfaced on app:error.
    expect(errors.length).toBe(1);
    expect(errors[0].message).toBe('bad priority');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-X-05 — every bridge rejection surfaces via app:error, none are swallowed
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-X-05 — every bridge callback surfaces its rejection', () => {
  it('every_bridge_callback_surfaces_rejection', async () => {
    const list = makeDefaultList({ id: 'inbox', is_default: true, sort_mode: 'manual' });
    const t1 = makeTaskDto({ id: 't1', position: 'V' });
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([list]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([t1]);
    vi.spyOn(InvokeModule, 'getTaskById').mockResolvedValue(t1);

    const rejection: JinErrorDto = { code: 1, kind: 'other', message: 'boom', retriable: false };
    vi.spyOn(InvokeModule, 'createTask').mockRejectedValue(rejection);
    vi.spyOn(InvokeModule, 'setTaskStatus').mockRejectedValue(rejection);
    vi.spyOn(InvokeModule, 'editTask').mockRejectedValue(rejection);
    vi.spyOn(InvokeModule, 'deleteTask').mockRejectedValue(rejection);
    vi.spyOn(InvokeModule, 'moveTask').mockRejectedValue(rejection);
    // A plain Error (NOT a JinErrorDto) — proves the synthetic-wrapping path
    // ("Non-JinErrorDto rejections are wrapped into a synthetic dto so the
    // toast still fires", Approach §8 / S1 action item 3).
    vi.spyOn(InvokeModule, 'editList').mockResolvedValue(list);
    vi.spyOn(InvokeModule, 'reseedPositions').mockRejectedValue(
      new Error('plain error, not a JinErrorDto'),
    );

    // Track unhandled promise rejections escaping the whole scenario —
    // AC-X-05's THEN clause requires "no unhandled promise rejection".
    const unhandled: unknown[] = [];
    const onUnhandled = (e: PromiseRejectionEvent) => unhandled.push(e.reason);
    window.addEventListener('unhandledrejection', onUnhandled);

    startApp();
    await flushAsync();

    const c = internals();

    const createErrs = await captureErrors(() => c.handleCreateTask('will fail'));
    expect(InvokeModule.createTask).toHaveBeenCalled();
    expect(createErrs.length).toBe(1);

    const statusErrs = await captureErrors(() => c.handleStatusToggle('t1', 'todo'));
    expect(InvokeModule.setTaskStatus).toHaveBeenCalled();
    expect(statusErrs.length).toBe(1);

    const rescheduleErrs = await captureErrors(() => c.handleReschedule('t1', '2026-08-01'));
    expect(InvokeModule.editTask).toHaveBeenCalled();
    expect(rescheduleErrs.length).toBe(1);

    c.pendingDeleteId = 't1';
    const deleteErrs = await captureErrors(() => c.confirmDeleteTask());
    expect(InvokeModule.deleteTask).toHaveBeenCalled();
    expect(deleteErrs.length).toBe(1);

    c.currentListId = 'inbox';
    c.currentSortMode = 'manual';
    c.currentTasks = [t1];
    const moveErrs = await captureErrors(() => c.handleDrop('t1', null, null, null));
    expect(InvokeModule.moveTask).toHaveBeenCalled();
    expect(moveErrs.length).toBe(1);

    // Force the reseed branch (sort_mode != 'manual') to exercise reseedPositions
    // specifically, with a non-JinErrorDto rejection — proves the synthetic
    // wrapping (Approach §8) rather than merely "some error fired".
    c.currentSortMode = 'priority';
    const reseedErrs = await captureErrors(() => c.handleDrop('t1', null, null, null));
    expect(InvokeModule.reseedPositions).toHaveBeenCalled();
    expect(reseedErrs.length).toBe(1);
    expect(reseedErrs[0].kind).toBe('other'); // synthetic — the real rejection was a plain Error
    expect(reseedErrs[0].message).toContain('plain error');

    window.removeEventListener('unhandledrejection', onUnhandled);
    expect(unhandled).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug A2 (VIGIL) — a STRING rejection (the real Tauri InvokeError shape) must
// keep its real message, not collapse into "<ctx> failed".
//
// The suite above already covers a plain `Error` rejection (line ~300-306) —
// that path (`err instanceof Error`) was NEVER broken. Tauri's actual
// `invoke()` rejects with a raw STRING for a bridge-level failure (e.g.
// Bug A's "missing field `icon`" at argument deserialization, before the
// command body ever runs) — `typeof err === 'string'` but
// `err instanceof Error` is false, which is exactly the branch the pre-fix
// `toSyntheticErrorDto` mishandled, discarding the real cause for a useless
// "<ctx> failed" toast. This is why Bug A presented as "nothing happens"
// instead of a message naming the actual problem.
// ─────────────────────────────────────────────────────────────────────────────

describe('Bug A2 (VIGIL) — a string InvokeError rejection keeps its real message', () => {
  it('a raw string rejection surfaces verbatim, not as "<ctx> failed"', async () => {
    const list = makeDefaultList({ id: 'inbox', is_default: true, sort_mode: 'manual' });
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([list]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([]);
    // The real Tauri InvokeError shape: a bare string, not an Error instance
    // and not a JinErrorDto.
    vi.spyOn(InvokeModule, 'createTask').mockRejectedValue('missing field `icon`');

    startApp();
    await flushAsync();

    const c = internals();
    const errs = await captureErrors(() => c.handleCreateTask('will fail'));

    expect(InvokeModule.createTask).toHaveBeenCalled();
    expect(errs.length).toBe(1);
    // The load-bearing assertion: the REAL rejection string, not the generic
    // ctx-derived fallback the pre-fix code always produced for this shape.
    expect(errs[0].message).toBe('missing field `icon`');
    expect(errs[0].message).not.toBe('handleCreateTask failed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-X-08 — every task-mutating call dispatches jin:tasks-changed on success
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-X-08 — every task mutation dispatches jin:tasks-changed exactly once', () => {
  it('every_task_mutation_dispatches_tasks_changed', async () => {
    const list = makeDefaultList({ id: 'inbox', is_default: true, sort_mode: 'manual' });
    const t1 = makeTaskDto({ id: 't1', position: 'V' });
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([list]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([t1]);
    vi.spyOn(InvokeModule, 'getTaskById').mockResolvedValue(t1);
    vi.spyOn(InvokeModule, 'createTask').mockResolvedValue(makeTaskDto({ id: 'new-1' }));
    vi.spyOn(InvokeModule, 'editTask').mockResolvedValue(t1);
    vi.spyOn(InvokeModule, 'setTaskStatus').mockResolvedValue(t1);
    vi.spyOn(InvokeModule, 'moveTask').mockResolvedValue(t1);
    vi.spyOn(InvokeModule, 'deleteTask').mockResolvedValue(t1);
    vi.spyOn(InvokeModule, 'reseedPositions').mockResolvedValue(undefined);
    vi.spyOn(InvokeModule, 'editList').mockResolvedValue(list);

    startApp();
    await flushAsync();

    const c = internals();

    let dispatchCount = 0;
    document.addEventListener('jin:tasks-changed', () => {
      dispatchCount += 1;
    });

    await c.handleCreateTask('New task via test');
    expect(InvokeModule.createTask).toHaveBeenCalled();
    expect(dispatchCount).toBe(1);

    await c.handleStatusToggle('t1', 'todo');
    expect(InvokeModule.setTaskStatus).toHaveBeenCalled();
    expect(dispatchCount).toBe(2);

    await c.handleReschedule('t1', '2026-08-01');
    expect(InvokeModule.editTask).toHaveBeenCalled();
    expect(dispatchCount).toBe(3);

    c.pendingDeleteId = 't1';
    await c.confirmDeleteTask();
    expect(InvokeModule.deleteTask).toHaveBeenCalled();
    expect(dispatchCount).toBe(4);

    c.currentListId = 'inbox';
    c.currentSortMode = 'manual';
    c.currentTasks = [t1];
    await c.handleDrop('t1', null, null, null);
    expect(InvokeModule.moveTask).toHaveBeenCalled();
    expect(dispatchCount).toBe(5);

    // Force the reseed branch (sort_mode != 'manual') to exercise reseedPositions
    // specifically — this single drop dispatches twice (reseedPositions, then
    // moveTask), both legitimate distinct mutations, not a batch.
    c.currentSortMode = 'priority';
    const beforeReseed = dispatchCount;
    await c.handleDrop('t1', null, null, null);
    expect(InvokeModule.reseedPositions).toHaveBeenCalled();
    expect(dispatchCount).toBeGreaterThan(beforeReseed);
  });

  it('a rejected mutation does NOT dispatch jin:tasks-changed', async () => {
    const list = makeDefaultList({ id: 'inbox', is_default: true, sort_mode: 'manual' });
    const t1 = makeTaskDto({ id: 't1', position: 'V' });
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([list]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([t1]);
    vi.spyOn(InvokeModule, 'setTaskStatus').mockRejectedValue({
      code: 2,
      kind: 'usage',
      message: 'illegal transition',
      retriable: false,
    });

    startApp();
    await flushAsync();

    const c = internals();
    let dispatchCount = 0;
    document.addEventListener('jin:tasks-changed', () => {
      dispatchCount += 1;
    });

    await c.handleStatusToggle('t1', 'todo');
    expect(InvokeModule.setTaskStatus).toHaveBeenCalled();
    expect(dispatchCount).toBe(0);
  });
});
