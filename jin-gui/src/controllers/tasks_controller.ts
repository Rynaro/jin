/**
 * TasksController — Stimulus controller for the Tasks browse + detail pane (GUI-S4, S3, S5).
 *
 * Data flow (list, S5 — Approach §4):
 *   currentScope (TaskScope) + filter → listTasks(list?, status?, priority?, tag?)
 *     → applyScope() (smart-view scopes only) → filterTasksList() → sortTasksList()
 *     → renderTasksList()
 *   Scope (which list, or which smart view) is owned by the sidebar rail —
 *   `ListsController` dispatches `jin:scope-changed`; `setScope()` below
 *   consumes it and reloads. The retired `#tasks-list-filter` select
 *   (AC-S5-07) no longer exists; this is the one control for scope now.
 *
 * Data flow (detail pane, S3 — Approach §2):
 *   selection (item click / jin:open-detail) → getTaskById(id) → TaskDto → renderTaskPane()
 *   The pane renders BESIDE the list (a CSS grid column collapsed to 0 width
 *   until a task is selected) — the list is NEVER hidden, and there is only
 *   ONE editor: the page-swap detail and the row pencil→modal editor are both
 *   retired (AC-S3-01, AC-S3-04). The pane ALWAYS hydrates via getTaskById —
 *   never from the list_tasks projection, whose body is always "" — this is
 *   the structural cure for D1 and the reason it cannot come back (AC-S3-05).
 *
 * P1 interactive mutations (all zero-schema — reuse existing bridge commands):
 *   S1.1 Complete/reopen: status-btn click → set_task_status → optimistic update
 *   S1.3 Delete: delete-btn (row, or the pane's own Delete) → confirm → delete_task
 *   S1.4 Create-in-place: add-task input Enter → create_task → list refresh
 *   S1.5 Hover cluster: delete button revealed via CSS :hover
 *
 * Connect pattern: data-controller="tasks" on the tasks <section> element.
 * Required <template> elements in the document:
 *   #tmpl-task-item      — the ONE task-item shell, row AND card (S2: item.ts buildTaskItem)
 *   #tmpl-backlink-row   — link/backlink item shell (shared)
 *
 * Targets:
 *   main                — the .tasks-main grid container (list | pane), S3
 *   listPanel           — wraps the list + empty/loading states
 *   list                — <ul> for task rows
 *   emptyState          — shown when list is empty
 *   loadingState        — shown while list invoke is in-flight
 *   statusFilter        — <select> for status filter
 *   priorityFilter      — <select> for priority filter
 *   detailPanel         — the .tasks-detail-pane element (S3: never `.hidden`ed)
 *   detailLoadingState  — shown while detail invoke is in-flight
 *   detailNotFoundState — shown when get_task returns not-found
 *   detailContent       — populated by renderTaskPane()
 *
 * Actions:
 *   tasks#applyFilter      — filter controls change event
 *   tasks#setScope         — jin:scope-changed event handler (from ListsController, S5)
 *   tasks#openDetail       — jin:open-detail event handler (from RouterController)
 *   tasks#closeDeleteTask  — cancel/close delete dialog (P1 S1.3)
 *   tasks#confirmDeleteTask — confirm button in delete dialog (P1 S1.3)
 */

import { Controller } from '@hotwired/stimulus';
import {
  listTasks,
  getTaskById,
  setTaskStatus,
  editTask,
  deleteTask,
  createTask,
  listLists,
  listTags,
  editList,
  createSection,
  renameSection,
  deleteSection,
  reorderSection,
  setTagColor,
  moveTask,
  reseedPositions,
} from '../invoke';
import { ConfirmDialog } from '../lib/ui/confirm_dialog';
import { JinModal } from '../lib/ui/modal';
import { TagColorDialog } from '../lib/ui/tag_color_dialog';
import { JinSelect } from '../lib/ui/select';
import { between } from '../lib/tasks/rank';
import { isJinErrorDto, toSyntheticErrorDto } from '../types/error';
import {
  filterTasksList,
  sortTasksList,
  sortTasksForMode,
  computeSubtaskDisplayInfo,
  type TasksFilter,
  type SubtaskDisplayInfo,
} from '../lib/tasks/transform';
import { applyScope, groupFlexibleTasks, type TaskScope } from '../lib/tasks/scopes';
import {
  intersectLegalNextStatuses,
  partitionCascadingChildren,
  computeSelectionRange,
  runBulkOperation,
} from '../lib/tasks/bulk';
import type { TaskDto, SectionDto, ListDto } from '../types/dto';
import {
  type TasksViewElements,
  type TasksTemplates,
  type TaskRowCallbacks,
  type SectionCallbacks,
  type TaskDetailCallbacks,
  type BulkPanelCallbacks,
  showTasksListLoading,
  hideTasksListLoading,
  renderTasksList,
  renderFlexibleTaskGroups,
  renderTaskPane,
  renderListViewWithSections,
  renderBoardView,
  renderBulkPanel,
} from '../lib/tasks/render';
import { initIcons } from '../lib/icons';
import type TemporalEditorController from './temporal_editor_controller';
import type { TemporalEditorCommit } from './temporal_editor_controller';

// ── Module-level helpers ──────────────────────────────────────────────────────

/**
 * S1: view (list/board) is now a GLOBAL user preference, not a per-list
 * persisted field (Approach §5 — `ListDto.view` stays on the core model but
 * loses its GUI consumer). Persisted the same way lib/appearance/state.ts
 * persists appearance prefs: a plain localStorage read/write, silent on error.
 */
const TASKS_VIEW_STORAGE_KEY = 'jin.tasks.view';

/** loadPersistedView — reads the global view preference; 'list' on miss/error. */
function loadPersistedView(): 'list' | 'board' {
  try {
    return localStorage.getItem(TASKS_VIEW_STORAGE_KEY) === 'board' ? 'board' : 'list';
  } catch {
    return 'list';
  }
}

/** savePersistedView — writes the global view preference; silent no-op on error. */
function savePersistedView(view: 'list' | 'board'): void {
  try {
    localStorage.setItem(TASKS_VIEW_STORAGE_KEY, view);
  } catch {
    // Silent: localStorage unavailable (e.g. private browsing) is not fatal.
  }
}

export default class TasksController extends Controller {
  // ── Targets ───────────────────────────────────────────────────────────────
  static targets = [
    // S3: the .tasks-main grid container — its class drives the pane's
    // collapsed (0-width) vs. open (detail-open) state.
    'main',
    'listPanel',
    'workspaceTitle',
    'railToggleBtn',
    'railCloseBtn',
    'list',
    'emptyState',
    'loadingState',
    'statusFilter',
    'priorityFilter',
    'tagFilter',
    'filtersToggleBtn',
    'filtersPanel',
    'filterCount',
    'detailPanel',
    'detailLoadingState',
    'detailNotFoundState',
    'detailContent',
    // P6: view toggle + sort mode
    'viewToggleBtn',
    'sortModeSelect',
    // P5: section management form fields — the dialogs themselves are S8-
    // ported to JinModal (accessed by element id in connect(), below); these
    // inner-form targets stay Stimulus targets because host:'in-place' keeps
    // the dialog a descendant of this controller's element.
    'addSectionNameInput',
    'addSectionError',
    'deleteSectionMessage',
    // NOTE: deleteTaskDialog, editTaskDialog (S3: retired), dueDateDialog,
    // addSectionDialog, deleteSectionDialog (S8: retired, AC-S8-03) —
    // intentionally removed from targets — managed via direct JinModal/
    // ConfirmDialog references so Stimulus subtree-scoping no longer blocks
    // them (fixes DT-2).
  ];

  declare hasMainTarget: boolean;
  declare mainTarget: HTMLElement;
  declare listPanelTarget: HTMLElement;
  declare workspaceTitleTarget: HTMLElement;
  declare hasWorkspaceTitleTarget: boolean;
  declare railToggleBtnTarget: HTMLButtonElement;
  declare hasRailToggleBtnTarget: boolean;
  declare railCloseBtnTarget: HTMLButtonElement;
  declare hasRailCloseBtnTarget: boolean;
  declare listTarget: HTMLElement;
  declare emptyStateTarget: HTMLElement;
  declare loadingStateTarget: HTMLElement;
  declare statusFilterTarget: HTMLSelectElement;
  declare priorityFilterTarget: HTMLSelectElement;
  declare tagFilterTarget: HTMLSelectElement;
  declare hasTagFilterTarget: boolean;
  declare filtersToggleBtnTarget: HTMLButtonElement;
  declare hasFiltersToggleBtnTarget: boolean;
  declare filtersPanelTarget: HTMLElement;
  declare hasFiltersPanelTarget: boolean;
  declare filterCountTarget: HTMLElement;
  declare hasFilterCountTarget: boolean;
  declare detailPanelTarget: HTMLElement;
  declare detailLoadingStateTarget: HTMLElement;
  declare detailNotFoundStateTarget: HTMLElement;
  declare detailContentTarget: HTMLElement;
  // P6
  declare viewToggleBtnTarget: HTMLButtonElement;
  declare viewToggleBtnTargets: HTMLButtonElement[];
  declare hasViewToggleBtnTarget: boolean;
  declare sortModeSelectTarget: HTMLSelectElement;
  declare hasSortModeSelectTarget: boolean;
  // P5 section dialog form fields (dialogs themselves: S8, JinModal by id)
  declare addSectionNameInputTarget: HTMLInputElement;
  declare addSectionErrorTarget: HTMLElement;
  declare deleteSectionMessageTarget: HTMLElement;

  // ── P1 state ──────────────────────────────────────────────────────────────
  private pendingDeleteId: string | null = null;

  // ── S2: ConfirmDialog for delete ──────────────────────────────────────────
  /** Lazily-initialized delete confirm modal (ConfirmDialog extends JinModal). */
  private _deleteConfirmModal: ConfirmDialog | null = null;

  // ── S8: JinModal-hosted section dialogs (AC-S8-03, retiring the raw
  // <dialog> + Stimulus-target pair — DT-2) ─────────────────────────────────
  private _addSectionModal: JinModal | null = null;
  private _deleteSectionModal: JinModal | null = null;

  // ── S8: tag color picker (AC-S8-02) ───────────────────────────────────────
  /** Lazily-initialized tag color picker modal, reused across every chip. */
  private _tagColorModal: TagColorDialog | null = null;
  /** The tag slug the currently-open color picker is choosing a color for. */
  private _pendingTagColorSlug: string | null = null;

  // ── S3: selection drives the ONE detail pane (Approach §2) ────────────────
  /**
   * The task currently selected in the list (item click, or a jin:open-detail
   * deep link). null = no selection, pane collapsed. Exactly one rendered
   * item carries `aria-selected="true"` at a time (AC-S3-03).
   */
  private selectedTaskId: string | null = null;

  // ── S7: bulk multi-select (Approach: "click, shift-click range, cmd/ctrl-
  // click toggle") ───────────────────────────────────────────────────────────
  /**
   * The bulk multi-selection set. Empty = single-select mode is active
   * (`selectedTaskId` above governs, exactly as before S7). 2+ members =
   * bulk mode: `selectedTaskId` is forced `null`, `renderList()` renders the
   * bulk panel instead of the single-task pane, and aria-selected on each
   * rendered item reflects membership in THIS set instead of `selectedTaskId`
   * (`resolveItemSelected`, render.ts). Exactly one of {`selectedTaskId` set,
   * `selectedTaskIds.size >= 2`} is ever "active" — every method that
   * populates one clears the other.
   */
  private selectedTaskIds: Set<string> = new Set();
  /** Shift-click range anchor — the last plain-clicked or ctrl/cmd-toggled item. */
  private selectionAnchorId: string | null = null;
  /** Pending bulk delete confirmation (mirrors `pendingDeleteId` for the single-task path). */
  private pendingBulkDeleteIds: string[] | null = null;

  // ── P9 state ──────────────────────────────────────────────────────────────
  /**
   * Flat list of currently rendered tasks (after filter). Used by the DnD
   * handler to look up fractional position keys by task id.
   */
  private currentTasks: TaskDto[] = [];
  /**
   * S7: all known lists, refreshed on every `loadList()` (same fetch that
   * already resolves `activeList`'s sections/sort_mode) — used by the bulk
   * panel's "Move to list" control so it doesn't need its own bridge call.
   */
  private currentLists: ListDto[] = [];

  /**
   * S5 (AC-S6-10): subtask breadcrumb/progress info resolved against the
   * FULL fetched task set — set only for a smart-view scope, where
   * `applyScope` may narrow `currentTasks` down to exclude a parent that
   * doesn't itself match the view (e.g. no due date), which would otherwise
   * silently blank its child's breadcrumb chip. `undefined` for a list
   * scope, where `renderTasksList`/`renderBoardView` fall back to deriving
   * it from the (already-list-scoped, parent-and-child-share-a-list)
   * rendered set — unaffected, same as before S5.
   */
  private currentSubtaskDisplayInfo: Map<string, SubtaskDisplayInfo> | undefined = undefined;

  // ── P5/P6 state ───────────────────────────────────────────────────────────
  /** Sections of the currently active list (empty if no specific list selected). */
  private currentSections: SectionDto[] = [];
  /**
   * S1: view mode is a GLOBAL user preference (Approach §5), not per-list.
   * Loaded once in connect() from localStorage['jin.tasks.view']; never reset
   * or re-derived from a list's `ListDto.view` field when switching lists.
   */
  private currentView: 'list' | 'board' = 'list';
  /** Sort mode for the currently active list. */
  private currentSortMode: string = 'manual';
  private filtersExpanded = true;
  private _filterMedia: MediaQueryList | null = null;
  private _boundFilterMediaChange: (() => void) | null = null;
  /** ID of the currently active list (null = a smart-view scope, no single list). */
  private currentListId: string | null = null;
  /**
   * S5 (Approach §4) — the rail's scope model; the single source of truth
   * for "where the user is". Defaults to the Inbox smart view; `connect()`
   * promotes it to the literal default-list scope once `listLists()`
   * resolves (preserving the pre-S5 "DnD works immediately, no need to
   * click a list first" guarantee) — see `connectAutoSelect()`.
   * `currentListId` above is DERIVED from this whenever it changes (kept as
   * its own field, not a getter, so existing section/sort-mode/DnD logic —
   * and this file's own tests — can keep reading/writing it directly).
   */
  private currentScope: TaskScope = { kind: 'smart', id: 'inbox' };
  /** Pending section delete (for the confirm dialog). */
  private pendingDeleteSectionId: string | null = null;

  /** Keep the workspace identity a direct projection of the already-active scope. */
  private updateWorkspaceTitle(): void {
    if (!this.hasWorkspaceTitleTarget) return;
    if (this.currentScope.kind === 'list') {
      this.workspaceTitleTarget.textContent =
        this.currentLists.find((list) => list.id === this.currentScope.id)?.name ?? this.currentScope.id;
      return;
    }
    const names: Record<Extract<TaskScope, { kind: 'smart' }>['id'], string> = {
      inbox: 'Inbox',
      today: 'Today',
      upcoming: 'Upcoming',
      flexible: 'Flexible',
      completed: 'Completed',
    };
    this.workspaceTitleTarget.textContent = names[this.currentScope.id];
  }

  // ── S1: Approach §8 — the mutation chokepoint ─────────────────────────────
  //
  // guarded() wraps every READ bridge call (and every non-task-mutating write,
  // e.g. section/list-level calls): it catches a rejection, wraps a
  // non-JinErrorDto into a synthetic one (so the toast still fires), dispatches
  // `app:error` on the bubbling channel error_controller.ts listens on, and
  // resolves to `undefined` instead of throwing or swallowing. Callers must
  // treat `undefined` as "the call failed and has already been surfaced" and
  // bail out gracefully (AC-X-05).
  //
  // mutate() wraps every task-MUTATING bridge call — createTask, editTask,
  // setTaskStatus, moveTask, deleteTask, reseedPositions (AC-X-08). It is
  // guarded() plus exactly one `jin:tasks-changed` dispatch on success.
  // Success is tracked independently of the resolved value so a legitimately
  // void bridge call (reseedPositions) still counts as a success and still
  // dispatches — `result === undefined` alone cannot distinguish "failed" from
  // "succeeded with no payload".
  //
  // Every later story inherits this dispatch for free; no story re-implements it.

  // toSyntheticErrorDto now lives in ../types/error (shared with
  // ListsController) — see that module for why the `typeof err === 'string'`
  // branch matters (Tauri InvokeErrors are strings, not Error instances).

  private async guarded<T>(op: () => Promise<T>, ctx: string): Promise<T | undefined> {
    try {
      return await op();
    } catch (err: unknown) {
      const dto = isJinErrorDto(err) ? err : toSyntheticErrorDto(err, ctx);
      this.dispatch('error', { detail: dto, prefix: 'app', bubbles: true });
      return undefined;
    }
  }

  private async mutate<T>(op: () => Promise<T>, ctx: string): Promise<T | undefined> {
    let succeeded = false;
    const result = await this.guarded(async () => {
      const value = await op();
      succeeded = true;
      return value;
    }, ctx);
    if (succeeded) {
      this.dispatch('tasks-changed', { prefix: 'jin', bubbles: true });
    }
    return result;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  connect(): void {
    // S1: view is a global preference (Approach §5) — load it once here, never
    // per-list. loadList() must not overwrite this when switching lists.
    this.currentView = loadPersistedView();

    // P6: keyboard shortcut Shift+V to toggle list/board view
    this._boundKeyHandler = (e: KeyboardEvent) => this.handleGlobalKeydown(e);
    document.addEventListener('keydown', this._boundKeyHandler);

    // S2: Initialise the ConfirmDialog for task delete (modal-root, no DOM dialog needed).
    this._deleteConfirmModal = new ConfirmDialog({
      title: 'Delete Task',
      ariaLabel: 'Confirm task deletion',
      confirmLabel: 'Delete',
      variant: 'danger',
      onConfirm: () => void this.confirmDeleteTask(),
    });

    // S3: the row pencil / title+body+due edit modal is RETIRED — selection
    // opens the ONE detail pane instead (Approach §2). There is no dialog to
    // adopt here anymore (AC-S3-04).

    // S8 (AC-S8-03): port the add/delete section dialogs to JinModal —
    // accessed by element id (not a Stimulus target), the same "approach (b)"
    // used for the shared temporal editor.
    // host:'in-place' keeps each dialog nested inside this controller's
    // element, so addSectionNameInputTarget / addSectionErrorTarget /
    // deleteSectionMessageTarget stay resolvable.
    const sectionCreateDialogEl = document.getElementById(
      'tasks-add-section-dialog',
    ) as HTMLDialogElement | null;
    if (sectionCreateDialogEl) {
      this._addSectionModal = JinModal.fromElement(sectionCreateDialogEl, {
        host: 'in-place',
        onPrimary: () => void this.saveAddSection(),
        onSecondary: () => this.closeAddSection(),
      });
    }

    const sectionRemoveDialogEl = document.getElementById(
      'tasks-delete-section-dialog',
    ) as HTMLDialogElement | null;
    if (sectionRemoveDialogEl) {
      // The confirm button uses .btn-danger (not .btn-primary), so it is
      // wired manually before fromElement strips its data-action — mirrors
      // ListsController's deleteDialog wiring exactly.
      const confirmBtn = sectionRemoveDialogEl.querySelector<HTMLButtonElement>('.btn-danger');
      if (confirmBtn) {
        confirmBtn.addEventListener('click', () => void this.confirmDeleteSection());
      }
      this._deleteSectionModal = JinModal.fromElement(sectionRemoveDialogEl, {
        host: 'in-place',
        onSecondary: () => this.closeDeleteSection(),
      });
    }

    // S8 (AC-S8-02): the tag color picker — one instance, reused for every
    // chip (mirrors the single reused `_deleteConfirmModal`). Which tag it is
    // currently choosing a color for lives in `_pendingTagColorSlug`.
    this._tagColorModal = new TagColorDialog({
      title: 'Tag Color',
      onPick: (color) => {
        const slug = this._pendingTagColorSlug;
        if (!slug) return;
        void this.handleSetTagColor(slug, color);
      },
    });

    // S5: Enhance filter-bar selects with the JinSelect ink-and-seal wrapper.
    // The native <select> is the source of truth — values, change events, and
    // data-action="change->tasks#applyFilter" wiring are fully preserved.
    // Stimulus resolves data-tasks-target="*Filter" on the inner <select> as
    // before (it is still a descendant of the controller's element).
    // S5: the list filter select is RETIRED (AC-S5-07) — the rail is the
    // only scope control now (Approach §4); status/priority stay here.
    JinSelect.enhanceAll(this.element);
    this.updateFilterCount();
    if (typeof window.matchMedia === 'function') {
      this._filterMedia = window.matchMedia('(max-width: 900px)');
      this.filtersExpanded = !this._filterMedia.matches;
      this._boundFilterMediaChange = () => {
        this.filtersExpanded = !this.isFiltersConstrained();
        this.updateFilterDisclosure();
      };
      this._filterMedia.addEventListener('change', this._boundFilterMediaChange);
    }
    this.updateFilterDisclosure();

    // P3/P4: populate the tag filter, then auto-select the default list so
    // drag-and-drop works immediately (S5: via currentScope, not a select).
    void this.populateTags();
    void this.connectAutoSelect();
  }

  /**
   * connectAutoSelect — resolve the default list (Inbox) and promote
   * `currentScope` to that literal list scope so `currentListId` is always
   * set on first render — this preserves the pre-S5 guarantee that
   * drag-and-drop works out of the box without the user first clicking a
   * list in the rail. On failure (or no default list found), `currentScope`
   * stays at its initial value — the Inbox SMART VIEW (Approach §4) — which
   * fetches with no `list` filter, same as the retired "All Lists" fallback.
   */
  private async connectAutoSelect(): Promise<void> {
    const defaultListId = await this.resolveDefaultListId();
    if (defaultListId) {
      this.currentScope = { kind: 'list', id: defaultListId };
    }
    this.updateWorkspaceTitle();
    void this.loadList(this.currentFilter);
  }

  disconnect(): void {
    if (this._boundKeyHandler) {
      document.removeEventListener('keydown', this._boundKeyHandler);
    }
    if (this._filterMedia && this._boundFilterMediaChange) {
      this._filterMedia.removeEventListener('change', this._boundFilterMediaChange);
    }
    // S2: clean up the programmatic delete-confirm modal.
    this._deleteConfirmModal?.destroy();
    this._deleteConfirmModal = null;
    // S8: clean up the section dialogs + tag color picker modals.
    this._addSectionModal?.destroy();
    this._addSectionModal = null;
    this._deleteSectionModal?.destroy();
    this._deleteSectionModal = null;
    this._tagColorModal?.destroy();
    this._tagColorModal = null;
  }

  private _boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  private handleGlobalKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && this.hasFiltersToggleBtnTarget && this.isFiltersConstrained() && this.filtersExpanded) {
      this.filtersExpanded = false;
      this.updateFilterDisclosure();
      this.filtersToggleBtnTarget.focus();
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape' && this.isTypingTarget(e.target)) return;
    // Shift+V toggles view (P6) — native form controls keep their own keys.
    if (e.key === 'V' && e.shiftKey && !e.ctrlKey && !e.metaKey) {
      if (this.isTypingTarget(e.target)) return;
      // Only toggle when in the tasks section.
      if (this.element.classList.contains('hidden')) return;
      void this.toggleView();
      return;
    }

    // S3 (AC-S3-09) / S7: Escape clears the selection (single OR bulk) and
    // collapses the pane. `clearSelection()` handles both — it is a no-op
    // superset of the pre-S7 `closePane()` call for the single-select case.
    if (e.key === 'Escape' && (this.selectedTaskId || this.selectedTaskIds.size > 0)) {
      if (this.element.classList.contains('hidden')) return;
      this.clearSelection();
      return;
    }

    // ── S7: keyboard flow (inert while a text-editing control has focus) ────
    if (this.element.classList.contains('hidden')) return;

    // `n` — focus the quick-add input (AC-S7-07: inert inside text inputs).
    if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (this.isTypingTarget(e.target)) return;
      e.preventDefault();
      this.focusQuickAdd();
      return;
    }

    // ArrowUp/ArrowDown — move the single-select cursor (AC-S7-04).
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (this.isTypingTarget(e.target)) return;
      e.preventDefault();
      this.moveSelection(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }

    // Enter — open the pane for the keyboard-selected item, focus its title
    // (AC-S7-05).
    if (e.key === 'Enter') {
      if (this.isTypingTarget(e.target)) return;
      if (!this.selectedTaskId) return;
      e.preventDefault();
      void this.selectTaskAndFocusTitle(this.selectedTaskId);
      return;
    }

    // Delete/Backspace — open the delete confirmation for the
    // keyboard-selected item, or the bulk selection if 2+ are active
    // (AC-S7-06).
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.isTypingTarget(e.target)) return;
      if (this.selectedTaskIds.size >= 2) {
        e.preventDefault();
        this.openBulkDeleteDialog();
        return;
      }
      if (this.selectedTaskId) {
        const task = this.currentTasks.find((t) => t.id === this.selectedTaskId);
        if (task) {
          e.preventDefault();
          this.openDeleteDialog(task.id, task.title);
        }
      }
    }
  }

  // ── S5: resolve the default list id (Approach §4) ─────────────────────────

  /**
   * resolveDefaultListId — used only by `connectAutoSelect()` to promote the
   * initial scope to the literal default list. Non-fatal on failure (the
   * Inbox smart view stays the scope, exactly the retired "All Lists"
   * fallback's fetch shape — no `list` filter passed to `listTasks()`).
   */
  private async resolveDefaultListId(): Promise<string | null> {
    const lists = await this.guarded(() => listLists(), 'resolveDefaultListId');
    if (lists === undefined) return null;
    return lists.find((l) => l.is_default)?.id ?? null;
  }

  /**
   * setScope — S5: consumes `jin:scope-changed`, dispatched by
   * `ListsController` on a rail click (Approach §4). One control, one
   * concept — replaces the retired `#tasks-list-filter` select entirely
   * (AC-S5-07/09).
   */
  setScope(event: Event): void {
    const ce = event as CustomEvent<{ scope: TaskScope }>;
    if (!ce.detail?.scope) return;
    this.selectedTaskId = null;
    this.selectedTaskIds.clear();
    this.selectionAnchorId = null;
    this.setDetailOpen(false);
    this.detailContentTarget.replaceChildren();
    this.currentScope = ce.detail.scope;
    this.setRailOpen(false);
    this.updateWorkspaceTitle();
    void this.loadList(this.currentFilter);
  }

  toggleRail(): void {
    this.setRailOpen(!this.element.classList.contains('tasks-rail-open'));
  }

  private setRailOpen(open: boolean): void {
    const wasOpen = this.element.classList.contains('tasks-rail-open');
    this.element.classList.toggle('tasks-rail-open', open);
    if (this.hasRailToggleBtnTarget) {
      this.railToggleBtnTarget.setAttribute('aria-expanded', String(open));
      if (!open && wasOpen) this.railToggleBtnTarget.focus();
    }
    if (open && this.hasRailCloseBtnTarget) this.railCloseBtnTarget.focus();
  }

  // ── S1: view toggle (Approach §5 — GLOBAL preference, not per-list) ──────

  /**
   * Toggle List ↔ Board view. S1: no bridge call at all — the view lives in
   * `localStorage['jin.tasks.view']`, never in `ListDto.view` (AC-S1-07).
   * S4 (AC-S4-07, retiring AC-S1-08): the board now renders in every scope —
   * a specific list, "All Lists", or (once S5 ships) any smart view — so
   * this is never a no-op and the toggle is never disabled.
   */
  toggleView(): void {
    const newView: 'list' | 'board' = this.currentView === 'list' ? 'board' : 'list';
    this.currentView = newView;
    savePersistedView(newView);
    this.updateViewToggleButton();
    void this.loadList(this.currentFilter);
  }

  /** viewToggle action — called by the view toggle button (data-action="click->tasks#viewToggle"). */
  viewToggle(): void {
    this.toggleView();
  }

  /** Set an explicit List or Board choice from the native segmented control. */
  setView(event: Event): void {
    const requested = (event.currentTarget as HTMLButtonElement).dataset.view;
    if (requested !== 'list' && requested !== 'board') return;
    if (requested === this.currentView) return;
    this.currentView = requested;
    savePersistedView(requested);
    this.updateViewToggleButton();
    void this.loadList(this.currentFilter);
  }

  /** sortModeChange action — called when the sort mode select changes. sort_mode stays per-list (Approach §5). */
  sortModeChange(): void {
    if (!this.currentListId || !this.hasSortModeSelectTarget) return;
    const newSortMode = this.sortModeSelectTarget.value;
    void (async () => {
      const result = await this.guarded(
        () => editList(this.currentListId!, { sort_mode: newSortMode }),
        'sortModeChange',
      );
      if (result === undefined) return;
      this.currentSortMode = newSortMode;
      void this.loadList(this.currentFilter);
    })();
  }

  private updateViewToggleButton(): void {
    if (!this.hasViewToggleBtnTarget) return;
    for (const button of this.viewToggleBtnTargets) {
      const view = button.dataset.view;
      if (view === 'list' || view === 'board') {
        button.setAttribute('aria-pressed', String(view === this.currentView));
      } else {
        // Compatibility for older embedded/test markup while consumers move
        // to the explicit two-button segment.
        button.setAttribute(
          'aria-label',
          this.currentView === 'list' ? 'Switch to board view' : 'Switch to list view',
        );
      }
      button.disabled = false;
      button.removeAttribute('aria-disabled');
      button.removeAttribute('title');
    }
  }

  toggleFilters(): void {
    this.filtersExpanded = !this.filtersExpanded;
    this.updateFilterDisclosure();
    if (this.filtersExpanded) {
      this.filtersPanelTarget.querySelector<HTMLElement>('select:not(:disabled)')?.focus();
    }
  }

  private isFiltersConstrained(): boolean {
    return Boolean(
      this._filterMedia?.matches
      || (this.hasMainTarget && this.mainTarget.classList.contains('tasks-main--detail-open')),
    );
  }

  private updateFilterDisclosure(): void {
    if (!this.hasFiltersToggleBtnTarget || !this.hasFiltersPanelTarget) return;
    const constrained = this.isFiltersConstrained();
    if (!constrained) this.filtersExpanded = true;
    this.filtersPanelTarget.hidden = constrained && !this.filtersExpanded;
    this.filtersToggleBtnTarget.setAttribute('aria-expanded', String(!this.filtersPanelTarget.hidden));
  }

  private updateFilterCount(): void {
    if (!this.hasFilterCountTarget) return;
    const count = [
      this.statusFilterTarget.value,
      this.priorityFilterTarget.value,
      this.hasTagFilterTarget ? this.tagFilterTarget.value : '',
    ].filter(Boolean).length;
    this.filterCountTarget.textContent = count > 0 ? String(count) : '';
    this.filterCountTarget.setAttribute('aria-label', `${count} active ${count === 1 ? 'filter' : 'filters'}`);
  }

  // ── P5: Section management ────────────────────────────────────────────────

  openAddSection(): void {
    if (!this._addSectionModal || !this.currentListId) return;
    this.addSectionNameInputTarget.value = '';
    this.addSectionErrorTarget.textContent = '';
    this.addSectionErrorTarget.classList.add('hidden');
    this._addSectionModal.open();
  }

  closeAddSection(): void {
    this._addSectionModal?.close();
  }

  async saveAddSection(event?: Event): Promise<void> {
    event?.preventDefault();
    if (!this.currentListId || !this._addSectionModal) return;
    const name = this.addSectionNameInputTarget.value.trim();
    if (!name) {
      this.addSectionErrorTarget.textContent = 'Section name cannot be empty.';
      this.addSectionErrorTarget.classList.remove('hidden');
      return;
    }
    try {
      await createSection(this.currentListId, name);
      this.closeAddSection();
      void this.loadList(this.currentFilter);
    } catch (err: unknown) {
      // Inline form error (JinErrorDto) beats a generic toast here — the user
      // is mid-form and the message ("name already exists" etc.) is precise.
      // S1: the non-JinErrorDto branch no longer swallows — it must still
      // surface, just on the app:error channel since there's no inline copy for it.
      if (isJinErrorDto(err)) {
        this.addSectionErrorTarget.textContent = err.message;
        this.addSectionErrorTarget.classList.remove('hidden');
      } else {
        this.dispatch('error', { detail: toSyntheticErrorDto(err, 'saveAddSection'), prefix: 'app', bubbles: true });
      }
    }
  }

  private async handleRenameSection(sectionId: string, newName: string): Promise<void> {
    if (!this.currentListId) return;
    const result = await this.guarded(
      () => renameSection(this.currentListId!, sectionId, newName),
      'handleRenameSection',
    );
    if (result === undefined) return;
    void this.loadList(this.currentFilter);
  }

  /**
   * handleReorderSection — S8 (AC-S8-01): wire the previously-dead
   * `reorderSection(listId, sectionId, position)` bridge call. `position` is
   * already a fresh rank key computed by the render layer's `between()` call
   * (lib/tasks/render.ts). Section CRUD is not one of the six task-mutating
   * calls in AC-X-08 (mirrors handleRenameSection/confirmDeleteSection above)
   * — guarded(), not mutate().
   */
  private async handleReorderSection(sectionId: string, position: string): Promise<void> {
    if (!this.currentListId) return;
    const result = await this.guarded(
      () => reorderSection(this.currentListId!, sectionId, position),
      'handleReorderSection',
    );
    if (result === undefined) return;
    void this.loadList(this.currentFilter);
  }

  private openDeleteSectionDialog(sectionId: string, sectionName: string): void {
    if (!this._deleteSectionModal) return;
    this.pendingDeleteSectionId = sectionId;
    this.deleteSectionMessageTarget.textContent =
      `Delete section "${sectionName}"? Tasks in this section will move to "No Section".`;
    this._deleteSectionModal.open();
  }

  closeDeleteSection(): void {
    this.pendingDeleteSectionId = null;
    this._deleteSectionModal?.close();
  }

  async confirmDeleteSection(): Promise<void> {
    if (!this.pendingDeleteSectionId || !this.currentListId) return;
    const sectionId = this.pendingDeleteSectionId;
    this.closeDeleteSection();
    const result = await this.guarded(
      () => deleteSection(this.currentListId!, sectionId),
      'confirmDeleteSection',
    );
    if (result === undefined) return;
    void this.loadList(this.currentFilter);
  }

  // ── S8: tag color picker (AC-S8-02) ───────────────────────────────────────

  /** Opens the shared tag color picker for `slug`, preselecting `currentColor`. */
  private openTagColorPicker(slug: string, currentColor: string): void {
    if (!this._tagColorModal) return;
    this._pendingTagColorSlug = slug;
    this._tagColorModal.updateLabel(`Choose a color for #${slug}`);
    this._tagColorModal.updateColor(currentColor);
    this._tagColorModal.open();
  }

  /** Wires the previously-dead `setTagColor(slug, color)` bridge call. */
  private async handleSetTagColor(slug: string, color: string): Promise<void> {
    const result = await this.guarded(() => setTagColor(slug, color), 'handleSetTagColor');
    if (result === undefined) return;
    // Re-hydrate the pane so its tag chips reflect the new color immediately.
    if (this.selectedTaskId) void this.refreshPane(this.selectedTaskId);
  }

  // ── P8: Due date picker ───────────────────────────────────────────────────
  //
  // S3: `openDuePicker` (the retired edit modal's due-date trigger) is gone
  // along with that modal — the pane's own due button goes through
  // `openCalendarForDetail` ('detail_due' context) instead.

  /** Open the calendar for a reschedule (overdue chip "Pick date…"). */
  private async openDueDatePickerForReschedule(taskId: string, currentDue: string | null): Promise<void> {
    this.openTemporalEditor(currentDue, (result) => {
      void this.handleReschedule(taskId, result.kind === 'set' ? result.due : '');
    });
  }

  private openTemporalEditor(
    currentDue: string | null,
    onCommit: (result: TemporalEditorCommit) => void,
  ): void {
    const dialog = document.getElementById('jin-due-date-dialog') as HTMLDialogElement | null;
    if (!dialog) return;
    const editor = this.application.getControllerForElementAndIdentifier(
      dialog,
      'temporal-editor',
    ) as TemporalEditorController | null;
    editor?.open({ initialDue: currentDue, onCommit });
  }

  /**
   * ITEM 4: Open the shared calendar for the create-task row.
   * Controller routes the calendar:selected result back to `onSelected`.
   */
  private openCalendarForCreate(currentDue: string | null, onSelected: (dueString: string) => void): void {
    this.openTemporalEditor(currentDue, (result) => {
      onSelected(result.kind === 'set' ? result.due : '');
    });
  }

  /**
   * ITEM 5: Open the shared calendar for detail-field due editing.
   */
  private openCalendarForDetail(currentDue: string | null, onSelected: (dueString: string) => void): void {
    this.openTemporalEditor(currentDue, (result) => {
      onSelected(result.kind === 'set' ? result.due : '');
    });
  }

  private async handleReschedule(taskId: string, newDue: string): Promise<void> {
    const input = newDue ? { due: newDue } : { clear_due: true as const };
    const result = await this.mutate(() => editTask(taskId, input), 'handleReschedule');
    if (result === undefined) return;
    void this.loadList(this.currentFilter);
  }

  // ── P9: DnD drop handler ─────────────────────────────────────────────────

  /**
   * handleDrop — called by the render layer when a task row is dropped.
   *
   * Flow:
   * 1. If the current sort mode is not "manual", flip to manual and reseed
   *    all tasks in the current section so they have valid position keys.
   * 2. Look up the position keys of aboveId / belowId from currentTasks.
   * 3. Compute `newPos = between(abovePos, belowPos)`.
   * 4. Top-insert guard: if `newPos` is empty (degenerate all-'0' key), call
   *    reseedPositions again and recompute between(null, firstPos).
   * 5. Call moveTask(draggedId, { listId, sectionId, position: newPos }).
   * 6. Reload the list.
   */
  private async handleDrop(
    draggedId: string,
    sectionId: string | null,
    aboveId: string | null,
    belowId: string | null,
  ): Promise<void> {
    if (!this.currentListId) return; // guard: DnD only works in a specific list context

    // Step 1: if not in manual mode, flip to manual and reseed positions.
    // The sort_mode flip is a list-level call (not one of the six task-mutating
    // calls in AC-X-08) — guarded() only. reseedPositions IS on that list —
    // mutate() (dispatches jin:tasks-changed on success).
    if (this.currentSortMode !== 'manual') {
      const flipped = await this.guarded(
        () => editList(this.currentListId!, { sort_mode: 'manual' }),
        'handleDrop:setManualSortMode',
      );
      if (flipped === undefined) return;
      this.currentSortMode = 'manual';

      // Build ordered id list from currentTasks (in the section being dropped into).
      const tasksInSection = this.currentTasks.filter(
        (t) => (t.section_id ?? null) === sectionId,
      );
      const orderedIds = tasksInSection.map((t) => t.id);
      const reseeded = await this.mutate(
        () => reseedPositions(this.currentListId!, sectionId, orderedIds),
        'handleDrop:reseedPositions',
      );
      if (reseeded === undefined) return;

      // Reload to get fresh position keys before computing between().
      const freshLists = await this.guarded(() => listLists(), 'handleDrop:listLists');
      const freshList = freshLists?.find((l) => l.id === this.currentListId);
      if (freshList) this.currentSortMode = freshList.sort_mode;
      const freshTasks = await this.guarded(
        () => listTasks({ list: this.currentListId! }),
        'handleDrop:listTasks',
      );
      if (freshTasks === undefined) return;
      this.currentTasks = filterTasksList(freshTasks, this.currentFilter);
    }

    // Step 2: look up positions.
    const posOf = (id: string | null): string | null => {
      if (id == null) return null;
      const t = this.currentTasks.find((t) => t.id === id);
      return t?.position ?? null;
    };

    const abovePos = posOf(aboveId);
    const belowPos = posOf(belowId);

    // Step 3: compute new position.
    let newPos = between(abovePos, belowPos);

    // Step 4: top-insert guard — between(null, "0...") can return "".
    if (newPos === '' && this.currentListId) {
      const tasksInSection = this.currentTasks.filter(
        (t) => (t.section_id ?? null) === sectionId,
      );
      const orderedIds = tasksInSection.map((t) => t.id);
      const reseeded = await this.mutate(
        () => reseedPositions(this.currentListId!, sectionId, orderedIds),
        'handleDrop:reseedTopInsert',
      );
      if (reseeded === undefined) return;

      // Reload to get fresh positions.
      const freshTasks = await this.guarded(
        () => listTasks({ list: this.currentListId! }),
        'handleDrop:listTasksAfterReseed',
      );
      if (freshTasks === undefined) return;
      this.currentTasks = filterTasksList(freshTasks, this.currentFilter);

      // Recompute between with fresh positions.
      const abovePos2 = posOf(aboveId);
      const belowPos2 = posOf(belowId);
      newPos = between(abovePos2, belowPos2);
    }

    if (!newPos) {
      // Still empty after guard — this should not happen with a valid reseed.
      console.warn('[TasksController] DnD: computed empty position even after reseed; aborting drop.');
      return;
    }

    // Step 5: persist the move.
    const moved = await this.mutate(
      () => moveTask(draggedId, { listId: this.currentListId!, sectionId, position: newPos }),
      'handleDrop:moveTask',
    );
    if (moved === undefined) return;

    // Step 6: reload.
    void this.loadList(this.currentFilter);
  }

  // ── P10: Save reminders from detail panel ─────────────────────────────────

  private async handleSaveReminders(
    taskId: string,
    reminders: Array<{ kind: string; value: string }>,
  ): Promise<void> {
    const result = await this.mutate(() => editTask(taskId, { reminders }), 'handleSaveReminders');
    if (result === undefined) return;
    // Re-hydrate the pane to reflect saved state.
    void this.refreshPane(taskId);
  }

  // ── P4: populate tag filter ───────────────────────────────────────────────

  private async populateTags(): Promise<void> {
    if (!this.hasTagFilterTarget) return;
    const tags = await this.guarded(() => listTags(), 'populateTags');
    if (tags === undefined) return; // non-fatal: tag filter shows "All Tags"
    // Keep the placeholder option, add one per tag
    const placeholder = this.tagFilterTarget.querySelector('option[value=""]');
    this.tagFilterTarget.innerHTML = '';
    if (placeholder) this.tagFilterTarget.appendChild(placeholder);
    for (const tag of tags) {
      const opt = document.createElement('option');
      opt.value = tag.slug;
      opt.textContent = `${tag.name} (${tag.task_count})`;
      this.tagFilterTarget.appendChild(opt);
    }
  }

  // ── Filter action ─────────────────────────────────────────────────────────

  /**
   * applyFilter — re-fetch the list with the current filter values.
   * data-action="change->tasks#applyFilter" on filter selects.
   */
  applyFilter(): void {
    this.updateFilterCount();
    void this.loadList(this.currentFilter);
  }

  // ── List ──────────────────────────────────────────────────────────────────

  /**
   * loadList — invoke list_tasks, apply the active scope + filter, and
   * render. When the scope is a specific list, load its sections + sort
   * mode and pass `list` through to the server-side filter (unchanged from
   * pre-S5 behavior). When the scope is a smart view (Approach §4), fetch
   * WITHOUT a `list` filter (spans every list) and narrow client-side via
   * `applyScope` — the pure function `lib/tasks/scopes.ts` exists for.
   */
  async loadList(filter: TasksFilter): Promise<void> {
    const el = this.viewElements;
    showTasksListLoading(el);

    // P6: when a specific list is selected, load sections + sort mode.
    // S1 (Approach §5): currentView is a GLOBAL preference — it is loaded once
    // in connect() from localStorage and never reset or re-derived here (that
    // per-list re-derivation from `activeList.view` was exactly the D5 bug:
    // switching lists silently reflowed the layout).
    const selectedListId = this.currentScope.kind === 'list' ? this.currentScope.id : null;
    if (selectedListId !== this.currentListId) {
      this.currentListId = selectedListId;
      this.currentSections = [];
      this.currentSortMode = 'manual';
    }

    // S5: `lists` is needed both for a specific list's sections/sort_mode
    // AND for `applyScope`'s smart-view resolution (the default list id +
    // the known-id set the 'inbox' scope uses for orphan detection — see
    // scopes.ts). Fetching it unconditionally is the one new bridge call a
    // smart-view scope didn't make pre-S5 ("All Lists" never looked it up);
    // cheap per Assumption A4 (personal-scale data).
    const lists = await this.guarded(() => listLists(), 'loadList:listLists');
    // S7: cache the full list set for the bulk panel's "Move to list" select.
    this.currentLists = lists ?? [];
    this.updateWorkspaceTitle();
    if (selectedListId) {
      const activeList = lists?.find((l) => l.id === selectedListId);
      if (activeList) {
        this.currentSections = activeList.sections;
        this.currentSortMode = activeList.sort_mode;
      }
    }

    const tasks = await this.guarded(
      () =>
        listTasks({
          status: filter.status || undefined,
          list: selectedListId || undefined,
          priority: filter.priority || undefined,
          tag: filter.tag || undefined,
        }),
      'loadList:listTasks',
    );
    hideTasksListLoading(el);
    if (tasks === undefined) return; // guarded() already surfaced app:error

    // S5: narrow to the active smart view (a no-op for a list scope — the
    // server-side `list` filter above already did that id-based narrowing,
    // and filterTasksList below keeps that contract, AC-X-06).
    const scoped =
      this.currentScope.kind === 'smart' ? applyScope(tasks, this.currentScope, lists ?? []) : tasks;

    // AC-S6-10: resolve subtask breadcrumbs/progress against the FULL fetched
    // set (before applyScope narrows it) ONLY for a smart-view scope — a
    // parent with no due date of its own would otherwise be filtered out of
    // e.g. the Today view, silently blanking its child's breadcrumb chip.
    this.currentSubtaskDisplayInfo =
      this.currentScope.kind === 'smart' ? computeSubtaskDisplayInfo(tasks) : undefined;

    // Client-side filter to match the invoke filter (safety net + test surface)
    const filtered = filterTasksList(scoped, filter);

    // P9: keep a snapshot so handleDrop can look up positions by id.
    this.currentTasks = filtered;

    this.renderList();
  }

  /**
   * renderList — S3: the branch-render logic extracted out of loadList() so
   * it can also be called from selectTask()/closePane() (re-rendering just
   * the selection's aria-selected state, without a network round-trip).
   * Reads currentTasks/currentSections/currentSortMode/currentView/
   * selectedTaskId; does not fetch anything.
   */
  private renderList(): void {
    const el = this.viewElements;
    const filtered = this.currentTasks;
    const selectedListId = this.currentListId;

    const callbacks: TaskRowCallbacks = {
      // S7: click / shift-click / ctrl-cmd-click multi-select. Takes over
      // the item body's click entirely (item.ts falls back to `onNavigate`
      // only when this is omitted) — the plain-click branch below reproduces
      // the exact pre-S7 single-select-opens-the-pane behavior.
      onItemClick: (taskId, event) => {
        this.handleItemClick(taskId, event);
      },
      onStatusToggle: (taskId, currentStatus) => {
        void this.handleStatusToggle(taskId, currentStatus);
      },
      onDeleteRequest: (taskId, taskTitle) => {
        this.openDeleteDialog(taskId, taskTitle);
      },
      onCreateTask: (title, due) => {
        void this.handleCreateTask(title, due);
      },
      // ITEM 4: calendar for create-row due date
      onPickDueForCreate: (currentDue, onSelected) => {
        this.openCalendarForCreate(currentDue, onSelected);
      },
      // P8: reschedule affordance
      onReschedule: (taskId, newDue) => {
        void this.handleReschedule(taskId, newDue);
      },
      onPickDate: (taskId, currentDue) => {
        void this.openDueDatePickerForReschedule(taskId, currentDue);
      },
      // P9: DnD
      onDragStart: (_taskId) => {
        // Auto→manual flip is deferred to the drop event (only flip if the drop
        // actually happens, not just on drag start — avoids spurious list rewrites).
      },
      onDrop: (draggedId, sectionId, aboveId, belowId) => {
        void this.handleDrop(draggedId, sectionId, aboveId, belowId);
      },
      // S4: board Kanban-by-status — Reopen action + cross-column drop.
      onReopen: (taskId) => {
        void this.handleReopen(taskId);
      },
      onStatusDrop: (taskId, targetStatus) => {
        void this.handleStatusDrop(taskId, targetStatus);
      },
    };

    const sectionCallbacks: SectionCallbacks = {
      onRenameSection: (sectionId, newName) => {
        void this.handleRenameSection(sectionId, newName);
      },
      onDeleteSection: (sectionId, sectionName) => {
        this.openDeleteSectionDialog(sectionId, sectionName);
      },
      onAddSection: () => {
        this.openAddSection();
      },
      onReorderSection: (sectionId, position) => {
        void this.handleReorderSection(sectionId, position);
      },
    };

    // S3 (Approach §2): selecting a task item opens the ONE detail pane
    // beside the list — it never navigates away or swaps a page.
    const onNavigate = (kind: string, id: string) => {
      if (kind === 'tasks') {
        void this.selectTask(id);
      } else {
        this.navigateTo(kind as 'notes' | 'tasks' | 'events', id);
      }
    };

    // P6/DT-4/S4: render branch based on view + list selection.
    //
    // Gate is evaluated in view-priority order:
    //   1. Board view (ANY scope — a specific list, "All Lists", or a smart
    //      view once S5 ships): renderBoardView always wins for board now.
    //      S4 (AC-S4-07, retiring AC-S1-08) removes the `selectedListId &&`
    //      gate this branch used to carry — the board is Kanban by
    //      TaskStatus (never section), so it no longer needs a specific
    //      list's sections to render meaningfully.
    //   2. List view with sections (specific list + ≥1 section): renderListViewWithSections
    //   3. Flat list view (no list selected, or list view with no sections): renderTasksList
    //
    // DT-4 root cause (pre-S4): the old gate put `currentSections.length > 0`
    // first, so a sectionless list with board view fell through to
    // renderTasksList and ignored currentView entirely.
    if (this.currentScope.kind === 'smart' && this.currentScope.id === 'flexible') {
      renderFlexibleTaskGroups(
        el,
        this.viewTemplates,
        groupFlexibleTasks(filtered, this.currentLists),
        onNavigate,
        callbacks,
        this.selectedTaskId,
        this.currentSubtaskDisplayInfo,
        this.selectedTaskIds,
      );
    } else if (this.currentView === 'board') {
      // Board view: Kanban by TaskStatus (Todo/Doing/Done), any scope.
      el.list.classList.remove('hidden');
      el.emptyState.classList.add('hidden');
      renderBoardView(
        el.list,
        this.viewTemplates,
        filtered,
        this.currentSortMode,
        onNavigate,
        callbacks,
        this.selectedTaskId,
        this.currentSubtaskDisplayInfo,
        this.selectedTaskIds,
      );
    } else if (selectedListId && this.currentSections.length > 0) {
      // List view with sections.
      el.list.classList.remove('hidden');
      el.emptyState.classList.add('hidden');
      renderListViewWithSections(
        el.list,
        this.viewTemplates,
        filtered,
        this.currentSections,
        this.currentSortMode,
        onNavigate,
        callbacks,
        sectionCallbacks,
        this.selectedTaskId,
        this.selectedTaskIds,
      );
    } else {
      // Flat list view (no sections, or "all lists").
      // When a specific list is selected, respect its sort_mode so a drag-reorder is
      // immediately visible (manual → position asc via sortTasksForMode).
      // The "All Lists" aggregate view uses the global priority+updated sort.
      const sorted = selectedListId
        ? sortTasksForMode(filtered, this.currentSortMode)
        : sortTasksList(filtered);
      // S6 (AC-S6-13): nest children under their parent ONLY in a list scope
      // (a single list is selected) — "All Lists" renders every task standalone.
      renderTasksList(
        el,
        this.viewTemplates,
        sorted,
        onNavigate,
        callbacks,
        this.selectedTaskId,
        Boolean(selectedListId),
        this.currentSubtaskDisplayInfo,
        this.selectedTaskIds,
        // Bug B fix: a sectionless list (currentSections.length === 0) falls
        // through to this flat-list branch and would otherwise never get an
        // Add Section control (renderListViewWithSections requires >0
        // sections to render at all). "All Lists" (no selectedListId) still
        // gets none — sections are a single-list concept.
        selectedListId ? sectionCallbacks.onAddSection : undefined,
      );
    }

    // Update view toggle button state.
    this.updateViewToggleButton();
    if (this.hasSortModeSelectTarget) {
      this.sortModeSelectTarget.value = this.currentSortMode;
    }

    // S7: 2+ selected -> the pane switches to the bulk panel instead of a
    // single task's fields (Approach: "the pane switches to a bulk panel").
    // Synchronous — every selected task is already in `filtered`/currentTasks,
    // no bridge fetch needed (unlike the single-select pane, which always
    // re-hydrates via getTaskById for the D1 reason — AC-S3-05 — that does
    // not apply here: the bulk panel never reads/writes a task's `body`).
    if (this.selectedTaskIds.size >= 2) {
      this.updateBulkPanel();
    }

    initIcons();
  }

  // ── Detail pane (S3 — Approach §2) ──────────────────────────────────────────
  //
  // ONE editor, beside the list, never a page swap and never a modal. The
  // list is NEVER hidden (AC-S3-01); switching selection re-hydrates the pane
  // in place, in one click (AC-S3-02). The pane ALWAYS hydrates via
  // getTaskById — never from the list_tasks projection, whose body is always
  // "" — the structural cure for D1 (AC-S3-05).

  /**
   * openDetail — handle jin:open-detail event from RouterController (deep link).
   * data-action="jin:open-detail->tasks#openDetail" on the section element.
   */
  openDetail(event: Event): void {
    const ce = event as CustomEvent<{ id: string }>;
    if (!ce.detail?.id) return;
    void this.handleOpenDetail(ce.detail.id);
  }

  /**
   * handleOpenDetail — AC-S3-08: a deep link may reference a task outside the
   * active scope. Fetch the task first (the same getTaskById the pane always
   * uses), switch scope to its list if needed, THEN select — the list stays
   * visible and clickable throughout, never a page swap.
   *
   * S5: switching scope here is a TasksController-initiated change (not a
   * rail click), so it dispatches `jin:scope-set` — a distinct event from
   * `jin:scope-changed` — purely so `ListsController` can update its own
   * active-row indicator without looping back into another `setScope()`
   * reload (see lists_controller.ts's class doc comment).
   */
  private async handleOpenDetail(taskId: string): Promise<void> {
    // S7: a deep link is always a single-task selection — abandon any active
    // bulk multi-selection so the invariant (exactly one of `selectedTaskId`
    // set / `selectedTaskIds.size >= 2`) holds regardless of entry point.
    this.selectedTaskIds.clear();
    const task = await this.fetchTaskForPane(taskId);
    if (task === undefined) return;
    if (task.list !== this.currentListId) {
      this.currentScope = { kind: 'list', id: task.list };
      this.updateWorkspaceTitle();
      this.dispatch('scope-set', { detail: { scope: this.currentScope }, prefix: 'jin', bubbles: true });
      await this.loadList(this.currentFilter);
    }
    this.selectedTaskId = taskId;
    this.renderList();
    this.setDetailOpen(true);
    await this.hydratePaneFromTask(task);
  }

  /**
   * selectTask — an item click selects it: the pane opens BESIDE the list
   * (which never gets a `.hidden` class — AC-S3-01) and re-hydrates in a
   * single click, with no intermediate back navigation (AC-S3-02).
   */
  private async selectTask(taskId: string): Promise<void> {
    // S7: a plain single-item select always wins over any active bulk
    // multi-selection (same invariant as handleOpenDetail above).
    this.selectedTaskIds.clear();
    this.selectedTaskId = taskId;
    this.renderList();
    this.setDetailOpen(true);
    this.viewElements.detailContent.innerHTML = '';
    const task = await this.fetchTaskForPane(taskId);
    if (task === undefined) return;
    // S7: guard against a stale/superseded call clobbering a NEWER selection
    // made while this fetch was in flight (e.g. a rapid ctrl-click sequence
    // that moved on to bulk-select mode before this single-select's fetch
    // resolved) — same pattern `refreshPane` already uses below.
    if (this.selectedTaskId !== taskId) return;
    await this.hydratePaneFromTask(task);
  }

  /**
   * refreshPane — re-hydrate the pane for a task that is already selected
   * (used after a save whose effect the pane's own fields must reflect,
   * e.g. status — legal next-statuses change with the new status).
   */
  private async refreshPane(taskId: string): Promise<void> {
    if (this.selectedTaskId !== taskId) return;
    const task = await this.fetchTaskForPane(taskId);
    if (task === undefined) return;
    await this.hydratePaneFromTask(task);
  }

  /**
   * closePane — AC-S3-09: Escape or the pane's own close (X) control clears
   * the selection and collapses the pane.
   */
  private closePane(): void {
    this.selectedTaskId = null;
    this.setDetailOpen(false);
    this.viewElements.detailContent.innerHTML = '';
    this.renderList();
  }

  /** setDetailOpen — toggles the `.tasks-main--detail-open` grid-track class. */
  private setDetailOpen(open: boolean): void {
    if (this.hasMainTarget) {
      this.mainTarget.classList.toggle('tasks-main--detail-open', open);
    }
    if (open && this.isFiltersConstrained()) this.filtersExpanded = false;
    this.updateFilterDisclosure();
  }

  // ── S7: bulk multi-select (Approach: "click, shift-click range, cmd/ctrl-
  // click toggle") ───────────────────────────────────────────────────────────

  /**
   * handleItemClick — the item body's click, routed here instead of straight
   * to `onNavigate` (Approach §2's plain-click flow) whenever the render
   * layer wires `onItemClick` (every call site in `renderList()` does).
   * Reads the raw click's modifier keys to pick one of the three multi-
   * select interactions:
   *   - shift-click  -> range-select from the last anchor to this item
   *   - ctrl/cmd-click -> toggle this item's membership in the selection
   *   - plain click  -> single-select (the exact pre-S7 behavior: clears any
   *     bulk selection, opens the ONE detail pane for this item)
   */
  private handleItemClick(taskId: string, event: MouseEvent): void {
    if (event.shiftKey) {
      this.selectRange(taskId);
    } else if (event.ctrlKey || event.metaKey) {
      this.toggleSelection(taskId);
    } else {
      this.selectedTaskIds.clear();
      this.selectionAnchorId = taskId;
      void this.selectTask(taskId);
    }
  }

  /**
   * toggleSelection — ctrl/cmd-click: add/remove `taskId` from the bulk
   * selection. Promotes an existing single selection (`selectedTaskId`) into
   * the bulk set on the FIRST toggle, so ctrl-clicking a second item after a
   * plain click extends from one selected item to two, matching ordinary
   * file-manager multi-select conventions. Normalizes back down to
   * single-select mode (or fully clears) when the set shrinks below 2 —
   * `renderList()` only ever renders the bulk panel at size >= 2 (AC-S7-01/02).
   */
  private toggleSelection(taskId: string): void {
    if (this.selectedTaskIds.size === 0 && this.selectedTaskId && this.selectedTaskId !== taskId) {
      this.selectedTaskIds.add(this.selectedTaskId);
    }
    if (this.selectedTaskIds.has(taskId)) {
      this.selectedTaskIds.delete(taskId);
    } else {
      this.selectedTaskIds.add(taskId);
    }
    this.selectionAnchorId = taskId;

    if (this.selectedTaskIds.size >= 2) {
      this.selectedTaskId = null;
      this.setDetailOpen(true);
      this.renderList();
    } else if (this.selectedTaskIds.size === 1) {
      const [onlyId] = this.selectedTaskIds;
      this.selectedTaskIds.clear();
      void this.selectTask(onlyId);
    } else {
      this.clearSelection();
    }
  }

  /**
   * selectRange — shift-click: select every item between the last anchor and
   * `taskId`, inclusive, in the currently rendered flat order
   * (`computeSelectionRange`, lib/tasks/bulk.ts pure helper). Falls back to a
   * plain single-select on `taskId` when there is no anchor to range from
   * (the pure helper's own fallback for an anchor outside the current set).
   */
  private selectRange(taskId: string): void {
    const anchor = this.selectionAnchorId ?? this.selectedTaskId;
    if (!anchor) {
      this.selectionAnchorId = taskId;
      this.selectedTaskIds.clear();
      void this.selectTask(taskId);
      return;
    }
    const order = this.currentTasks.map((t) => t.id);
    const range = computeSelectionRange(order, anchor, taskId);
    this.selectedTaskIds = new Set(range.length > 0 ? range : [taskId]);

    if (this.selectedTaskIds.size >= 2) {
      this.selectedTaskId = null;
      this.setDetailOpen(true);
      this.renderList();
    } else {
      const [onlyId] = this.selectedTaskIds;
      this.selectedTaskIds.clear();
      void this.selectTask(onlyId ?? taskId);
    }
  }

  /** clearSelection — abandon the bulk selection entirely and close the pane. */
  private clearSelection(): void {
    this.selectedTaskIds.clear();
    this.selectionAnchorId = null;
    this.closePane();
  }

  /**
   * updateBulkPanel — render the bulk panel for the current
   * `selectedTaskIds` (called from `renderList()` whenever size >= 2).
   * `statusOptions` is the INTERSECTION of `legalNextStatuses` across the
   * whole selection (AC-S7-02) — never a union, never re-derived by hand.
   */
  private updateBulkPanel(): void {
    const el = this.viewElements;
    const selected = this.currentTasks.filter((t) => this.selectedTaskIds.has(t.id));
    const statusOptions = intersectLegalNextStatuses(selected);
    const availableLists = this.currentLists.map((l) => ({ id: l.id, name: l.name }));

    const bulkCallbacks: BulkPanelCallbacks = {
      onSetStatus: (status) => {
        void this.runBulkStatusChange(status);
      },
      onMoveToList: (listId) => {
        void this.runBulkMoveToList(listId);
      },
      onDelete: () => {
        this.openBulkDeleteDialog();
      },
      onClearSelection: () => {
        this.clearSelection();
      },
    };

    renderBulkPanel(el, selected.length, statusOptions, availableLists, bulkCallbacks);
    JinSelect.enhanceAll(el.detailContent);
  }

  /**
   * openBulkDeleteDialog — reuses the SAME `_deleteConfirmModal` the single-
   * task delete flow uses (Approach: "confirmations use JinModal/ConfirmDialog",
   * never `window.confirm`). `confirmDeleteTask()` branches on
   * `pendingBulkDeleteIds` vs. `pendingDeleteId` to run the right path.
   */
  private openBulkDeleteDialog(): void {
    if (!this._deleteConfirmModal) return;
    const ids = [...this.selectedTaskIds];
    if (ids.length === 0) return;
    this.pendingBulkDeleteIds = ids;
    this._deleteConfirmModal.updateMessage(
      `Delete ${ids.length} tasks? This cannot be undone.`,
    );
    this._deleteConfirmModal.open();
  }

  /**
   * runBulkStatusChange — AC-S7-02's status control fires this with a value
   * that is ALWAYS a member of the intersection (the select never renders
   * anything else) — never re-validated here, `updateBulkPanel` is the one
   * place that computes the offered set.
   *
   * S6 interaction (bulk-selecting a parent AND its child): `done`/
   * `cancelled` are the two statuses core cascades from a parent down to its
   * open children (Approach §6). If both a parent and one of its children
   * are in the selection AND the target is one of those two, the child is
   * excluded from its own bridge call (`partitionCascadingChildren`) — the
   * parent's call already cascades it, and a redundant explicit call would
   * either double-apply or (done -> done, cancelled -> cancelled not being
   * legal self-transitions) surface a false failure and corrupt the honest
   * "N of M" count. The excluded child is still counted as succeeded.
   */
  private async runBulkStatusChange(status: string): Promise<void> {
    const ids = [...this.selectedTaskIds];
    if (ids.length === 0) return;
    const tasksById = new Map(this.currentTasks.map((t) => [t.id, t]));
    const cascades = status === 'done' || status === 'cancelled';
    const { toApply, cascaded } = cascades
      ? partitionCascadingChildren(ids, tasksById)
      : { toApply: ids, cascaded: [] as string[] };

    const { succeeded, failed } = await runBulkOperation(toApply, (id) =>
      this.guarded(() => setTaskStatus(id, status), 'runBulkStatusChange'),
    );

    this.finishBulkOperation('updated', ids.length, succeeded.length + cascaded.length, failed);
  }

  /**
   * runBulkMoveToList — a parent's `list` change cascades to every child
   * (Approach §6: "a subtask lives with its parent"), so the same
   * cascade-skip applies here unconditionally (not gated on a target value,
   * unlike status — every move-to-list cascades).
   */
  private async runBulkMoveToList(listId: string): Promise<void> {
    const ids = [...this.selectedTaskIds];
    if (ids.length === 0) return;
    const tasksById = new Map(this.currentTasks.map((t) => [t.id, t]));
    const { toApply, cascaded } = partitionCascadingChildren(ids, tasksById);

    const { succeeded, failed } = await runBulkOperation(toApply, (id) =>
      this.guarded(() => editTask(id, { list: listId }), 'runBulkMoveToList'),
    );

    this.finishBulkOperation('moved', ids.length, succeeded.length + cascaded.length, failed);
  }

  /**
   * runBulkDelete — a parent's soft-delete cascades to every child
   * (AC-S6-09), so the cascade-skip applies unconditionally here too, exactly
   * as for move-to-list.
   */
  private async runBulkDelete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const tasksById = new Map(this.currentTasks.map((t) => [t.id, t]));
    const { toApply, cascaded } = partitionCascadingChildren(ids, tasksById);

    const { succeeded, failed } = await runBulkOperation(toApply, (id) =>
      this.guarded(() => deleteTask(id), 'runBulkDelete'),
    );

    this.finishBulkOperation('deleted', ids.length, succeeded.length + cascaded.length, failed);
  }

  /**
   * finishBulkOperation — the ONE place a bulk batch settles (Approach §8's
   * deliberate exception to "mutate() dispatches once per call"): the N
   * calls above all went through `guarded()` only (never `mutate()`, which
   * would fire N `jin:tasks-changed` events), so nothing has dispatched yet.
   *
   * AC-S7-08: dispatch `jin:tasks-changed` exactly ONCE here, unconditionally
   * — never zero (stale sidebar counts, S5's whole complaint) and never N
   * (thrash) — regardless of how many of the N calls succeeded, INCLUDING a
   * partial failure.
   *
   * AC-S7-03/05/06: report the honest count through `app:error` — "`N` of
   * `M`" — whenever at least one attempted call failed; never silently
   * succeed and never silently abort (the batch always finishes attempting
   * every remaining id regardless — see `runBulkOperation`).
   */
  private finishBulkOperation(
    verb: string,
    total: number,
    succeededCount: number,
    failedIds: string[],
  ): void {
    this.dispatch('tasks-changed', { prefix: 'jin', bubbles: true });

    if (failedIds.length > 0) {
      this.dispatch('error', {
        detail: toSyntheticErrorDto(
          new Error(`${succeededCount} of ${total} tasks ${verb}`),
          'bulkOperation',
        ),
        prefix: 'app',
        bubbles: true,
      });
    }

    this.clearSelection();
    void this.loadList(this.currentFilter);
  }

  // ── S7: keyboard flow ─────────────────────────────────────────────────────

  /**
   * isTypingTarget — true when `target` is a native editing/choice control or
   * an editable region. Global task navigation must not consume keystrokes
   * that belong to an open select or a user's text caret.
   */
  private isTypingTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    return el.tagName === 'INPUT'
      || el.tagName === 'TEXTAREA'
      || el.tagName === 'SELECT'
      || el.isContentEditable;
  }

  /**
   * moveSelection — ArrowUp/ArrowDown (AC-S7-04): move the single-select
   * cursor to the next/previous item in the currently rendered flat order.
   * Deliberately does NOT fetch/open the pane (closes it if one was already
   * open, to avoid showing stale data for the newly-highlighted item) —
   * Enter is what commits to opening it (AC-S7-05). Always collapses any
   * active bulk selection first (arrow-nav is a single-item concern).
   */
  private moveSelection(delta: number): void {
    if (this.currentTasks.length === 0) return;
    const currentIndex = this.selectedTaskId
      ? this.currentTasks.findIndex((t) => t.id === this.selectedTaskId)
      : -1;
    const nextIndex =
      currentIndex === -1
        ? delta > 0
          ? 0
          : this.currentTasks.length - 1
        : Math.max(0, Math.min(this.currentTasks.length - 1, currentIndex + delta));
    const nextTask = this.currentTasks[nextIndex];
    if (!nextTask) return;

    this.selectedTaskIds.clear();
    this.selectedTaskId = nextTask.id;
    this.selectionAnchorId = nextTask.id;
    this.setDetailOpen(false);
    this.viewElements.detailContent.innerHTML = '';
    this.renderList();
    this.focusItemElement(nextTask.id);
  }

  /** focusItemElement — real DOM focus (roving tabindex), not a CSS-only highlight. */
  private focusItemElement(taskId: string): void {
    const body = this.listTarget.querySelector<HTMLElement>(
      `[data-task-id="${taskId}"] .task-item__body`,
    );
    body?.focus();
  }

  /** focusQuickAdd — `n` shortcut (AC-S7-07): focus the always-visible add-task input. */
  private focusQuickAdd(): void {
    const input = this.listTarget.querySelector<HTMLInputElement>('.task-add-input');
    input?.focus();
  }

  /** selectTaskAndFocusTitle — Enter (AC-S7-05): open the pane, then focus its title. */
  private async selectTaskAndFocusTitle(taskId: string): Promise<void> {
    await this.selectTask(taskId);
    const titleEl = this.viewElements.detailContent.querySelector<HTMLElement>(
      '.browse-detail__title',
    );
    titleEl?.focus();
  }

  /**
   * fetchTaskForPane — the ONE fetch path the pane ever hydrates from
   * (AC-S3-05): always `getTaskById`, never the `list_tasks` projection
   * (whose `body` is always `""`). Handles the not-found (code 3) case with
   * the dedicated inline state; any other rejection surfaces via app:error
   * (AC-X-05) rather than being silently swallowed.
   */
  private async fetchTaskForPane(taskId: string): Promise<TaskDto | undefined> {
    const el = this.viewElements;
    el.detailLoadingState.classList.remove('hidden');
    el.detailNotFoundState.classList.add('hidden');
    try {
      const task = await getTaskById(taskId);
      el.detailLoadingState.classList.add('hidden');
      return task;
    } catch (err: unknown) {
      el.detailLoadingState.classList.add('hidden');
      if (isJinErrorDto(err) && err.code === 3) {
        el.detailNotFoundState.classList.remove('hidden');
      } else {
        const dto = isJinErrorDto(err) ? err : toSyntheticErrorDto(err, 'fetchTaskForPane');
        this.dispatch('error', { detail: dto, prefix: 'app', bubbles: true });
      }
      return undefined;
    }
  }

  /**
   * hydratePaneFromTask — populate the field-selector data (lists/sections/
   * tags) and render the pane for an already-fetched task. Every field save
   * goes through mutate() (Approach §8 / AC-X-05 / AC-X-08); title/status/
   * list additionally refresh the pane itself since its own field set
   * depends on the changed value (legal next-statuses, available sections).
   * Every save also reloads the list so the affected row stays in sync,
   * beside the pane, in place (S3 action plan item 7).
   */
  private async hydratePaneFromTask(task: TaskDto): Promise<void> {
    const el = this.viewElements;
    el.detailNotFoundState.classList.add('hidden');

    let availableLists: Array<{ id: string; name: string }> = [];
    let availableSections: SectionDto[] = [];
    let allTagSlugs: string[] = [];
    // S8 (AC-S8-02): slug -> color, for the tag color picker's preselect and
    // the chip's own color dot.
    let tagColors: Record<string, string> = {};

    const lists = await this.guarded(() => listLists(), 'hydratePane:listLists');
    if (lists !== undefined) {
      availableLists = lists.map((l) => ({ id: l.id, name: l.name }));
      const activeList = lists.find((l) => l.id === task.list);
      if (activeList) availableSections = activeList.sections;
    }
    const tags = await this.guarded(() => listTags(), 'hydratePane:listTags');
    if (tags !== undefined) {
      allTagSlugs = tags.map((t) => t.slug);
      tagColors = Object.fromEntries(tags.map((t) => [t.slug, t.color]));
    }

    // S6: subtasks — fetched fresh (independent of the active filter bar, so
    // a status/priority/tag filter can never hide a child from its parent's
    // Subtasks section) and scoped to the parent's OWN list (children always
    // share their parent's list — Approach §6 cascade).
    let subtasks: TaskDto[] = [];
    if (!task.parent) {
      const listTaskDtos = await this.guarded(
        () => listTasks({ list: task.list }),
        'hydratePane:listTasksForSubtasks',
      );
      if (listTaskDtos !== undefined) {
        subtasks = listTaskDtos.filter((t) => t.parent === task.id);
      }
    }

    const detailCbs: TaskDetailCallbacks = {
      onSaveTitle: async (taskId, title) => {
        const result = await this.mutate(() => editTask(taskId, { title }), 'onSaveTitle');
        if (result === undefined) return;
        void this.loadList(this.currentFilter);
        void this.refreshPane(taskId);
      },
      onSaveBody: async (taskId, body) => {
        const result = await this.mutate(() => editTask(taskId, { body }), 'onSaveBody');
        if (result === undefined) return;
        void this.loadList(this.currentFilter);
      },
      onSaveStatus: async (taskId, status) => {
        const result = await this.mutate(() => setTaskStatus(taskId, status), 'onSaveStatus');
        if (result === undefined) return;
        void this.loadList(this.currentFilter);
        void this.refreshPane(taskId);
      },
      onSavePriority: async (taskId, priority) => {
        const result = await this.mutate(() => editTask(taskId, { priority }), 'onSavePriority');
        if (result === undefined) return;
        void this.loadList(this.currentFilter);
      },
      onPickDue: (currentDue, onSelected) => {
        this.openCalendarForDetail(currentDue, (dueString) => {
          const editInput = dueString
            ? { due: dueString }
            : { clear_due: true as const };
          void (async () => {
            const result = await this.mutate(() => editTask(task.id, editInput), 'onPickDue');
            if (result !== undefined) void this.loadList(this.currentFilter);
          })();
          onSelected(dueString);
        });
      },
      onClearDue: async (taskId) => {
        const result = await this.mutate(() => editTask(taskId, { clear_due: true }), 'onClearDue');
        if (result === undefined) return;
        void this.loadList(this.currentFilter);
      },
      onSaveList: async (taskId, listId) => {
        const result = await this.mutate(() => editTask(taskId, { list: listId }), 'onSaveList');
        if (result === undefined) return;
        void this.loadList(this.currentFilter);
        void this.refreshPane(taskId);
      },
      onSaveSection: async (taskId, sectionId) => {
        const result = sectionId
          ? await this.mutate(() => editTask(taskId, { section_id: sectionId }), 'onSaveSection')
          : await this.mutate(() => editTask(taskId, { clear_section: true }), 'onSaveSection');
        if (result === undefined) return;
        void this.loadList(this.currentFilter);
      },
      onSaveTags: async (taskId, tags) => {
        const result = await this.mutate(() => editTask(taskId, { tags }), 'onSaveTags');
        if (result === undefined) return;
        void this.loadList(this.currentFilter);
      },
      // S8 (AC-S8-02): tag color picker.
      tagColors,
      onPickTagColor: (slug, currentColor) => {
        this.openTagColorPicker(slug, currentColor);
      },
      availableLists,
      availableSections,
      allTagSlugs,
      // ── S6: Subtasks section ────────────────────────────────────────────
      subtasks,
      onAddSubtask: (parentId, title) => {
        void (async () => {
          const result = await this.mutate(
            () => createTask({ title, list: task.list, parent: parentId }),
            'onAddSubtask',
          );
          if (result === undefined) return;
          void this.loadList(this.currentFilter);
          void this.refreshPane(parentId);
        })();
      },
      onToggleSubtaskStatus: (subtaskId, currentStatus) => {
        void this.handleStatusToggle(subtaskId, currentStatus).then(() => {
          void this.refreshPane(task.id);
        });
      },
      onDeleteSubtask: (subtaskId, subtaskTitle) => {
        this.openDeleteDialog(subtaskId, subtaskTitle);
      },
      onSelectSubtask: (subtaskId) => {
        void this.selectTask(subtaskId);
      },
    };

    renderTaskPane(
      el,
      this.viewTemplates,
      task,
      (kind, targetId) => { this.navigateTo(kind, targetId); },
      (taskId) => { this.openPromoteDialog(taskId); },
      (taskId, reminders) => { void this.handleSaveReminders(taskId, reminders); },
      detailCbs,
      () => { this.closePane(); },
      (taskId, taskTitle) => { this.openDeleteDialog(taskId, taskTitle); },
    );

    JinSelect.enhanceAll(el.detailContent);
    initIcons();
  }

  // ── P1 S1.1 — Status toggle (complete/reopen) ─────────────────────────────

  private async handleStatusToggle(taskId: string, currentStatus: string): Promise<void> {
    // legal transitions per task.rs:39-51
    const nextStatus = currentStatus === 'done' ? 'todo' : 'done';

    const result = await this.mutate(() => setTaskStatus(taskId, nextStatus), 'handleStatusToggle');
    if (result === undefined) return;
    // Reload list to reflect new status (optimistic update handled by class + reload)
    void this.loadList(this.currentFilter);
  }

  // ── S4: board Kanban-by-status — Reopen action + cross-column drop ───────

  /**
   * AC-S4-06: a `done` board card's explicit Reopen action — the FSM's one
   * legal way back (`done -> todo`). Goes through mutate() like every other
   * task-mutating call (Approach §8 / AC-X-08) — the board drag inherits
   * the same `jin:tasks-changed` dispatch; this does not add a second one.
   */
  private async handleReopen(taskId: string): Promise<void> {
    const result = await this.mutate(() => setTaskStatus(taskId, 'todo'), 'handleReopen');
    if (result === undefined) return;
    void this.loadList(this.currentFilter);
  }

  /**
   * handleStatusDrop — AC-S4-03: a cross-column drop on the board IS a
   * status transition. The column that accepted the drop (render.ts) has
   * already refused the interaction entirely for any status that is not a
   * legal successor of the dragged task (AC-S4-04/05 — the illegal column
   * never calls `preventDefault()` on `dragover`, so `drop` never fires
   * there at all), so `targetStatus` here is always legal.
   */
  private async handleStatusDrop(taskId: string, targetStatus: string): Promise<void> {
    const result = await this.mutate(() => setTaskStatus(taskId, targetStatus), 'handleStatusDrop');
    if (result === undefined) return;
    void this.loadList(this.currentFilter);
  }

  // ── P1 S1.3 — Delete task (S2: now uses ConfirmDialog) ───────────────────

  private openDeleteDialog(taskId: string, taskTitle: string): void {
    // S2: No more hasDeleteTaskDialogTarget guard — the ConfirmDialog is a
    // direct JS reference (composition), independent of Stimulus subtree scoping.
    if (!this._deleteConfirmModal) return;
    this.pendingDeleteId = taskId;
    this._deleteConfirmModal.updateMessage(
      `Delete "${taskTitle}"? This cannot be undone.`,
    );
    this._deleteConfirmModal.open();
  }

  /** Legacy close action — delegates to the ConfirmDialog (which self-closes). */
  closeDeleteTask(): void {
    this._deleteConfirmModal?.close();
    this.pendingDeleteId = null;
    this.pendingBulkDeleteIds = null;
  }

  async confirmDeleteTask(): Promise<void> {
    // Called by ConfirmDialog.onConfirm — the SAME modal instance the
    // single-task delete flow uses (openBulkDeleteDialog reuses it rather
    // than opening a second confirm surface). S7: a pending BULK delete
    // takes priority — openBulkDeleteDialog/openDeleteDialog never set both.
    if (this.pendingBulkDeleteIds) {
      const ids = this.pendingBulkDeleteIds;
      this.pendingBulkDeleteIds = null;
      await this.runBulkDelete(ids);
      return;
    }

    // Called by ConfirmDialog.onConfirm. The dialog self-closes after this returns.
    if (!this.pendingDeleteId) return;
    const id = this.pendingDeleteId;
    this.pendingDeleteId = null;

    const result = await this.mutate(() => deleteTask(id), 'confirmDeleteTask');
    if (result === undefined) return;
    // S3 (AC-S3-07): deleting the task currently open in the pane closes it —
    // there is nothing left to show.
    if (this.selectedTaskId === id) {
      this.selectedTaskId = null;
      this.setDetailOpen(false);
      this.viewElements.detailContent.innerHTML = '';
    } else if (this.selectedTaskId) {
      // S6: the deleted task may have been a subtask of the currently open
      // pane — refresh it so the Subtasks section drops the deleted row.
      void this.refreshPane(this.selectedTaskId);
    }
    void this.loadList(this.currentFilter);
  }

  // ── P1 S1.4 — Create-in-place ────────────────────────────────────────────
  // Note: the static addTaskInput target is removed; creation is handled by the
  // dynamic buildAddTaskRow (onCreateTask callback) rendered per list/section.

  private async handleCreateTask(title: string, due?: string): Promise<void> {
    // S6: pass currentListId so tasks created in-list land in the correct list.
    // currentListId holds the list id (never a display name — it comes from the
    // id-valued list filter / selection). null → undefined so the backend defaults.
    const result = await this.mutate(
      () => createTask({ title, due, list: this.currentListId ?? undefined }),
      'handleCreateTask',
    );
    if (result === undefined) return;
    void this.loadList(this.currentFilter);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private navigateTo(kind: 'notes' | 'tasks' | 'events', id: string): void {
    this.dispatch('navigate', {
      detail: { kind, id },
      prefix: 'jin',
      bubbles: true,
    });
  }

  private openPromoteDialog(taskId: string): void {
    this.dispatch('open-promote', {
      detail: { taskId },
      prefix: 'jin',
      bubbles: true,
    });
  }

  /**
   * currentFilter — status/priority/tag ONLY. S5: `list` is no longer read
   * from a shared `<select>` — scope (which list, or which smart view) is
   * owned entirely by `currentScope` / `jin:scope-changed` (Approach §4).
   * `TasksFilter.list` stays declared in transform.ts (`filterTasksList`
   * keeps matching it — AC-X-06); this controller simply never populates it,
   * which `filterTasksList` already treats as "no list filter" (a no-op).
   */
  private get currentFilter(): TasksFilter {
    return {
      status: this.statusFilterTarget.value || undefined,
      priority: this.priorityFilterTarget.value || undefined,
      tag: this.hasTagFilterTarget ? (this.tagFilterTarget.value || undefined) : undefined,
    };
  }

  private get viewElements(): TasksViewElements {
    return {
      listPanel: this.listPanelTarget,
      list: this.listTarget,
      emptyState: this.emptyStateTarget,
      loadingState: this.loadingStateTarget,
      detailPanel: this.detailPanelTarget,
      detailLoadingState: this.detailLoadingStateTarget,
      detailNotFoundState: this.detailNotFoundStateTarget,
      detailContent: this.detailContentTarget,
    };
  }

  private get viewTemplates(): TasksTemplates {
    // S2: #tmpl-task-row retired — #tmpl-task-item is the ONE template cloned
    // for both the List row and the Board card (lib/tasks/item.ts).
    const taskItemEl = document.getElementById('tmpl-task-item') as HTMLTemplateElement | null;
    const backlinkRowEl = document.getElementById(
      'tmpl-backlink-row'
    ) as HTMLTemplateElement | null;
    if (!taskItemEl || !backlinkRowEl) {
      throw new Error(
        '[TasksController] required <template> elements not found. ' +
          'Ensure #tmpl-task-item and #tmpl-backlink-row are present in the document.'
      );
    }
    return { taskItem: taskItemEl, backlinkRow: backlinkRowEl };
  }
}
