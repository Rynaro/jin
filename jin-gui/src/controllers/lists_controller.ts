/**
 * ListsController — Stimulus controller for the Lists sidebar rail (P3, S5).
 *
 * Data flow (S5 — Approach §4, the rail is the single source of truth for scope):
 *   loadLists() → listLists() + listTasks() → computeSidebarCounts()
 *     → renderSmartViews() (Smart Views group) + renderListsSidebar() (Lists group)
 *
 * Selecting a scope:
 *   Row click (smart view OR list) → selectScope() → re-renders the rail's
 *   own active-row indicator → dispatches `jin:scope-changed { scope }`
 *   → TasksController#setScope picks it up (data-action on the tasks section).
 *   The OLD mechanism (writing into a shared `<select>` and dispatching a
 *   `change` event) is retired along with `#tasks-list-filter` (AC-S5-07);
 *   this is the one control for scope now (AC-S5-09).
 *
 * Live counts (S5 action plan item 5 — Approach §8 [R1]):
 *   TasksController's `mutate()` chokepoint already dispatches
 *   `jin:tasks-changed` on every successful task mutation. This controller
 *   ADDS THE LISTENER (`jin:tasks-changed@window->lists#handleTasksChanged`)
 *   — it does not, and must not, add a second dispatch anywhere (AC-X-08).
 *   `jin:tasks-changed` originates from the tasks <section> — an ANCESTOR of
 *   this rail's own element — so the listener needs the `@window` global
 *   target (Stimulus): a plain, unscoped `data-action` on a descendant can
 *   never observe an event bubbling from one of its own ancestors.
 *
 * Rail sync for a controller-initiated scope switch (AC-S3-08's deep link):
 *   when TasksController switches scope on its own (the target task lives
 *   outside the active scope), it dispatches `jin:scope-set` — a DIFFERENT
 *   event from `jin:scope-changed` on purpose, so this controller can update
 *   its OWN active-row indicator without re-dispatching `jin:scope-changed`
 *   right back at TasksController (which already reloaded; re-dispatching
 *   would just repeat the same reload for no reason).
 *
 * CRUD (all via native <dialog> — NO window.prompt):
 *   Create: openCreate → createDialog.showModal() → saveCreate → createList → reload
 *   Edit:   openEdit(list) → editDialog.showModal() → saveEdit → editList → reload
 *   Recolor: recolor picker inside edit dialog (palette swatches)
 *   Delete: openDelete(list) → deleteDialog.showModal() → confirmDelete → deleteList → reload
 *
 * Connect pattern: data-controller="lists" on the lists rail <div>.
 *
 * Targets:
 *   smartViewsList    — <ul> for the four smart-view rows (S5)
 *   sidebarList       — <ul> for list rows
 *   createDialog      — <dialog> for new list creation
 *   createNameInput   — <input> for new list name
 *   createColorPicker — container for palette color swatches (create form)
 *   createError       — <p class="form-error"> inside createDialog
 *   editDialog        — <dialog> for editing an existing list
 *   editNameInput     — <input> for edited list name
 *   editColorPicker   — container for palette color swatches (edit form)
 *   editError         — <p class="form-error"> inside editDialog
 *   deleteDialog      — <dialog> for delete confirmation
 *   deleteMessage     — <p> inside deleteDialog (list name / confirm copy)
 *
 * Actions:
 *   lists#openCreate            — new list button click
 *   lists#closeCreate           — cancel inside createDialog
 *   lists#saveCreate            — form submit inside createDialog
 *   lists#closeEdit             — cancel inside editDialog
 *   lists#saveEdit              — form submit inside editDialog
 *   lists#closeDelete           — cancel inside deleteDialog
 *   lists#confirmDelete         — confirm button inside deleteDialog
 *   lists#handleTasksChanged    — jin:tasks-changed@window (S5 live counts)
 *   lists#handleScopeSet        — jin:scope-set@window (S5 rail sync)
 */

import { Controller } from '@hotwired/stimulus';
import { listLists, listTasks, createList, editList, deleteList, reorderList } from '../invoke';
import { isJinErrorDto, toSyntheticErrorDto } from '../types/error';
import { renderListsSidebar, renderSmartViews } from '../lib/lists/render';
import { computeSidebarCounts, type SidebarCounts } from '../lib/lists/counts';
import type { TaskScope } from '../lib/tasks/scopes';
import { initIcons } from '../lib/icons';
import type { ListDto } from '../types/dto';
import { JinModal } from '../lib/ui/modal';
import { createJinColorPicker, type JinColorPicker } from '../lib/ui/color_picker';

const EMPTY_COUNTS: SidebarCounts = { smartViews: { inbox: 0, today: 0, upcoming: 0, flexible: 0 }, lists: {} };

export default class ListsController extends Controller {
  // ── Targets ───────────────────────────────────────────────────────────────
  static targets = [
    'smartViewsList',
    'sidebarList',
    'createDialog',
    'createNameInput',
    'createColorPicker',
    'createError',
    'editDialog',
    'editNameInput',
    'editColorPicker',
    'editError',
    'deleteDialog',
    'deleteMessage',
  ];

  declare smartViewsListTarget: HTMLElement;
  declare hasSmartViewsListTarget: boolean;
  declare sidebarListTarget: HTMLElement;
  declare hasSidebarListTarget: boolean;
  declare createDialogTarget: HTMLDialogElement;
  declare hasCreateDialogTarget: boolean;
  declare createNameInputTarget: HTMLInputElement;
  declare createColorPickerTarget: HTMLElement;
  declare createErrorTarget: HTMLElement;
  declare editDialogTarget: HTMLDialogElement;
  declare hasEditDialogTarget: boolean;
  declare editNameInputTarget: HTMLInputElement;
  declare editColorPickerTarget: HTMLElement;
  declare editErrorTarget: HTMLElement;
  declare deleteDialogTarget: HTMLDialogElement;
  declare hasDeleteDialogTarget: boolean;
  declare deleteMessageTarget: HTMLElement;

  // ── State ─────────────────────────────────────────────────────────────────
  private pendingEditId: string | null = null;
  private pendingEditColor: string = 'accent';
  private pendingDeleteId: string | null = null;
  private pendingCreateColor: string = 'accent';

  // ── S5: scope model (Approach §4) — the rail is the single source of truth
  // for "where the user is". Cached alongside the raw lists + client-side
  // counts so the active-row indicator and the badges can be re-rendered
  // without a network round-trip whenever ONLY the scope changes.
  private lists: ListDto[] = [];
  private counts: SidebarCounts = EMPTY_COUNTS;
  private activeScope: TaskScope = { kind: 'smart', id: 'inbox' };

  // ── S4: JinModal instances (in-place; dialog elements stay in the lists rail) ──
  /** JinModal wrapper for the New List creation dialog. */
  private _createModal: JinModal | null = null;
  /** JinModal wrapper for the Edit List dialog. */
  private _editModalInstance: JinModal | null = null;
  /** JinModal wrapper for the Delete List confirm dialog. */
  private _deleteModal: JinModal | null = null;
  private readonly _colorPickers = new Map<HTMLElement, JinColorPicker>();

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  connect(): void {
    // S4: adopt the three lists dialogs via JinModal.fromElement with host:'in-place'
    // so they stay inside the lists rail section (Stimulus targets like
    // createNameInputTarget remain accessible) while gaining the JinModal lifecycle
    // (header, close button, backdrop/Escape handling) and the action-dialog CSS.
    if (this.hasCreateDialogTarget) {
      this._createModal = JinModal.fromElement(this.createDialogTarget, {
        host: 'in-place',
        onPrimary: () => void this.saveCreate(),
        onSecondary: () => this.closeCreate(),
      });
    }
    if (this.hasEditDialogTarget) {
      this._editModalInstance = JinModal.fromElement(this.editDialogTarget, {
        host: 'in-place',
        onPrimary: () => void this.saveEdit(),
        onSecondary: () => this.closeEdit(),
      });
    }
    if (this.hasDeleteDialogTarget) {
      // The delete button uses .btn-danger (not .btn-primary), so we wire it
      // manually before fromElement strips its data-action attribute.
      const deleteBtn = this.deleteDialogTarget.querySelector<HTMLButtonElement>('.btn-danger');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', () => void this.confirmDelete());
      }
      this._deleteModal = JinModal.fromElement(this.deleteDialogTarget, {
        host: 'in-place',
        onSecondary: () => this.closeDelete(),
      });
    }

    void this.loadLists();
  }

  disconnect(): void {
    this._colorPickers.forEach(picker => picker.destroy());
    this._colorPickers.clear();
    this._createModal?.destroy();
    this._createModal = null;
    this._editModalInstance?.destroy();
    this._editModalInstance = null;
    this._deleteModal?.destroy();
    this._deleteModal = null;
  }

  // ── S1: guarded() — Approach §8 (ListsController gets guarded(), not
  // mutate(): list CRUD is not one of the six task-mutating calls in AC-X-08,
  // so it does not dispatch jin:tasks-changed). Catches a rejection, wraps a
  // non-JinErrorDto into a synthetic one (types/error.ts#toSyntheticErrorDto
  // — shared with TasksController so a string InvokeError rejection is never
  // discarded), dispatches app:error, and resolves to undefined instead of
  // throwing.

  private async guarded<T>(op: () => Promise<T>, ctx: string): Promise<T | undefined> {
    try {
      return await op();
    } catch (err: unknown) {
      const dto = isJinErrorDto(err) ? err : toSyntheticErrorDto(err, ctx);
      this.dispatch('error', { detail: dto, prefix: 'app', bubbles: true });
      return undefined;
    }
  }

  // ── Load ──────────────────────────────────────────────────────────────────

  /**
   * loadLists — refetch both the lists AND the full task set, recompute
   * client-side counts, and re-render the rail. Runs on connect, after list
   * CRUD, on a drag-reorder, AND (S5) on every `jin:tasks-changed` — the
   * event this controller ADDS THE LISTENER for; the dispatch stays owned
   * entirely by TasksController's `mutate()` chokepoint (AC-X-08).
   */
  async loadLists(): Promise<void> {
    const lists = await this.guarded(() => listLists(), 'loadLists');
    if (lists === undefined) return;
    this.lists = lists;

    // S5 (AC-S5-03/05): counts are computed CLIENT-SIDE from the fetched
    // task set — never from `ListDto.task_count`, which counts `done` tasks
    // too and would make the badge lie again the moment a task completes.
    // A `listTasks()` failure is non-fatal: the rail still renders, just
    // with zeroed counts rather than stale ones.
    const tasks = await this.guarded(() => listTasks(), 'loadLists:listTasks');
    this.counts = computeSidebarCounts(tasks ?? [], lists);

    this.renderRail();
    initIcons();
  }

  /** renderRail — repaint the Smart Views + Lists groups from cached state. */
  private renderRail(): void {
    if (this.hasSmartViewsListTarget) {
      renderSmartViews(this.smartViewsListTarget, this.counts, this.activeScope, {
        onSelect: (id) => this.selectScope({ kind: 'smart', id }),
      });
    }

    if (this.hasSidebarListTarget) {
      renderListsSidebar(this.sidebarListTarget, this.lists, {
        counts: this.counts.lists,
        activeScope: this.activeScope,
        onSelect: (listId) => this.selectScope({ kind: 'list', id: listId }),
        onEditRequest: (list) => this.openEditDialog(list),
        onDeleteRequest: (list) => this.openDeleteDialog(list),
        onReorder: (listId, position) => void this.handleReorder(listId, position),
      });
    }
  }

  // ── Select a scope (S5 — the rail owns scope) ─────────────────────────────

  /**
   * selectScope — a rail click (smart view or list row). Updates the active-
   * row indicator immediately (no round-trip needed for that), then
   * dispatches `jin:scope-changed` so TasksController reloads for the new
   * scope. One control, one concept — replaces the old
   * write-into-a-shared-select-and-fire-a-change-event mechanism entirely
   * (AC-S5-07/09).
   */
  private selectScope(scope: TaskScope): void {
    this.activeScope = scope;
    this.renderRail();
    this.dispatch('scope-changed', { detail: { scope }, prefix: 'jin', bubbles: true });
  }

  /**
   * handleTasksChanged — S5 live counts (action plan item 5). Listens for
   * the `jin:tasks-changed` event TasksController's `mutate()` chokepoint
   * already dispatches on every successful task mutation (Approach §8
   * [R1]) — this is the ADDED listener, never a second dispatch. Wired via
   * `jin:tasks-changed@window->lists#handleTasksChanged` because the event
   * originates on the tasks <section>, an ANCESTOR of this rail's own
   * element — a plain data-action here could never observe it.
   */
  handleTasksChanged(): void {
    void this.loadLists();
  }

  /**
   * handleScopeSet — S5 rail sync for a scope switch TasksController makes
   * on its OWN initiative (AC-S3-08's deep link: the target task lives
   * outside the active scope). Updates only this controller's active-row
   * indicator; it must NOT re-dispatch `jin:scope-changed` — TasksController
   * already reloaded for the new scope, so re-dispatching would just repeat
   * that reload for nothing. A distinct event name from `jin:scope-changed`
   * on purpose (see the class doc comment).
   */
  handleScopeSet(event: Event): void {
    const ce = event as CustomEvent<{ scope: TaskScope }>;
    if (!ce.detail?.scope) return;
    this.activeScope = ce.detail.scope;
    this.renderRail();
  }

  /**
   * handleReorder — AC-S5-08: wire the previously-dead `reorderList(id,
   * position)` bridge call. `position` is already a fresh rank key computed
   * by the render layer's `between()` call (lib/lists/render.ts) — this is
   * a thin guarded() pass-through (list CRUD, not one of the six
   * task-mutating calls in AC-X-08, so guarded() not mutate()).
   */
  private async handleReorder(listId: string, position: string): Promise<void> {
    const result = await this.guarded(() => reorderList(listId, position), 'handleReorder');
    if (result === undefined) return;
    void this.loadLists();
  }

  // ── Create ────────────────────────────────────────────────────────────────

  openCreate(): void {
    // S4: use _createModal instead of createDialogTarget.showModal()
    if (!this._createModal) return;
    this.pendingCreateColor = 'accent';
    this.createNameInputTarget.value = '';
    this.createErrorTarget.textContent = '';
    this.createErrorTarget.classList.add('hidden');
    this.renderColorPicker(this.createColorPickerTarget, this.pendingCreateColor, (color) => {
      this.pendingCreateColor = color;
    });
    this._createModal.open();
  }

  closeCreate(): void {
    this._createModal?.close();
  }

  async saveCreate(event?: Event): Promise<void> {
    event?.preventDefault();
    // Dialog stays in-place, so Stimulus targets (createNameInputTarget, etc.) still work.
    const name = this.createNameInputTarget.value.trim();
    if (!name) {
      this.createErrorTarget.textContent = 'List name cannot be empty.';
      this.createErrorTarget.classList.remove('hidden');
      return;
    }

    try {
      // Bridge contract requires both color AND icon (CreateListInput has no
      // #[serde(default)] — see src-tauri/src/commands/lists.rs). 'list' is
      // the canonical non-default list icon: lib/lists/render.ts already
      // draws every non-inbox list with it, and jin-core's own tests
      // (ops/lists.rs) use the same literal.
      await createList({ name, color: this.pendingCreateColor, icon: 'list' });
      this.closeCreate();
      void this.loadLists();
    } catch (err: unknown) {
      // Inline form error (JinErrorDto) beats a generic toast — the user is
      // mid-form. The non-JinErrorDto branch still must not swallow silently.
      if (isJinErrorDto(err)) {
        this.createErrorTarget.textContent = err.message;
        this.createErrorTarget.classList.remove('hidden');
      } else {
        this.dispatch('error', { detail: toSyntheticErrorDto(err, 'saveCreate'), prefix: 'app', bubbles: true });
      }
    }
  }

  // ── Edit ──────────────────────────────────────────────────────────────────

  private openEditDialog(list: ListDto): void {
    // S4: use _editModalInstance instead of editDialogTarget.showModal()
    if (!this._editModalInstance) return;
    this.pendingEditId = list.id;
    this.pendingEditColor = list.color;
    this.editNameInputTarget.value = list.name;
    this.editErrorTarget.textContent = '';
    this.editErrorTarget.classList.add('hidden');
    this.renderColorPicker(this.editColorPickerTarget, list.color, (color) => {
      this.pendingEditColor = color;
    });
    this._editModalInstance.open();
  }

  closeEdit(): void {
    this.pendingEditId = null;
    this._editModalInstance?.close();
  }

  async saveEdit(event?: Event): Promise<void> {
    event?.preventDefault();
    if (!this.pendingEditId) return;

    const name = this.editNameInputTarget.value.trim();
    if (!name) {
      this.editErrorTarget.textContent = 'List name cannot be empty.';
      this.editErrorTarget.classList.remove('hidden');
      return;
    }

    const id = this.pendingEditId;
    try {
      await editList(id, { name, color: this.pendingEditColor });
      this.closeEdit();
      void this.loadLists();
    } catch (err: unknown) {
      // Inline form error (JinErrorDto) beats a generic toast — the user is
      // mid-form. The non-JinErrorDto branch still must not swallow silently.
      if (isJinErrorDto(err)) {
        this.editErrorTarget.textContent = err.message;
        this.editErrorTarget.classList.remove('hidden');
      } else {
        this.dispatch('error', { detail: toSyntheticErrorDto(err, 'saveEdit'), prefix: 'app', bubbles: true });
      }
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  private openDeleteDialog(list: ListDto): void {
    // S4: use _deleteModal instead of deleteDialogTarget.showModal()
    if (!this._deleteModal) return;
    this.pendingDeleteId = list.id;
    this.deleteMessageTarget.textContent =
      `Delete "${list.name}"? Tasks in this list will be moved to Inbox.`;
    this._deleteModal.open();
  }

  closeDelete(): void {
    this.pendingDeleteId = null;
    this._deleteModal?.close();
  }

  async confirmDelete(): Promise<void> {
    if (!this.pendingDeleteId) return;
    const id = this.pendingDeleteId;
    this.closeDelete();

    const result = await this.guarded(() => deleteList(id), 'confirmDelete');
    if (result === undefined) return;
    void this.loadLists();
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /**
   * renderColorPicker — render a palette swatch grid into a container.
   * Each swatch is a <button> with data-color; clicking it updates pendingColor
   * and highlights the active swatch.
   */
  private renderColorPicker(
    container: HTMLElement,
    activeColor: string,
    onPick: (color: string) => void
  ): void {
    this._colorPickers.get(container)?.destroy();
    const picker = createJinColorPicker({ value: activeColor, label: 'Choose a list color', onPick });
    this._colorPickers.set(container, picker);
    container.className = 'lists-color-picker';
    container.replaceChildren(picker.element);
  }
}
