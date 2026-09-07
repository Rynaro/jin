// @vitest-environment jsdom
/**
 * tasks_lists_modal_wiring.test.ts — RISK-1 real-index wiring gate (S2/S3/S4).
 *
 * This is the acceptance test required by the SPECTRA todo-defect-fixes spec §8
 * (RISK-1). It loads the actual index.html, mounts the real Stimulus controllers,
 * and proves that the DT-2 fix works end-to-end — not just with hand-crafted HTML
 * fragments (which is exactly why DT-2 shipped undetected before).
 *
 * What it verifies:
 *   S2 — trash button opens a ConfirmDialog (not a dead Stimulus target)
 *   S2 — Confirm calls deleteTask; Cancel closes without calling deleteTask
 *   S3 — pen (edit) button opens the edit modal (relocated to modal root)
 *   S3 — due-date picker opens #jin-due-date-dialog via id-based access
 *   S3 — nested calendar data-controller is intact (not stripped by fromElement)
 *   S3 — capture regression: #jin-due-date-dialog still carries data-capture-target
 *   S4 — New List (+) opens the create-list dialog as a styled modal
 *   S4 — create/delete list dialogs have the complete action-dialog__* structure
 *
 * jsdom limitations:
 *   - showModal() / close() are not implemented: stubbed at prototype level.
 *   - initIcons() (Lucide) mutates SVG — mocked as a no-op.
 *   - All invoke() calls are vi.fn() mocks; no Tauri bridge in test environment.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Application, defaultSchema } from '@hotwired/stimulus';
import TasksController from '../controllers/tasks_controller';
import ListsController from '../controllers/lists_controller';
import CaptureController from '../controllers/capture_controller';
import CalendarController from '../controllers/calendar_controller';
import TemporalEditorController from '../controllers/temporal_editor_controller';
import type { TaskDto } from '../types/dto';
import type { ListDto } from '../types/dto';

// ── Mock all external dependencies ───────────────────────────────────────────

vi.mock('../invoke', () => ({
  listTasks: vi.fn(),
  listLists: vi.fn(),
  listTags: vi.fn(),
  deleteTask: vi.fn(),
  editTask: vi.fn(),
  createTask: vi.fn(),
  createList: vi.fn(),
  editList: vi.fn(),
  deleteList: vi.fn(),
  setTaskStatus: vi.fn(),
  getTaskById: vi.fn(),
  reseedPositions: vi.fn(),
  moveTask: vi.fn(),
  createSection: vi.fn(),
  renameSection: vi.fn(),
  deleteSection: vi.fn(),
  reorderSection: vi.fn(),
  setTagColor: vi.fn(),
  capture: vi.fn(),
  createNote: vi.fn(),
  createEvent: vi.fn(),
  todayAgenda: vi.fn(),
  listNotes: vi.fn(),
  getNoteById: vi.fn(),
  listFolders: vi.fn(),
  listEvents: vi.fn(),
  promoteTask: vi.fn(),
  attachNote: vi.fn(),
  linkObjects: vi.fn(),
  runSync: vi.fn(),
  authStatus: vi.fn(),
  appConfig: vi.fn(),
  getStoreRoot: vi.fn(),
  reorderList: vi.fn(),
}));

// Lucide mutates the DOM in ways jsdom doesn't support — no-op is sufficient.
vi.mock('../lib/icons', () => ({ initIcons: vi.fn() }));

import {
  listTasks,
  listLists,
  listTags,
  deleteTask,
  createTask,
  createSection,
  deleteSection,
  editList,
  editTask,
  getTaskById,
  createEvent,
} from '../invoke';

// ── Load real index.html body ─────────────────────────────────────────────────

const INDEX_HTML = readFileSync(resolve(process.cwd(), 'index.html'), 'utf-8');

function extractBodyInnerHTML(html: string): string {
  const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!match) throw new Error('Could not extract <body> from index.html');
  return match[1];
}

const BODY_CONTENT = extractBodyInnerHTML(INDEX_HTML);

// ── jsdom dialog prototype stubs ─────────────────────────────────────────────
//
// jsdom's HTMLDialogElement has the interface but does not implement showModal()
// or close() as callable methods. Stub them so dialog.open reflects state.
// Pattern from notes_controller.test.ts:1464-1477.

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

// ── Fixture factories ─────────────────────────────────────────────────────────

function makeList(overrides: Partial<ListDto> = {}): ListDto {
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
    task_count: 1,
    sections: [],
    ...overrides,
  };
}

function makeTask(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: 'task-001',
    title: 'Test Task',
    status: 'todo',
    priority: 'none',
    // Kept overdue so the real list row renders its independently operable
    // quick-reschedule buttons alongside the primary title action.
    due: '2026-06-01',
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

// ── Test suite ────────────────────────────────────────────────────────────────

describe('real-index modal wiring (RISK-1 gate)', () => {
  let app: Application;

  beforeEach(async () => {
    // Stub showModal / close before any Stimulus connect runs.
    stubDialogPrototype();

    // Reset DOM and mocks.
    document.body.innerHTML = '';

    // Set up default mock return values.
    vi.mocked(listLists).mockResolvedValue([makeList()]);
    vi.mocked(listTasks).mockResolvedValue([makeTask()]);
    vi.mocked(listTags).mockResolvedValue([]);
    vi.mocked(deleteTask).mockResolvedValue(undefined as unknown as import('../types/dto').TaskDto);
    // HOTFIX regression harness: getTaskById is the bridge call the edit path
    // now depends on (see 'S3: task edit modal — body regression' below).
    // Default mirrors the listTasks() row exactly (real get_task would return
    // the same task, just with the body populated).
    vi.mocked(getTaskById).mockResolvedValue(makeTask());

    // Inject the real body HTML so the full layout and all dialogs are present.
    document.body.innerHTML = BODY_CONTENT;

    // Start a genuine Stimulus Application and register all relevant controllers.
    app = Application.start(document.documentElement, defaultSchema);
    app.register('tasks', TasksController);
    app.register('lists', ListsController);
    app.register('capture', CaptureController);
    app.register('calendar', CalendarController);
    app.register('temporal-editor', TemporalEditorController);

    // Wait long enough for the async connect chains:
    //   tasks: connect → connectAutoSelect → populateLists (listLists) → loadList (listTasks)
    //   lists: connect → loadLists (listLists)
    await new Promise<void>((res) => setTimeout(res, 250));
  });

  afterEach(() => {
    app.stop();
    document.body.innerHTML = '';
    vi.resetAllMocks();
  });

  // ── S2: Task row trash button → ConfirmDialog ─────────────────────────────

  describe('S2: task delete ConfirmDialog', () => {
    it('trash button click opens a ConfirmDialog (dialog.open === true)', () => {
      // Task rows are rendered by renderTasksList after loadList resolves.
      const trashBtn = document.querySelector<HTMLButtonElement>('.task-item__delete-btn');
      expect(trashBtn).not.toBeNull();

      trashBtn!.click();

      // ConfirmDialog appends its <dialog> to #jin-modal-root.
      const root = document.getElementById('jin-modal-root');
      expect(root).not.toBeNull();
      const confirmDialog = root!.querySelector<HTMLDialogElement>('dialog.action-dialog');
      expect(confirmDialog).not.toBeNull();
      expect(confirmDialog!.open).toBe(true);
    });

    it('ConfirmDialog message contains the task title', () => {
      const trashBtn = document.querySelector<HTMLButtonElement>('.task-item__delete-btn');
      trashBtn!.click();

      // The message is inside the ConfirmDialog's body slot.
      const root = document.getElementById('jin-modal-root');
      const msg = root!.querySelector('.action-dialog__message');
      expect(msg).not.toBeNull();
      expect(msg!.textContent).toContain('Test Task');
      expect(msg!.textContent).toContain('This cannot be undone');
    });

    it('clicking Confirm (.btn-danger) calls deleteTask with the task id', async () => {
      const trashBtn = document.querySelector<HTMLButtonElement>('.task-item__delete-btn');
      trashBtn!.click();

      const root = document.getElementById('jin-modal-root');
      const confirmBtn = root!.querySelector<HTMLButtonElement>('.btn-danger');
      expect(confirmBtn).not.toBeNull();
      confirmBtn!.click();

      // deleteTask is async; give the promise time to resolve.
      await new Promise<void>((res) => setTimeout(res, 50));
      expect(vi.mocked(deleteTask)).toHaveBeenCalledWith('task-001');
    });

    it('clicking Cancel closes dialog WITHOUT calling deleteTask', async () => {
      const trashBtn = document.querySelector<HTMLButtonElement>('.task-item__delete-btn');
      trashBtn!.click();

      const root = document.getElementById('jin-modal-root');
      const cancelBtn = root!.querySelector<HTMLButtonElement>('.btn-secondary');
      expect(cancelBtn).not.toBeNull();
      cancelBtn!.click();

      await new Promise<void>((res) => setTimeout(res, 50));
      expect(vi.mocked(deleteTask)).not.toHaveBeenCalled();

      // Dialog must be closed.
      const confirmDialog = root!.querySelector<HTMLDialogElement>('dialog.action-dialog');
      expect(confirmDialog!.open).toBe(false);
    });
  });

  // ── S3: the row pen button + its title/body/due edit modal are RETIRED ───
  //
  // (AC-S3-04). Selecting a task item opens the ONE detail pane beside the
  // list instead (Approach §2) — see 'S3: detail pane' below.
  //
  // What happened to the D1 regression (owner-visible note, per the S3
  // report): the two tests that used to live here —
  //   "edit button loads the FULL task via getTaskById and seeds the editor
  //    from its body, not the row projection"
  //   "regression: renaming a task via the list-row pencil button does NOT
  //    erase its notes"
  // — exercised the NOW-DELETED pencil-button-to-modal path. They are
  // DELETED here, not "updated", because that mechanism no longer exists.
  // The regression they guarded is NOT dropped: it is RE-POINTED at the pane in
  // `tasks_controller.test.ts#renaming_from_pane_never_erases_notes_D1_regression`
  // (AC-S3-05), using the same discipline (list_tasks-shaped fixture with
  // `body: ''`, get_task returning the real notes, asserting the persisted
  // body is never overwritten with the empty projection).

  // ── S3: detail pane — selecting a task opens it beside the list ──────────

  describe('S3: detail pane', () => {
    it('title is the primary open control and never retargets to a due action', async () => {
      const bodyBtn = document.querySelector<HTMLButtonElement>('.task-item__body');
      const title = bodyBtn?.querySelector<HTMLElement>('.task-item__title');
      const dueBtn = document.querySelector<HTMLButtonElement>('.due-reschedule__btn');

      expect(bodyBtn).not.toBeNull();
      expect(title).not.toBeNull();
      expect(dueBtn, 'overdue fixture must render a separate due action').not.toBeNull();
      expect(bodyBtn!.contains(dueBtn)).toBe(false);
      expect(document.querySelector('.task-item button button')).toBeNull();

      title!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise<void>((res) => setTimeout(res, 50));

      expect(vi.mocked(getTaskById)).toHaveBeenCalledWith('task-001');
      expect(vi.mocked(editTask)).not.toHaveBeenCalled();
      expect(document.querySelector('.browse-detail__title')?.textContent).toBe('Test Task');
    });

    it('clicking a task item opens the detail pane (no page swap, no modal)', async () => {
      const bodyBtn = document.querySelector<HTMLButtonElement>('.task-item__body');
      expect(bodyBtn).not.toBeNull();

      bodyBtn!.click();
      await new Promise<void>((res) => setTimeout(res, 50));

      expect(vi.mocked(getTaskById)).toHaveBeenCalledWith('task-001');
      // The list stays in the DOM and unhidden (AC-S3-01) — there is no
      // page-swap `listPanel`/`detailPanel` hidden-toggle anymore.
      const listPanel = document.querySelector('[data-tasks-target="listPanel"]');
      expect(listPanel?.classList.contains('hidden')).toBe(false);
      const title = document.querySelector('.browse-detail__title');
      expect(title?.textContent).toBe('Test Task');
    });

    it('the pane exposes a Delete control the old page-swap detail never had', async () => {
      const bodyBtn = document.querySelector<HTMLButtonElement>('.task-item__body');
      bodyBtn!.click();
      await new Promise<void>((res) => setTimeout(res, 50));

      expect(document.querySelector('.tasks-detail-pane__delete-btn')).not.toBeNull();
    });
  });

  // ── S3: Due-date picker (id-based access) ────────────────────────────────

  describe('S3: due-date picker (id-based access, not Stimulus target)', () => {
    it('clicking the pane\'s due button opens #jin-due-date-dialog', async () => {
      // Open the pane first so its due button becomes clickable.
      const bodyBtn = document.querySelector<HTMLButtonElement>('.task-item__body');
      bodyBtn!.click();
      await new Promise<void>((res) => setTimeout(res, 50));

      // The pane's due button is built by renderTaskPane (lib/tasks/render.ts).
      const dueTrigger = document.querySelector<HTMLButtonElement>('.task-detail__due-btn');
      expect(dueTrigger).not.toBeNull();
      dueTrigger!.click();

      // The shared temporal editor is resolved by id, not a tasks target.
      const dueDialog = document.getElementById('jin-due-date-dialog') as HTMLDialogElement | null;
      expect(dueDialog).not.toBeNull();
      expect(dueDialog!.open).toBe(true);
    });

    it('nested calendar controller inside #jin-due-date-dialog is intact (not stripped)', () => {
      // fromElement was NOT called on this dialog (approach b), so data-action
      // attributes inside (calendar buttons) and the nested data-controller="calendar"
      // are all preserved.
      const calWidget = document.getElementById('jin-calendar-widget');
      expect(calWidget).not.toBeNull();
      expect(calWidget!.getAttribute('data-controller')).toBe('calendar');
    });

    it('uses the canonical action-dialog footer spacing', () => {
      const dueDialog = document.getElementById('jin-due-date-dialog');
      const footer = dueDialog?.querySelector('.action-dialog__footer');

      expect(footer).not.toBeNull();
      expect(footer?.classList.contains('form-actions')).toBe(false);
      expect(footer?.querySelector('#jin-due-date-cancel')).not.toBeNull();
      expect(footer?.querySelector('#jin-due-date-confirm')).not.toBeNull();
    });

    it('wires the shared natural-language row and a browser-neutral text clock', () => {
      const dueDialog = document.getElementById('jin-due-date-dialog')!;
      const natural = dueDialog.querySelector<HTMLInputElement>('#jin-due-natural')!;
      const time = dueDialog.querySelector<HTMLInputElement>('#jin-due-time')!;

      expect(natural.getAttribute('data-action')).toContain('temporal-editor#applyNatural');
      expect(dueDialog.querySelector('[data-temporal-editor-target="naturalPreview"]')).not.toBeNull();
      expect(time.type).toBe('text');
      expect(time.inputMode).toBe('numeric');
    });

    it('rehydrates a timed task, keeps selection draft-only, and persists after confirm', async () => {
      vi.mocked(getTaskById).mockResolvedValue(makeTask({
        due: '2026-06-01T14:30:00-10:00',
      }));
      const bodyBtn = document.querySelector<HTMLButtonElement>('.task-item__body');
      bodyBtn!.click();
      await new Promise<void>((res) => setTimeout(res, 50));

      document.querySelector<HTMLButtonElement>('.task-detail__due-btn')!.click();
      const dueDialog = document.getElementById('jin-due-date-dialog') as HTMLDialogElement;
      const time = dueDialog.querySelector<HTMLInputElement>('#jin-due-time')!;
      expect(time.value).toBe('14:30');

      dueDialog.querySelector<HTMLButtonElement>('[data-iso="2026-06-01"] button')!.click();
      expect(dueDialog.open).toBe(true);
      expect(editTask).not.toHaveBeenCalled();

      time.value = '16:20';
      time.dispatchEvent(new Event('input', { bubbles: true }));
      dueDialog.querySelector<HTMLButtonElement>('#jin-due-date-confirm')!.click();
      await new Promise<void>((res) => setTimeout(res, 0));

      expect(editTask).toHaveBeenCalledWith('task-001', {
        due: expect.stringContaining('2026-06-01T16:20:00'),
      });
    });

    it('maps an explicit calendar clear to edit_task clear_due', async () => {
      const bodyBtn = document.querySelector<HTMLButtonElement>('.task-item__body');
      bodyBtn!.click();
      await new Promise<void>((res) => setTimeout(res, 50));
      document.querySelector<HTMLButtonElement>('.task-detail__due-btn')!.click();

      const dueDialog = document.getElementById('jin-due-date-dialog') as HTMLDialogElement;
      dueDialog.querySelector<HTMLButtonElement>('.calendar-widget__clear-btn')!.click();
      expect(editTask).not.toHaveBeenCalled();
      dueDialog.querySelector<HTMLButtonElement>('#jin-due-date-confirm')!.click();
      await new Promise<void>((res) => setTimeout(res, 0));

      expect(editTask).toHaveBeenCalledWith('task-001', { clear_due: true });
    });
  });

  // ── S3: Capture regression ────────────────────────────────────────────────

  describe('S3: capture-regression — #jin-due-date-dialog still reachable by capture', () => {
    function captureController(): CaptureController {
      const host = document.querySelector<HTMLElement>('[data-controller~="capture"]')!;
      return app.getControllerForElementAndIdentifier(host, 'capture') as CaptureController;
    }

    it('#jin-due-date-dialog retains data-capture-target="dueDateDialog"', () => {
      // The capture controller finds the due-date dialog via data-capture-target.
      // We verify the attribute is still present after our changes.
      const dueDialog = document.getElementById('jin-due-date-dialog');
      expect(dueDialog).not.toBeNull();
      expect(dueDialog!.getAttribute('data-capture-target')).toBe('dueDateDialog');
    });

    it('data-tasks-target was removed from #jin-due-date-dialog (id-based now)', () => {
      // We removed data-tasks-target="dueDateDialog" since tasks now accesses by id.
      const dueDialog = document.getElementById('jin-due-date-dialog');
      expect(dueDialog!.getAttribute('data-tasks-target')).toBeNull();
    });

    it('captures date then time without closing until explicit confirmation', () => {
      const trigger = document.querySelector<HTMLButtonElement>('[data-capture-target="taskDueTrigger"]')!;
      trigger.click();
      const dueDialog = document.getElementById('jin-due-date-dialog') as HTMLDialogElement;
      expect(dueDialog.open).toBe(true);
      const dateButton = dueDialog.querySelector<HTMLButtonElement>('[data-iso] button')!;
      const selectedIso = (dateButton.closest('[data-iso]') as HTMLElement).dataset.iso!;
      dateButton.click();
      expect(dueDialog.open).toBe(true);

      const time = dueDialog.querySelector<HTMLInputElement>('#jin-due-time')!;
      time.value = '09:45';
      time.dispatchEvent(new Event('input', { bubbles: true }));
      dueDialog.querySelector<HTMLButtonElement>('#jin-due-date-confirm')!.click();
      expect(dueDialog.open).toBe(false);

      const dueValue = document.querySelector<HTMLInputElement>('[data-capture-target="taskDue"]')!.value;
      expect(dueValue).toContain(`${selectedIso}T09:45:00`);
    });

    it('resets both native and rendered select values after close/reopen', async () => {
      const controller = captureController();
      controller.open();
      controller.selectTask();
      const select = document.querySelector<HTMLSelectElement>('[data-capture-target="taskList"]')!;
      select.append(new Option('Work', 'work'));
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      const root = select.closest('.jin-select-field')!;
      const trigger = root.querySelector<HTMLButtonElement>('.jin-select-field__trigger')!;
      trigger.click();
      document.getElementById(trigger.getAttribute('aria-controls')!)!
        .querySelector<HTMLButtonElement>('[data-value="work"]')!.click();
      expect(select.value).toBe('work');
      controller.close();
      controller.open();
      controller.selectTask();
      expect(select.value).toBe('inbox');
      expect(root.querySelector('.jin-select-field__value')?.textContent).toContain('Inbox');
    });

    it('restores the initial routed Event destination visibly after close', async () => {
      const controller = captureController();
      const select = document.querySelector<HTMLSelectElement>('[data-capture-target="eventDestination"]')!;
      const google = new Option('Work · Team', 'account\u0000calendar');
      google.dataset.accountId = 'account';
      google.dataset.calendarId = 'calendar';
      select.append(google);
      select.value = google.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      const root = select.closest('.jin-select-field')!;
      const trigger = root.querySelector<HTMLButtonElement>('.jin-select-field__trigger')!;
      trigger.click();
      document.getElementById(trigger.getAttribute('aria-controls')!)!
        .querySelector<HTMLButtonElement>('[data-value="local"]')!.click();
      expect(select.value).toBe('local');
      controller.open();
      controller.close();
      expect(select.value).toBe(google.value);
      expect(root.querySelector('.jin-select-field__value')?.textContent).toBe('Work · Team');
    });

    it('guards rapid task submits so only one create reaches the bridge', async () => {
      let resolveCreate!: (task: TaskDto) => void;
      vi.mocked(createTask).mockImplementation(() => new Promise(resolve => { resolveCreate = resolve; }));
      const controller = captureController();
      controller.open();
      controller.selectTask();
      const list = document.querySelector<HTMLSelectElement>('[data-capture-target="taskList"]')!;
      list.append(new Option('Work', 'work'));
      list.value = 'work';
      list.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector<HTMLInputElement>('[data-capture-target="taskTitle"]')!.value = 'Only once';
      const first = controller.submitTask();
      const second = controller.submitTask();
      expect(createTask).toHaveBeenCalledTimes(1);
      resolveCreate(makeTask({ title: 'Only once' }));
      await Promise.all([first, second]);
      expect(list.value).toBe('inbox');
      expect(list.closest('.jin-select-field')?.querySelector('.jin-select-field__value')?.textContent).toContain('Inbox');
    });

    it('does not let an old successful create erase or navigate away from a reopened draft', async () => {
      let resolveCreate!: (task: TaskDto) => void;
      vi.mocked(createTask).mockImplementation(() => new Promise(resolve => { resolveCreate = resolve; }));
      const controller = captureController();
      const host = document.querySelector<HTMLElement>('[data-controller~="capture"]')!;
      const navigate = vi.fn();
      host.addEventListener('jin:navigate', navigate);

      controller.open();
      controller.selectTask();
      const modal = document.getElementById('jin-capture-modal') as HTMLDialogElement;
      const title = document.querySelector<HTMLInputElement>('[data-capture-target="taskTitle"]')!;
      title.value = 'Old request';
      const oldSubmit = controller.submitTask();

      controller.close();
      controller.open();
      controller.selectTask();
      title.value = 'New draft must survive';
      resolveCreate(makeTask({ title: 'Old request' }));
      await oldSubmit;

      expect(modal.open).toBe(true);
      expect(title.value).toBe('New draft must survive');
      expect(navigate).not.toHaveBeenCalled();
      expect(document.querySelector<HTMLButtonElement>('[data-capture-target="taskSubmit"]')!.disabled).toBe(false);
    });

    it('does not render an old failed create into a reopened session', async () => {
      let rejectCreate!: (error: unknown) => void;
      vi.mocked(createTask).mockImplementation(() => new Promise((_resolve, reject) => { rejectCreate = reject; }));
      const controller = captureController();
      controller.open();
      controller.selectTask();
      const title = document.querySelector<HTMLInputElement>('[data-capture-target="taskTitle"]')!;
      title.value = 'Old request';
      const oldSubmit = controller.submitTask();

      controller.close();
      controller.open();
      controller.selectTask();
      title.value = 'Clean new draft';
      rejectCreate(new Error('old failure'));
      await oldSubmit;

      const error = document.querySelector<HTMLElement>('[data-capture-target="taskError"]')!;
      expect(title.value).toBe('Clean new draft');
      expect(error.textContent).toBe('');
      expect(error.classList.contains('hidden')).toBe(true);
    });

    it('routes native dialog Escape cancellation through close and clears every draft', () => {
      const controller = captureController();
      controller.open();
      const modal = document.getElementById('jin-capture-modal') as HTMLDialogElement;
      const quick = document.querySelector<HTMLTextAreaElement>('[data-capture-target="captureText"]')!;
      quick.value = 'discard me';
      controller.selectTask();
      document.querySelector<HTMLInputElement>('[data-capture-target="taskTitle"]')!.value = 'discard task';
      const cancel = new Event('cancel', { cancelable: true });
      modal.dispatchEvent(cancel);
      expect(cancel.defaultPrevented).toBe(true);
      expect(modal.open).toBe(false);
      expect(quick.value).toBe('');
      expect(document.querySelector<HTMLInputElement>('[data-capture-target="taskTitle"]')!.value).toBe('');
      expect(document.querySelector<HTMLInputElement>('[data-capture-target="eventWhen"]')!.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('uses the shared temporal dialog for Event and commits an exclusive all-day range', async () => {
      vi.mocked(createEvent).mockResolvedValue({ id: 'event-all-day' } as never);
      const controller = captureController();
      controller.open();
      controller.selectEvent();
      const trigger = document.querySelector<HTMLButtonElement>('[data-capture-target="eventWhenTrigger"]')!;
      trigger.click();
      const dialog = document.getElementById('jin-due-date-dialog') as HTMLDialogElement;
      expect(dialog.open).toBe(true);
      expect(dialog.querySelector('[data-temporal-editor-target="title"]')?.textContent).toBe('When');
      expect(dialog.querySelector('[data-temporal-editor-target="confirm"]')?.textContent).toBe('Set When');

      dialog.dispatchEvent(new CustomEvent('calendar:selected', { bubbles: true, detail: { iso: '2026-10-14' } }));
      dialog.querySelector<HTMLButtonElement>('#jin-due-date-confirm')!.click();
      expect(document.activeElement).toBe(trigger);
      expect(document.querySelector<HTMLInputElement>('[data-capture-target="eventWhen"]')!.value).toBe('2026-10-14');

      document.querySelector<HTMLInputElement>('[data-capture-target="eventTitle"]')!.value = 'All-day event';
      await controller.submitEvent();
      expect(createEvent).toHaveBeenCalledWith(expect.objectContaining({
        start: '2026-10-14',
        end: '2026-10-15',
        is_all_day: true,
        tzid: undefined,
      }));
    });

    it('commits a local timed Event with a one-hour end and timezone', async () => {
      vi.mocked(createEvent).mockResolvedValue({ id: 'event-timed' } as never);
      const controller = captureController();
      controller.open();
      controller.selectEvent();
      document.querySelector<HTMLButtonElement>('[data-capture-target="eventWhenTrigger"]')!.click();
      const dialog = document.getElementById('jin-due-date-dialog') as HTMLDialogElement;
      const natural = dialog.querySelector<HTMLInputElement>('#jin-due-natural')!;
      natural.value = '2026-10-14 09:30';
      dialog.querySelector<HTMLButtonElement>('[data-temporal-editor-target="naturalUse"]')!.click();
      dialog.querySelector<HTMLButtonElement>('#jin-due-date-confirm')!.click();

      document.querySelector<HTMLInputElement>('[data-capture-target="eventTitle"]')!.value = 'Timed event';
      await controller.submitEvent();
      expect(createEvent).toHaveBeenCalledWith(expect.objectContaining({
        start: '2026-10-14T09:30',
        end: '2026-10-14T10:30',
        is_all_day: undefined,
        tzid: expect.any(String),
      }));
    });

    it('focuses and describes the visible Calendar combobox for an ambiguous destination', async () => {
      const controller = captureController();
      controller.open();
      controller.selectEvent();
      document.querySelector<HTMLInputElement>('[data-capture-target="eventTitle"]')!.value = 'Needs a calendar';
      const select = document.querySelector<HTMLSelectElement>('[data-capture-target="eventDestination"]')!;
      select.prepend(new Option('Choose a destination', '', true, true));
      select.value = '';
      await Promise.resolve();

      await controller.submitEvent();

      const trigger = select.closest('.jin-select-field')!
        .querySelector<HTMLButtonElement>('[role="combobox"]')!;
      expect(document.activeElement).toBe(trigger);
      expect(document.activeElement).not.toBe(select);
      expect(trigger.getAttribute('aria-required')).toBe('true');
      expect(trigger.getAttribute('aria-invalid')).toBe('true');
      expect(trigger.getAttribute('aria-describedby')?.split(' '))
        .toEqual(['capture-event-destination-help', 'capture-event-error']);
      const error = document.getElementById('capture-event-error')!;
      expect(error.classList.contains('hidden')).toBe(false);
      expect(error.textContent).toContain('Choose an exact account and calendar');

      trigger.click();
      document.getElementById(trigger.getAttribute('aria-controls')!)!
        .querySelector<HTMLButtonElement>('[data-value="local"]')!.click();
      expect(trigger.hasAttribute('aria-invalid')).toBe(false);
      expect(trigger.getAttribute('aria-describedby')).toBe('capture-event-destination-help');
      expect(error.classList.contains('hidden')).toBe(true);
      expect(error.textContent).toBe('');
    });
  });

  // ── S4: New List (+) button → create-list modal ───────────────────────────

  describe('S4: lists create/edit/delete modal structure', () => {
    it('New List (+) button opens the create-list dialog', () => {
      const newListBtn = document.querySelector<HTMLButtonElement>(
        '[data-action="click->lists#openCreate"]',
      );
      expect(newListBtn).not.toBeNull();

      newListBtn!.click();

      const createDialog = document.querySelector<HTMLDialogElement>(
        '[data-lists-target="createDialog"]',
      ) as HTMLDialogElement | null;
      expect(createDialog).not.toBeNull();
      expect(createDialog!.open).toBe(true);
    });

    it('create-list dialog has complete action-dialog__inner structure', () => {
      const createDialog = document.querySelector<HTMLDialogElement>(
        '[data-lists-target="createDialog"]',
      ) as HTMLElement;
      expect(createDialog.querySelector('.action-dialog__inner')).not.toBeNull();
      expect(createDialog.querySelector('.action-dialog__header')).not.toBeNull();
      expect(createDialog.querySelector('.action-dialog__title')).not.toBeNull();
      expect(createDialog.querySelector('.action-dialog__body')).not.toBeNull();
      expect(createDialog.querySelector('.action-dialog__footer')).not.toBeNull();
      expect(createDialog.querySelector('.modal-close-btn')).not.toBeNull();
    });

    it('edit-list dialog has complete action-dialog__inner structure', () => {
      const editDialog = document.querySelector<HTMLElement>(
        '[data-lists-target="editDialog"]',
      ) as HTMLElement;
      expect(editDialog.querySelector('.action-dialog__inner')).not.toBeNull();
      expect(editDialog.querySelector('.action-dialog__header')).not.toBeNull();
      expect(editDialog.querySelector('.action-dialog__body')).not.toBeNull();
      expect(editDialog.querySelector('.action-dialog__footer')).not.toBeNull();
    });

    it('delete-list dialog has action-dialog__message and complete structure', () => {
      const deleteDialog = document.querySelector<HTMLElement>(
        '[data-lists-target="deleteDialog"]',
      ) as HTMLElement;
      expect(deleteDialog.querySelector('.action-dialog__inner')).not.toBeNull();
      expect(deleteDialog.querySelector('.action-dialog__body')).not.toBeNull();
      expect(deleteDialog.querySelector('.action-dialog__message')).not.toBeNull();
      expect(deleteDialog.querySelector('.action-dialog__footer')).not.toBeNull();
      expect(deleteDialog.querySelector('.btn-danger')).not.toBeNull();
    });

    it('create-list Cancel button closes the dialog', () => {
      const newListBtn = document.querySelector<HTMLButtonElement>(
        '[data-action="click->lists#openCreate"]',
      );
      newListBtn!.click();

      const createDialog = document.querySelector<HTMLDialogElement>(
        '[data-lists-target="createDialog"]',
      ) as HTMLDialogElement;
      expect(createDialog.open).toBe(true);

      // JinModal.fromElement wired .btn-secondary to onSecondary → closeCreate
      const cancelBtn = createDialog.querySelector<HTMLButtonElement>('.btn-secondary');
      expect(cancelBtn).not.toBeNull();
      cancelBtn!.click();

      expect(createDialog.open).toBe(false);
    });
  });
});

// =============================================================================
// S6: controller-level canonicalization (real-index wiring, id≠name fixtures)
//
// These tests use the real index.html + live Stimulus app (same infra as above)
// and verify TWO writers that must persist a list id, never a display name:
//   • in-list create writer (handleCreateTask → createTask({list: currentListId}))
//   • capture task writer (submitTask reads the id-valued <select>)
//
// Each test adds the 'proj-1' option to the relevant select manually — this
// simulates what populateLists / populateCaptureListSelects does with a real
// backend, while remaining deterministic in jsdom.
// =============================================================================

describe('S6: list id≠name writers (controller-level wiring)', () => {
  let app: Application;

  beforeEach(async () => {
    stubDialogPrototype();
    document.body.innerHTML = '';

    // S5: 'proj-1' is a REAL second list from the start, so the rail (not a
    // retired <select>) has a real row to click.
    vi.mocked(listLists).mockResolvedValue([
      makeList(),
      makeList({ id: 'proj-1', name: 'Project One', is_default: false, position: 'B' }),
    ]);
    vi.mocked(listTasks).mockResolvedValue([]);
    vi.mocked(listTags).mockResolvedValue([]);
    vi.mocked(createTask).mockResolvedValue(makeTask({ id: 'new-task-s6', list: 'proj-1' }));

    document.body.innerHTML = BODY_CONTENT;

    app = Application.start(document.documentElement, defaultSchema);
    app.register('tasks', TasksController);
    app.register('lists', ListsController);
    app.register('capture', CaptureController);
    app.register('calendar', CalendarController);

    // Wait for the async connect chain to complete.
    await new Promise<void>((res) => setTimeout(res, 250));
  });

  afterEach(() => {
    app.stop();
    document.body.innerHTML = '';
    vi.resetAllMocks();
  });

  // ── In-list create writer ─────────────────────────────────────────────────

  it('handleCreateTask: createTask receives list=currentListId (the id), not inbox or empty', async () => {
    // S5: scope switching is the rail's job now (AC-S5-07 retired the shared
    // list-filter <select>) — click "Project One"'s real row, which
    // dispatches jin:scope-changed → TasksController#setScope → loadList
    // with list: 'proj-1'.
    const projRow = document.querySelector<HTMLButtonElement>(
      '.lists-rail__row-btn[data-list-id="proj-1"]',
    );
    expect(projRow).not.toBeNull();
    projRow!.click();

    // Wait for loadList to set currentListId and render the task list.
    await new Promise<void>((res) => setTimeout(res, 150));

    // The add-task row is always rendered when onCreateTask is wired.
    const addInput = document.querySelector<HTMLInputElement>('.task-add-input');
    expect(addInput).not.toBeNull();

    // Simulate the user typing a title and pressing Enter.
    addInput!.value = 'New task in Project One';
    addInput!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await new Promise<void>((res) => setTimeout(res, 100));

    // createTask MUST have been called with list='proj-1' (the id, never a display name).
    expect(vi.mocked(createTask)).toHaveBeenCalled();
    const callArg = vi.mocked(createTask).mock.calls[0]?.[0];
    expect(callArg).toBeDefined();
    expect(callArg?.list).toBe('proj-1');
    // Prove the old bug is gone: before S6, list was undefined (defaulting to inbox).
    expect(callArg?.list).not.toBeUndefined();
    expect(callArg?.list).not.toBe('');
  });

  // ── Capture task writer ───────────────────────────────────────────────────

  it('capture submitTask: createTask receives list id from the select value, never a display name', async () => {
    // Inject 'proj-1' into the task-list select in the capture form.
    // populateCaptureListSelects would do this with real API; we simulate it here.
    const taskListSel = document.querySelector<HTMLSelectElement>('#task-list');
    expect(taskListSel).not.toBeNull();
    const opt = document.createElement('option');
    opt.value = 'proj-1';
    opt.textContent = 'Project One';
    taskListSel!.appendChild(opt);
    // Simulate user selecting 'proj-1' from the list.
    taskListSel!.value = 'proj-1';

    // Fill in the task title (required field).
    const titleInput = document.querySelector<HTMLInputElement>('#task-title');
    expect(titleInput).not.toBeNull();
    titleInput!.value = 'Captured task in Project One';

    // Submit via the task create button.
    const submitBtn = document.querySelector<HTMLButtonElement>(
      '[data-action="click->capture#submitTask"]',
    );
    expect(submitBtn).not.toBeNull();
    submitBtn!.click();

    await new Promise<void>((res) => setTimeout(res, 100));

    expect(vi.mocked(createTask)).toHaveBeenCalled();
    const callArg = vi.mocked(createTask).mock.calls[0]?.[0];
    expect(callArg).toBeDefined();
    // The id must be passed — never the display name or empty string.
    expect(callArg?.list).toBe('proj-1');
    expect(callArg?.list).not.toBe('Project One');
    expect(callArg?.list).not.toBe('');
    expect(callArg?.list).not.toBeUndefined();
  });

  it('capture submitTask with Inbox selected: persists "inbox" (the id, lowercase)', async () => {
    // The default option in #task-list is <option value="inbox">Inbox</option>.
    // The select value is already 'inbox' after populateCaptureListSelects ran.
    const taskListSel = document.querySelector<HTMLSelectElement>('#task-list');
    expect(taskListSel).not.toBeNull();
    // Value should already be 'inbox' (the id).
    expect(taskListSel!.value).toBe('inbox');

    const titleInput = document.querySelector<HTMLInputElement>('#task-title');
    expect(titleInput).not.toBeNull();
    titleInput!.value = 'Inbox task via capture';

    const submitBtn = document.querySelector<HTMLButtonElement>(
      '[data-action="click->capture#submitTask"]',
    );
    submitBtn!.click();
    await new Promise<void>((res) => setTimeout(res, 100));

    expect(vi.mocked(createTask)).toHaveBeenCalled();
    const callArg = vi.mocked(createTask).mock.calls[0]?.[0];
    // Must be the Inbox id, NOT 'Inbox' (capitalized name) and NOT ''.
    expect(callArg?.list).toBe('inbox');
    expect(callArg?.list).not.toBe('Inbox');
    expect(callArg?.list).not.toBe('');
  });
});

// =============================================================================
// DT-4: Real controller gate test — board view for sectionless list
//
// This is the RISK-1-class guard for the DT-4 fix. The renderer-level tests in
// tasks_controller.test.ts call renderBoardView() directly and re-implement the
// gate logic inside the tests — they pass on the pre-fix code because they never
// touch the real controller gate in loadList().
//
// THIS test drives the full real path:
//   viewToggle click → toggleView() → currentView='board' (S1: localStorage,
//   NEVER editList — AC-S1-07) → loadList() → GATE CHECK → renderBoardView
//
// Reverting the gate to the pre-fix form:
//   `if (selectedListId && this.currentSections.length > 0 && this.currentView === 'board')`
// causes this test to FAIL (sections.length=0, so the gate is false → flat list rendered,
// no .tasks-board → expect(...).not.toBeNull() throws).
//
// S1 update (Approach §5): view is now a GLOBAL localStorage preference, not a
// per-list `ListDto.view` field — toggleView() no longer calls editList at all.
// listLists() therefore returns the SAME list object on every call (its `view`
// field is still present on the DTO for core-model parity but has no GUI
// consumer); the gate is driven purely by the controller's in-memory
// currentView, loaded from localStorage.
// =============================================================================

describe('DT-4: board view gate — sectionless list (real controller)', () => {
  let app: Application;

  beforeEach(async () => {
    stubDialogPrototype();
    document.body.innerHTML = '';
    localStorage.clear();

    // Sectionless Inbox. `view` never changes across this test (S1: unused by GUI).
    const inboxList = makeList({ id: 'inbox', sections: [], view: 'list' });

    vi.mocked(listLists).mockResolvedValue([inboxList]);
    vi.mocked(listTasks).mockResolvedValue([makeTask({ id: 'inbox-t1', title: 'Inbox Task DT4' })]);
    vi.mocked(listTags).mockResolvedValue([]);

    document.body.innerHTML = BODY_CONTENT;
    app = Application.start(document.documentElement, defaultSchema);
    app.register('tasks', TasksController);
    app.register('lists', ListsController);
    app.register('capture', CaptureController);
    app.register('calendar', CalendarController);

    // Wait for connect → connectAutoSelect → populateLists → loadList to settle.
    await new Promise<void>((res) => setTimeout(res, 250));
  });

  afterEach(() => {
    app.stop();
    document.body.innerHTML = '';
    localStorage.clear();
    vi.resetAllMocks();
  });

  it('DT-4: view-toggle on sectionless list renders .tasks-board via the real controller gate', async () => {
    // Precondition: initial render is flat list view, no board present.
    expect(document.querySelector('.tasks-board')).toBeNull();

    // The view-toggle button is the real markup element in index.html.
    const toggleBtn = document.querySelector<HTMLButtonElement>(
      '[data-action="click->tasks#setView"][data-view="board"]',
    );
    expect(toggleBtn).not.toBeNull();
    // Inbox is auto-selected as the default list on connect, so the toggle is enabled.
    expect(toggleBtn!.disabled).toBe(false);

    // Click → setView() → currentView='board' (localStorage
    // write, no bridge call) → loadList() → gate → renderBoardView()
    toggleBtn!.click();

    // Wait for the loadList() re-render (no editList round-trip in S1).
    await new Promise<void>((res) => setTimeout(res, 150));

    // S1 (AC-S1-07): the toggle must never call editList with a view key —
    // it must not be called at all here, since view no longer round-trips
    // through the bridge.
    expect(vi.mocked(editList)).not.toHaveBeenCalled();

    // Gate must have routed to renderBoardView → .tasks-board is in the DOM.
    //
    // PRE-FIX gate:  `if (selectedListId && sections.length > 0 && view==='board')`
    //   → sections.length===0 → condition false → renderTasksList → no .tasks-board
    //   → this assertion FAILS → test FAILS (guards the fix)
    //
    // POST-FIX gate: `if (selectedListId && view==='board')`
    //   → condition true → renderBoardView → .tasks-board present
    //   → this assertion PASSES
    //
    // S4 update: the board is now Kanban BY STATUS (Approach §3), not
    // section — it no longer synthesises a "No Section" column at all.
    // Every board render, sectionless list or not, gets the SAME three
    // fixed status columns (AC-S4-01).
    const board = document.querySelector('.tasks-board');
    expect(board).not.toBeNull();

    const cols = document.querySelectorAll('.tasks-board__column');
    expect(cols.length).toBe(3);

    // The task from the sectionless list appears in its status column
    // (default status 'todo').
    expect(board!.querySelector('[data-column-status="todo"]')!.textContent).toContain('Inbox Task DT4');
  });

  it('exposes explicit pressed view choices and an active-filter count', async () => {
    const listBtn = document.querySelector<HTMLButtonElement>('[data-view="list"]')!;
    const boardBtn = document.querySelector<HTMLButtonElement>('[data-view="board"]')!;
    expect(listBtn.getAttribute('aria-pressed')).toBe('true');
    expect(boardBtn.getAttribute('aria-pressed')).toBe('false');

    boardBtn.click();
    await new Promise<void>((res) => setTimeout(res, 100));
    expect(listBtn.getAttribute('aria-pressed')).toBe('false');
    expect(boardBtn.getAttribute('aria-pressed')).toBe('true');

    const status = document.querySelector<HTMLSelectElement>('#tasks-status-filter')!;
    status.value = 'todo';
    status.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise<void>((res) => setTimeout(res, 50));
    expect(document.querySelector('[data-tasks-target="filterCount"]')?.textContent).toBe('1');
  });

  it('collapses filters while the inspector is open and Escape returns focus to disclosure', async () => {
    document.querySelector<HTMLButtonElement>('.task-item__body')!.click();
    await new Promise<void>((res) => setTimeout(res, 50));

    const disclosure = document.querySelector<HTMLButtonElement>('[data-tasks-target="filtersToggleBtn"]')!;
    const panel = document.querySelector<HTMLElement>('[data-tasks-target="filtersPanel"]')!;
    expect(panel.hidden).toBe(true);

    disclosure.click();
    expect(panel.hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(disclosure);
  });
});

// =============================================================================
// S8: section create/delete dialogs are JinModal-hosted (AC-S8-03)
//
// The two dialogs (#tasks-add-section-dialog / #tasks-delete-section-dialog)
// are ported from a raw <dialog> + Stimulus dialog target (DT-2's subtree-
// scoping foot-gun) to JinModal, host:'in-place' — the same normalization the
// S4 list dialogs above already got. This is the FUNCTIONAL half; the
// grep-gate half (`rg -n "addSectionDialog|deleteSectionDialog" index.html
// src/controllers/tasks_controller.ts | rg -v ':\s*(\*|//|/\*)'` returns no
// match) is checked directly against the source tree — see the
// acceptance_checks.json CONSTRAINT for AC-S8-03.
// =============================================================================

describe('S8: section dialogs are JinModal-hosted (AC-S8-03)', () => {
  let app: Application;

  beforeEach(async () => {
    stubDialogPrototype();
    document.body.innerHTML = '';

    vi.mocked(listLists).mockResolvedValue([
      makeList({
        sections: [
          { id: 'sec-1', list_id: 'inbox', name: 'Backlog', position: 'a', task_count: 0 },
        ],
      }),
    ]);
    vi.mocked(listTasks).mockResolvedValue([]);
    vi.mocked(listTags).mockResolvedValue([]);
    vi.mocked(createSection).mockResolvedValue({
      id: 'sec-new',
      list_id: 'inbox',
      name: 'New Section',
      position: 'z',
      task_count: 0,
    });
    vi.mocked(deleteSection).mockResolvedValue(undefined);

    document.body.innerHTML = BODY_CONTENT;
    app = Application.start(document.documentElement, defaultSchema);
    app.register('tasks', TasksController);
    app.register('lists', ListsController);
    app.register('capture', CaptureController);
    app.register('calendar', CalendarController);

    await new Promise<void>((res) => setTimeout(res, 250));
  });

  afterEach(() => {
    app.stop();
    document.body.innerHTML = '';
    vi.resetAllMocks();
  });

  // ── Defense-in-depth alongside the grep gate (AC-S8-03) ───────────────────

  it('no dangling data-tasks-target for the retired dialog targets remains in the mounted DOM', () => {
    expect(document.querySelector('[data-tasks-target="addSectionDialog"]')).toBeNull();
    expect(document.querySelector('[data-tasks-target="deleteSectionDialog"]')).toBeNull();
  });

  // ── Add section dialog ─────────────────────────────────────────────────────

  it('Add Section button opens a JinModal with the complete action-dialog structure', () => {
    const addBtn = document.querySelector<HTMLButtonElement>(
      '.tasks-section-group__add-section-btn',
    );
    expect(addBtn, 'Add Section button must render (list has >=1 section)').not.toBeNull();

    addBtn!.click();

    const dialog = document.getElementById('tasks-add-section-dialog') as HTMLDialogElement;
    expect(dialog).not.toBeNull();
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('.action-dialog__inner')).not.toBeNull();
    expect(dialog.querySelector('.action-dialog__header')).not.toBeNull();
    expect(dialog.querySelector('.action-dialog__body')).not.toBeNull();
    expect(dialog.querySelector('.action-dialog__footer')).not.toBeNull();
    expect(dialog.querySelector('.modal-close-btn')).not.toBeNull();
  });

  it('Create (.btn-primary) calls createSection with the list id and name, then closes', async () => {
    const addBtn = document.querySelector<HTMLButtonElement>(
      '.tasks-section-group__add-section-btn',
    );
    addBtn!.click();

    const dialog = document.getElementById('tasks-add-section-dialog') as HTMLDialogElement;
    const nameInput = dialog.querySelector<HTMLInputElement>(
      '[data-tasks-target="addSectionNameInput"]',
    );
    expect(nameInput, 'name input must stay reachable as a Stimulus target').not.toBeNull();
    nameInput!.value = 'Groceries';

    const createBtn = dialog.querySelector<HTMLButtonElement>('.btn-primary');
    expect(createBtn).not.toBeNull();
    createBtn!.click();

    await new Promise<void>((res) => setTimeout(res, 50));

    expect(vi.mocked(createSection)).toHaveBeenCalledWith('inbox', 'Groceries');
    expect(dialog.open).toBe(false);
  });

  it('Cancel closes the add-section dialog WITHOUT calling createSection', () => {
    const addBtn = document.querySelector<HTMLButtonElement>(
      '.tasks-section-group__add-section-btn',
    );
    addBtn!.click();

    const dialog = document.getElementById('tasks-add-section-dialog') as HTMLDialogElement;
    const cancelBtn = dialog.querySelector<HTMLButtonElement>('.btn-secondary');
    expect(cancelBtn).not.toBeNull();
    cancelBtn!.click();

    expect(dialog.open).toBe(false);
    expect(vi.mocked(createSection)).not.toHaveBeenCalled();
  });

  // ── Delete section dialog ──────────────────────────────────────────────────

  it('section delete button opens the JinModal-hosted delete-confirm dialog', () => {
    const deleteBtn = document.querySelector<HTMLButtonElement>(
      '.tasks-section-group__delete-btn',
    );
    expect(deleteBtn, 'section delete button must render for a named section').not.toBeNull();

    deleteBtn!.click();

    const dialog = document.getElementById('tasks-delete-section-dialog') as HTMLDialogElement;
    expect(dialog).not.toBeNull();
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('.action-dialog__message')?.textContent).toContain('Backlog');
  });

  it('Delete (.btn-danger) calls deleteSection with the list and section ids', async () => {
    const deleteBtn = document.querySelector<HTMLButtonElement>(
      '.tasks-section-group__delete-btn',
    );
    deleteBtn!.click();

    const dialog = document.getElementById('tasks-delete-section-dialog') as HTMLDialogElement;
    const confirmBtn = dialog.querySelector<HTMLButtonElement>('.btn-danger');
    expect(confirmBtn).not.toBeNull();
    confirmBtn!.click();

    await new Promise<void>((res) => setTimeout(res, 50));

    expect(vi.mocked(deleteSection)).toHaveBeenCalledWith('inbox', 'sec-1');
  });

  it('Cancel closes the delete-section dialog WITHOUT calling deleteSection', () => {
    const deleteBtn = document.querySelector<HTMLButtonElement>(
      '.tasks-section-group__delete-btn',
    );
    deleteBtn!.click();

    const dialog = document.getElementById('tasks-delete-section-dialog') as HTMLDialogElement;
    const cancelBtn = dialog.querySelector<HTMLButtonElement>('.btn-secondary');
    expect(cancelBtn).not.toBeNull();
    cancelBtn!.click();

    expect(dialog.open).toBe(false);
    expect(vi.mocked(deleteSection)).not.toHaveBeenCalled();
  });
});
