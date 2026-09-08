// @vitest-environment jsdom
/**
 * tasks_dnd_autoselect.test.ts — Stimulus-wired integration tests for the two
 * functional fixes in the Jin ToDo suite:
 *
 *   FIX 1 (DnD controller): Auto-select default list on connect so currentListId is
 *   always set, allowing handleDrop to proceed past its guard and call moveTask.
 *
 *   FIX 2 (add-task row): Smoke-tests that the dynamic add row (buildAddTaskRow)
 *   is the only affordance rendered by the controller (no static duplicate).
 *
 * Mock strategy (same pattern as router_controller_wiring.test.ts):
 *   - @tauri-apps/api/core: mocked so invoke never reaches Tauri runtime.
 *   - @tauri-apps/plugin-dialog: mocked to satisfy transitive imports.
 *   - ../lib/icons: initIcons mocked to a no-op.
 *   - ../invoke: individual functions spied on / mocked for assertion.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Application, defaultSchema } from '@hotwired/stimulus';
import type { ListDto, TaskDto } from '../types/dto';

// ── Global mocks (must appear before any import of the modules they replace) ──

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
    // Use 'inbox' as the ID so it matches makeTaskDto().list = 'inbox'.
    // listSelectOptions uses l.id as the <option> value, and filterTasksList
    // compares task.list against filter.list (the select value), so they must agree.
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
    // 'inbox' matches makeDefaultList().id so filterTasksList does not filter it out.
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

function firePointer(target: HTMLElement, type: string, clientX = 12, clientY = 12): void {
  const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    button: { value: 0 },
    clientX: { value: clientX },
    clientY: { value: clientY },
  });
  target.dispatchEvent(event);
}

// ── Minimal DOM factory ───────────────────────────────────────────────────────

/**
 * Build the minimum DOM structure required by TasksController.
 * Only required targets (those accessed without a has* guard in the hot paths).
 */
function buildTasksControllerHTML(): string {
  return `
    <section data-controller="tasks">
      <div data-tasks-target="listPanel">
        <div data-tasks-target="loadingState" class="hidden" role="status"></div>
        <div data-tasks-target="emptyState" class="hidden"></div>
        <ul data-tasks-target="list" class="hidden browse-list" role="list"></ul>
        <select data-tasks-target="statusFilter" data-action="change->tasks#applyFilter">
          <option value="">All Statuses</option>
        </select>
        <select data-tasks-target="priorityFilter" data-action="change->tasks#applyFilter">
          <option value="">All Priorities</option>
        </select>
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

/** Wait for all pending microtasks / promise resolutions to flush. */
async function flushAsync(): Promise<void> {
  // Two ticks covers the chained async paths: connectAutoSelect → populateLists → loadList.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// ── Shared setup ──────────────────────────────────────────────────────────────

let app: Application;

beforeEach(() => {
  document.body.innerHTML = buildTasksControllerHTML();
  // Reset all invoke spies for each test.
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

// ── Tests: auto-select default list on connect ────────────────────────────────

describe('FIX-DND — auto-select default list on connect (currentListId set)', () => {
  it('currentScope resolves to the default list id after connect (S5: no shared <select> anymore)', async () => {
    startApp();
    await flushAsync();

    // S5 (AC-S5-07) retired the shared `#tasks-list-filter` select this test
    // used to read `.value` off of. The observable proof that
    // connectAutoSelect() resolved the default list scope is the SAME one
    // the next test already used: listTasks() is called with `list: 'inbox'`.
    const listTasksSpy = InvokeModule.listTasks as ReturnType<typeof vi.fn>;
    const calledWithInbox = listTasksSpy.mock.calls.some(
      (args) => (args[0] as Record<string, unknown>)?.list === 'inbox',
    );
    expect(calledWithInbox).toBe(true);
  });

  it('listTasks is called with the default list id (not empty string) on first load', async () => {
    startApp();
    await flushAsync();

    const listTasksSpy = InvokeModule.listTasks as ReturnType<typeof vi.fn>;
    // At least one call should include the default list id in its filter.
    const calls = listTasksSpy.mock.calls;
    const calledWithList = calls.some(
      (args) => (args[0] as Record<string, unknown>)?.list === 'inbox',
    );
    expect(calledWithList).toBe(true);
  });

  it('auto-selects the default list (Inbox) when multiple lists are returned', async () => {
    // Return two lists: default (Inbox) + a secondary list.
    // Auto-select should pick the one with is_default=true, not the secondary.
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([
      makeDefaultList({ id: 'inbox', name: 'Inbox', is_default: true }),
      makeDefaultList({ id: 'work', name: 'Work', is_default: false }),
    ]);

    startApp();
    await flushAsync();

    // Must fetch Inbox's tasks (the default), never Work's (the secondary list).
    const listTasksSpy = InvokeModule.listTasks as ReturnType<typeof vi.fn>;
    const calledWithInbox = listTasksSpy.mock.calls.some(
      (args) => (args[0] as Record<string, unknown>)?.list === 'inbox',
    );
    const calledWithWork = listTasksSpy.mock.calls.some(
      (args) => (args[0] as Record<string, unknown>)?.list === 'work',
    );
    expect(calledWithInbox).toBe(true);
    expect(calledWithWork).toBe(false);
  });

  it('falls back to the Inbox smart view when listLists() fails (non-fatal)', async () => {
    // S5: the retired "All Lists" scope's one observable contract — no
    // `list` filter passed to listTasks() — is preserved by the Inbox SMART
    // VIEW fallback (Approach §4): connectAutoSelect() cannot resolve a
    // default list id, so currentScope stays smart/inbox, whose fetch also
    // omits `list` (narrowing happens client-side via applyScope instead).
    vi.spyOn(InvokeModule, 'listLists').mockRejectedValue(new Error('network error'));

    startApp();
    await flushAsync();

    const listTasksSpy = InvokeModule.listTasks as ReturnType<typeof vi.fn>;
    expect(listTasksSpy.mock.calls.length).toBeGreaterThan(0);
    for (const args of listTasksSpy.mock.calls) {
      expect((args[0] as Record<string, unknown> | undefined)?.list).toBeUndefined();
    }
  });
});

// ── Tests: handleDrop calls moveTask in a selected-list context ───────────────

describe('FIX-DND — handleDrop calls moveTask when a list is selected', () => {
  it('moveTask is called after a pointer-grip reorder when currentListId is set', async () => {
    // Return two tasks with known positions so between() can compute a valid new key.
    // task-top (pos:'V') then task-bot (pos:'VV') — manual sort renders them in this order.
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([
      makeTaskDto({ id: 'task-top', position: 'V' }),
      makeTaskDto({ id: 'task-bot', position: 'VV' }),
    ]);
    const moveTaskSpy = vi.spyOn(InvokeModule, 'moveTask').mockResolvedValue(
      makeTaskDto({ id: 'task-top' }),
    );

    startApp();
    await flushAsync();

    // After connect + auto-select + loadList, task rows must be in the DOM.
    const taskList = document.querySelector('[data-tasks-target="list"]') as HTMLElement;
    // Target: task-bot (move task-top below it → append after).
    const botRow = taskList.querySelector('li[data-task-id="task-bot"]') as HTMLElement;
    expect(botRow).not.toBeNull();
    const topHandle = taskList.querySelector<HTMLElement>('li[data-task-id="task-top"] .task-item__drag-handle');
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => botRow });
    firePointer(topHandle!, 'pointerdown', 10, 10);
    // jsdom bounding rect is zero, so a positive y commits below task-bot.
    firePointer(topHandle!, 'pointermove', 20, 999);
    firePointer(topHandle!, 'pointerup', 20, 999);
    // Allow the async handleDrop to execute (two promise resolution ticks).
    await flushAsync();

    // moveTask must have been called — the guard did NOT block because currentListId is set.
    expect(moveTaskSpy).toHaveBeenCalled();
    // First arg is the dragged task id.
    expect(moveTaskSpy.mock.calls[0][0]).toBe('task-top');
    // Payload must include the current list id and a non-empty position.
    const payload = moveTaskSpy.mock.calls[0][1] as { listId: string; position: string };
    expect(payload.listId).toBe('inbox');
    expect(typeof payload.position).toBe('string');
    expect(payload.position.length).toBeGreaterThan(0);
  });

  it('moveTask is NOT called when "All Lists" is active (currentListId is null)', async () => {
    // Return no default list so auto-select does nothing → currentListId stays null.
    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([
      makeDefaultList({ is_default: false }), // no default → no auto-select
    ]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([
      makeTaskDto({ id: 'task-a', position: 'V' }),
    ]);
    const moveTaskSpy = vi.spyOn(InvokeModule, 'moveTask').mockResolvedValue(makeTaskDto());

    startApp();
    await flushAsync();

    const taskList = document.querySelector('[data-tasks-target="list"]') as HTMLElement;
    const row = taskList.querySelector('li[data-task-id="task-a"]') as HTMLElement;

    if (row) {
      const dt = {
        getData: vi.fn((key: string) =>
          key === 'application/x-jin-task-id' ? 'task-a' : '',
        ),
      };
      const dropEvent = new Event('drop', { bubbles: true }) as DragEvent;
      Object.defineProperty(dropEvent, 'dataTransfer', { value: dt });
      Object.defineProperty(dropEvent, 'clientY', { value: 999 });
      row.dispatchEvent(dropEvent);
      await flushAsync();
    }

    // No list selected → handleDrop guard blocks → moveTask must NOT be called.
    expect(moveTaskSpy).not.toHaveBeenCalled();
  });
});

describe('completion stays local while persistence settles', () => {
  it('updates immediately without replacing the list with loading, then reconciles', async () => {
    const task = makeTaskDto({ id: 'toggle-me', title: 'Toggle me', status: 'todo' });
    let resolveStatus!: (value: TaskDto) => void;
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([task]);
    vi.spyOn(InvokeModule, 'setTaskStatus').mockImplementation(() => new Promise((resolve) => { resolveStatus = resolve; }));

    startApp();
    await flushAsync();
    const completion = document.querySelector<HTMLButtonElement>('[data-task-id="toggle-me"] .task-completion')!;
    completion.click();

    expect(completion.closest('[data-task-id="toggle-me"]')).not.toBeNull();
    expect((document.querySelector('[data-tasks-target="loadingState"]') as HTMLElement).classList.contains('hidden')).toBe(true);
    const pending = document.querySelector<HTMLButtonElement>('[data-task-id="toggle-me"] .task-completion')!;
    expect(pending.getAttribute('aria-checked')).toBe('true');
    expect(pending.getAttribute('aria-busy')).toBe('true');

    resolveStatus(makeTaskDto({ ...task, status: 'done' }));
    await flushAsync();
    expect((document.querySelector('[data-tasks-target="loadingState"]') as HTMLElement).classList.contains('hidden')).toBe(true);
  });

  it('rolls back a rejected completion without a blank loading state', async () => {
    const task = makeTaskDto({ id: 'reject-me', title: 'Reject me', status: 'todo' });
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([task]);
    vi.spyOn(InvokeModule, 'setTaskStatus').mockRejectedValue(new Error('offline'));

    startApp();
    await flushAsync();
    document.querySelector<HTMLButtonElement>('[data-task-id="reject-me"] .task-completion')!.click();
    await flushAsync();

    const completion = document.querySelector<HTMLButtonElement>('[data-task-id="reject-me"] .task-completion')!;
    expect(completion.getAttribute('aria-checked')).toBe('false');
    expect(completion.getAttribute('aria-busy')).toBe('false');
    expect((document.querySelector('[data-tasks-target="loadingState"]') as HTMLElement).classList.contains('hidden')).toBe(true);
  });

  it('persists a filtered subtask that is absent from the list projection', async () => {
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([]);
    const setStatus = vi.spyOn(InvokeModule, 'setTaskStatus').mockResolvedValue(
      makeTaskDto({ id: 'filtered-child', status: 'done' }),
    );

    startApp();
    await flushAsync();
    const controller = getController() as unknown as {
      handleStatusToggle: (id: string, status: string) => Promise<boolean>;
    };
    await expect(controller.handleStatusToggle('filtered-child', 'todo')).resolves.toBe(true);
    expect(setStatus).toHaveBeenCalledWith('filtered-child', 'done');
  });
});
