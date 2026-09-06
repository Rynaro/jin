/**
 * NotesController — Stimulus controller for the Notes browse + detail view (GUI-S4).
 *
 * Wave 2A additions: 3-pane layout with folder rail.
 *   - loadFolders() populates the folder rail via listFolders() + renderFolderRail().
 *   - selectFolder(path) updates currentFolder and reloads the note list filtered by folder.
 *   - newFolder() prompts for a folder name and calls createFolder().
 *
 * Data flow (list):
 *   loadFolders() → FolderDto[] → renderFolderRail()
 *   listNotes({folder}) → NoteDto[] → sortNotesList() → renderNotesList()
 *
 * Data flow (detail):
 *   getNoteById(id) → NoteDto → renderNoteDetail()
 *
 * Navigation: clicking a note row opens the detail (local state).
 *            clicking a backlink/link dispatches jin:navigate (caught by RouterController).
 *
 * Connect pattern: data-controller="notes" on the notes <section> element.
 * Required <template> elements in the document:
 *   #tmpl-note-row       — note list row shell
 *   #tmpl-backlink-row   — link/backlink item shell (shared)
 *   #tmpl-folder-row     — folder rail row shell (Wave 2A)
 *
 * Targets:
 *   folderRail          — folder rail container (Wave 2A)
 *   folderList          — <ul> for folder rail rows (Wave 2A)
 *   listPanel           — wraps the list + empty/loading states
 *   list                — <ul> for note rows
 *   emptyState          — shown when list is empty
 *   loadingState        — shown while list invoke is in-flight
 *   detailPanel         — wraps the detail content area
 *   detailLoadingState  — shown while detail invoke is in-flight
 *   detailNotFoundState — shown when get_note returns not-found
 *   detailContent       — populated by renderNoteDetail()
 *
 * Actions:
 *   notes#showList         — back button in detail panel
 *   notes#openDetail       — jin:open-detail event handler (from RouterController)
 *   notes#newFolder        — "New Folder" button in folder rail
 */

import { Controller } from '@hotwired/stimulus';
import {
  listNotes,
  getNoteById,
  listFolders,
  createFolder,
  editNote,
  createNote,
  searchNotes,
  listCollections,
  createCollection,
  renameCollection as renameCollectionInvoke,
  deleteCollection as deleteCollectionInvoke,
  evaluateCollection,
  importAttachment,
  listNoteRevisions,
  previewNoteRevision,
  restoreNoteRevision,
  moveNote as moveNoteInvoke,
  renameFolder as renameFolderInvoke,
  deleteFolder as deleteFolderInvoke,
} from '../invoke';
import { isJinErrorDto } from '../types/error';
import type { CollectionDto, CollectionFilterDto, CollectionQueryDto } from '../types/dto';
import { renderFormError, clearFormError } from '../lib/capture/render';
import { filterNotesList, sortNotesList, formatNoteDate, noteDisplayTitle, type NotesFilter } from '../lib/notes/transform';
import {
  type NotesViewElements,
  type NotesTemplates,
  showListLoading,
  hideListLoading,
  renderNotesList,
  renderNoteDetail,
  renderFolderTree,
  setTreeItemExpanded,
  focusTreeItem,
} from '../lib/notes/render';
import type { EditorHandle } from '../lib/notes/editor';
import { initIcons } from '../lib/icons';
import {
  buildFolderTree,
  flattenVisible,
  resolveTreeKey,
  type TreeNode,
} from '../lib/notes/folderTree';
import {
  loadFolderTreePrefs,
  saveFolderTreePrefs,
} from '../lib/notes/folderTreePrefs';

export default class NotesController extends Controller {
  // ── Targets ───────────────────────────────────────────────────────────────
  static targets = [
    'folderRail',
    'folderList',
    'listPanel',
    'list',
    'emptyState',
    'loadingState',
    'detailPanel',
    'detailLoadingState',
    'detailNotFoundState',
    'detailContent',
    // item 1 + 3: header action cluster + path breadcrumb
    'detailActions',
    'detailBreadcrumb',
    'newFolderModal',
    'newFolderInput',
    'newFolderError',
    // folder-mgmt dialogs (S3/S5)
    'renameFolderModal',
    'renameFolderInput',
    'renameFolderError',
    'deleteFolderModal',
    'deleteFolderMessage',
    // Search + declarative collections
    'searchInput',
    'searchCount',
    'scopeTitle',
    'collectionList',
    'allNotesButton',
    'collectionModal',
    'collectionNameInput',
    'collectionFilterInput',
    'collectionFilterValueInput',
    'collectionSortInput',
    'collectionDirectionInput',
    'collectionError',
    'renameCollectionModal',
    'renameCollectionInput',
    'renameCollectionError',
    'deleteCollectionModal',
    'deleteCollectionMessage',
    // History / restore
    'historyModal',
    'historyStatus',
    'historyRevisionList',
    'historyPreview',
    'restoreRevisionButton',
    'restoreRevisionConfirmModal',
    'restoreRevisionMessage',
    // Persistent local conflict presentation
    'conflictPanel',
    'conflictMessage',
    'conflictStatus',
    'conflictReloadModal',
  ];

  declare folderRailTarget: HTMLElement;
  declare folderListTarget: HTMLElement;
  declare listPanelTarget: HTMLElement;
  declare listTarget: HTMLElement;
  declare emptyStateTarget: HTMLElement;
  declare loadingStateTarget: HTMLElement;
  declare detailPanelTarget: HTMLElement;
  declare detailLoadingStateTarget: HTMLElement;
  declare detailNotFoundStateTarget: HTMLElement;
  declare detailContentTarget: HTMLElement;
  /** Header container for icon-only attach/link action buttons (item 1). */
  declare detailActionsTarget: HTMLElement;
  /** Breadcrumb span showing the current folder path in the detail header (item 3). */
  declare detailBreadcrumbTarget: HTMLElement;
  declare newFolderModalTarget: HTMLDialogElement;
  declare newFolderInputTarget: HTMLInputElement;
  declare newFolderErrorTarget: HTMLElement;
  // folder-mgmt dialog targets (S5)
  declare renameFolderModalTarget: HTMLDialogElement;
  declare renameFolderInputTarget: HTMLInputElement;
  declare renameFolderErrorTarget: HTMLElement;
  declare deleteFolderModalTarget: HTMLDialogElement;
  declare deleteFolderMessageTarget: HTMLElement;
  declare searchInputTarget: HTMLInputElement;
  declare searchCountTarget: HTMLElement;
  declare scopeTitleTarget: HTMLHeadingElement;
  declare collectionListTarget: HTMLElement;
  declare allNotesButtonTarget: HTMLButtonElement;
  declare collectionModalTarget: HTMLDialogElement;
  declare collectionNameInputTarget: HTMLInputElement;
  declare collectionFilterInputTarget: HTMLSelectElement;
  declare collectionFilterValueInputTarget: HTMLInputElement;
  declare collectionSortInputTarget: HTMLSelectElement;
  declare collectionDirectionInputTarget: HTMLSelectElement;
  declare collectionErrorTarget: HTMLElement;
  declare renameCollectionModalTarget: HTMLDialogElement;
  declare renameCollectionInputTarget: HTMLInputElement;
  declare renameCollectionErrorTarget: HTMLElement;
  declare deleteCollectionModalTarget: HTMLDialogElement;
  declare deleteCollectionMessageTarget: HTMLElement;
  declare historyModalTarget: HTMLDialogElement;
  declare historyStatusTarget: HTMLElement;
  declare historyRevisionListTarget: HTMLElement;
  declare historyPreviewTarget: HTMLElement;
  declare restoreRevisionButtonTarget: HTMLButtonElement;
  declare restoreRevisionConfirmModalTarget: HTMLDialogElement;
  declare restoreRevisionMessageTarget: HTMLElement;
  declare conflictPanelTarget: HTMLElement;
  declare conflictMessageTarget: HTMLElement;
  declare conflictStatusTarget: HTMLElement;
  declare conflictReloadModalTarget: HTMLDialogElement;

  // ── State ─────────────────────────────────────────────────────────────────

  /** Currently selected folder path. `undefined` = show all (no filter). */
  private currentFolder: string | undefined = undefined;
  /** Active saved collection. Folders and collections are mutually exclusive scopes. */
  private currentCollectionId: string | null = null;
  private collections: CollectionDto[] = [];
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private searchRequestId = 0;

  /** ID of the note currently shown in the detail panel. */
  private currentNoteId: string | null = null;

  /** Body of the note as last successfully saved (dirty-check baseline). */
  private lastSavedBody = '';

  /** Canonical revision used to reject stale concurrent editor saves. */
  private currentNoteRevision: number | undefined = undefined;

  /**
   * Handle for the currently mounted CM6 editor.
   * Flushed + destroyed before mounting a new note (caret-safe, §5 spec).
   * NEVER destroyed or re-mounted on the autosave path (§5 R1 guard).
   */
  private editorHandle: EditorHandle | null = null;
  private conflictActive = false;
  private conflictDraft = '';
  private selectedHistoryRevision: number | null = null;
  private collectionRenameTarget: CollectionDto | null = null;
  private collectionDeleteTarget: CollectionDto | null = null;

  // ── Tree state (Wave 2B) ──────────────────────────────────────────────────

  /** Set of folder paths currently expanded in the tree. */
  private expandedFolders: Set<string> = new Set();

  /** Whether the folder-rail sidebar pane is collapsed. */
  private paneCollapsed = false;

  /** Path of the currently focused treeitem (roving tabindex target). */
  private focusedFolderPath: string | null = null;

  /** Last tree built from loadFolders — used for keyboard nav (flattenVisible). */
  private cachedTree: TreeNode[] = [];

  // ── Folder management state (folder-mgmt / S5) ───────────────────────────

  /** Path being renamed (stored between renameFolder() open and submitRenameFolder()). */
  private renameTarget: string | null = null;

  /** Path being deleted (stored between deleteFolder() open and confirmDeleteFolder()). */
  private deleteTarget: string | null = null;

  /**
   * Parent prefix for the New Subfolder flow (D-NEW-SUBFOLDER-REUSE).
   * Set by newSubfolder(path); reset to undefined by newFolder().
   * submitNewFolder composes: parent ? `${parent}/${name}` : name.
   */
  private newFolderParent: string | undefined = undefined;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  connect(): void {
    // ── Restore tree prefs (D-PERSIST) ────────────────────────────────────
    const prefs = loadFolderTreePrefs();
    this.expandedFolders = new Set(prefs.expanded);
    this.paneCollapsed = prefs.paneCollapsed;
    // At phone widths and AX5 there is room for one Notes layer at a time.
    // Start on the index; the existing reveal control keeps the real tree available.
    if (this.isCompactNotesViewport()) this.paneCollapsed = true;
    if (this.paneCollapsed) {
      this.element.classList.add('rail-collapsed');
    }
    this.updateScopeTitle();

    void this.loadFolders();
    void this.loadCollections();
    void this.loadList({});

    // Close new-folder dialog on backdrop click (clicking the <dialog> element itself,
    // outside the inner panel — mirrors the CaptureController pattern).
    this.newFolderModalTarget.addEventListener('click', (e: MouseEvent) => {
      if (e.target === this.newFolderModalTarget) this.closeNewFolder();
    });

    // Backdrop clicks for rename/delete dialogs (same pattern).
    this.renameFolderModalTarget.addEventListener('click', (e: MouseEvent) => {
      if (e.target === this.renameFolderModalTarget) this.closeRenameFolder();
    });
    this.deleteFolderModalTarget.addEventListener('click', (e: MouseEvent) => {
      if (e.target === this.deleteFolderModalTarget) this.closeDeleteFolder();
    });
    this.collectionModalTarget.addEventListener('click', (e: MouseEvent) => {
      if (e.target === this.collectionModalTarget) this.closeCollection();
    });
    this.renameCollectionModalTarget.addEventListener('click', (e: MouseEvent) => {
      if (e.target === this.renameCollectionModalTarget) this.closeRenameCollection();
    });
    this.deleteCollectionModalTarget.addEventListener('click', (e: MouseEvent) => {
      if (e.target === this.deleteCollectionModalTarget) this.closeDeleteCollection();
    });
    this.historyModalTarget.addEventListener('click', (e: MouseEvent) => {
      if (e.target === this.historyModalTarget) this.closeHistory();
    });
  }

  // ── Folder rail actions (Wave 2A) ──────────────────────────────────────────

  /**
   * loadFolders — invoke list_folders, build the tree, and render the folder rail.
   * Called on connect and after folder creation or selection.
   *
   * D-RERENDER: full re-render on data refresh only. Restores:
   *   - Focus by [data-folder-path] (roving tabindex rebuild).
   *   - Expanded visibility from the persistent expanded Set.
   */
  async loadFolders(): Promise<void> {
    try {
      const folders = await listFolders();
      this.cachedTree = buildFolderTree(folders);
      renderFolderTree(
        this.folderListTarget,
        this.viewTemplates,
        this.cachedTree,
        {
          activeFolder: this.currentFolder,
          expanded: this.expandedFolders,
          focusedPath: this.focusedFolderPath,
        },
        {
          onSelect: (path) => { void this.selectFolder(path); },
          onToggle: (path) => { this.toggleFolder(path); },
          // S4: drag-note-into-folder
          onDropNote: (folderPath, noteId) => { void this.handleDropNote(folderPath, noteId); },
          // S5: kebab menu actions
          onRename: (path) => { this.renameFolder(path); },
          onDelete: (path) => { this.deleteFolder(path); },
          onNewSubfolder: (path) => { this.newSubfolder(path); },
        }
      );
      initIcons();
    } catch (err: unknown) {
      if (isJinErrorDto(err)) {
        this.dispatch('error', { detail: err, prefix: 'app', bubbles: true });
      } else {
        console.error('[NotesController] unexpected error loading folders:', err);
      }
    }
  }

  /**
   * selectFolder — update the active folder and reload the note list.
   * Called when a folder row button is clicked (from renderFolderRail callback).
   *
   * If a note editor is currently open, this method flushes any pending edits and
   * tears it down (mirror of the loadDetail §280-284 teardown) before restoring
   * the list view. Without this, loadList renders into the still-hidden listPanel
   * while detailPanel stays on screen — the click looks dead.
   */
  async selectFolder(path: string): Promise<void> {
    if (!(await this.leaveDetailForScope())) return;

    this.currentFolder = path;
    this.currentCollectionId = null;
    this.updateScopeTitle();
    this.collapsePaneForCompactNavigation();
    // Re-render rail to update active highlight
    void this.loadFolders();
    this.renderCollections();
    // Reload note list with folder filter (listPanel is now visible)
    void this.loadList({ folder: path });
  }

  /** Select the default all-notes scope without discarding a paused conflict draft. */
  async selectAllNotes(): Promise<void> {
    if (!(await this.leaveDetailForScope())) return;
    this.currentFolder = undefined;
    this.currentCollectionId = null;
    this.updateScopeTitle();
    this.collapsePaneForCompactNavigation();
    this.renderCollections();
    void this.loadFolders();
    void this.loadList({});
  }

  // ── Tree expand/collapse + keyboard + pane actions (Wave 2B) ────────────────

  /**
   * toggleFolder — flip a folder's expanded state and apply targeted DOM.
   * Called by the chevron click callback from renderFolderTree (D-RERENDER:
   * targeted-DOM only, no full re-render).
   */
  toggleFolder(path: string): void {
    if (this.expandedFolders.has(path)) {
      this.expandedFolders.delete(path);
      setTreeItemExpanded(this.folderListTarget, path, false);
    } else {
      this.expandedFolders.add(path);
      setTreeItemExpanded(this.folderListTarget, path, true);
    }
    this.saveTreePrefs();
  }

  /**
   * onTreeKeydown — delegated keydown handler on the tree container.
   * data-action="keydown->notes#onTreeKeydown" on <ul role="tree">.
   *
   * Calls resolveTreeKey (pure) then applies focus/expand/collapse/select
   * via targeted DOM (D-RERENDER).
   */
  onTreeKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    const li = target.closest<HTMLElement>('[role="treeitem"]');
    if (!li) return;

    // Derive focused path from the treeitem's .folder-row__btn[data-folder-path].
    const btn = li.querySelector<HTMLElement>('.folder-row__btn');
    const path = btn?.dataset.folderPath ?? '';

    const visible = flattenVisible(this.cachedTree, this.expandedFolders);
    const visiblePaths = visible.map((n) => n.path);
    const isParentMap = new Map(visible.map((n) => [n.path, n.isParent]));

    const result = resolveTreeKey(event.key, {
      visiblePaths,
      focusedPath: path,
      expandedSet: this.expandedFolders,
      isParentMap,
    });

    // Prevent default scroll/browser behaviour for all recognized tree keys,
    // including no-op cases (e.g. ArrowDown at the last item) to stop page scroll.
    const isNavKey = [
      'ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End', 'Enter', ' ',
    ].includes(event.key);
    const handled = result.nextFocusPath !== undefined
      || result.expand !== undefined
      || result.collapse !== undefined
      || result.select === true
      || isNavKey;
    if (handled) event.preventDefault();

    if (result.expand) {
      this.expandedFolders.add(result.expand);
      setTreeItemExpanded(this.folderListTarget, result.expand, true);
      this.saveTreePrefs();
    }

    if (result.collapse) {
      this.expandedFolders.delete(result.collapse);
      setTreeItemExpanded(this.folderListTarget, result.collapse, false);
      this.saveTreePrefs();
    }

    if (result.nextFocusPath !== undefined) {
      this.focusedFolderPath = result.nextFocusPath;
      focusTreeItem(this.folderListTarget, result.nextFocusPath);
    } else if (isNavKey) {
      // No focus movement (e.g. ArrowDown at last item, ArrowRight expand, Enter).
      // Re-apply roving tabindex to the current node so tabindex=0 is always set
      // on the active treeitem after any recognized key (WAI-ARIA roving-tabindex).
      this.focusedFolderPath = path;
      focusTreeItem(this.folderListTarget, path);
    }

    if (result.select === true) {
      void this.selectFolder(path);
    }
  }

  /**
   * togglePane — collapse or reveal the folder-rail sidebar.
   * data-action="click->notes#togglePane" on both the in-rail collapse button
   * and the always-reachable reveal button in list/detail panes.
   */
  togglePane(): void {
    const wasCollapsed = this.paneCollapsed;
    this.paneCollapsed = !this.paneCollapsed;
    this.element.classList.toggle('rail-collapsed', this.paneCollapsed);
    this.saveTreePrefs();
    if (wasCollapsed) {
      this.folderRailTarget.querySelector<HTMLElement>('.notes-folder-rail__collapse-btn')?.focus();
    } else {
      const activePane = this.detailPanelTarget.classList.contains('hidden')
        ? this.listPanelTarget
        : this.detailPanelTarget;
      activePane.querySelector<HTMLElement>('.notes-rail-reveal')?.focus();
    }
  }

  // ── Private tree-pref helper ──────────────────────────────────────────────

  private saveTreePrefs(): void {
    saveFolderTreePrefs({
      expanded: [...this.expandedFolders],
      paneCollapsed: this.paneCollapsed,
    });
  }

  /**
   * newFolder — open the New Folder dialog (top-level folder; resets newFolderParent).
   * data-action="click->notes#newFolder" on the New Folder button.
   * Replaces the old window.prompt() approach (which is a silent no-op in Tauri webviews).
   */
  newFolder(): void {
    this.newFolderParent = undefined; // not a subfolder
    this.newFolderInputTarget.value = '';
    clearFormError(this.newFolderErrorTarget);
    this.newFolderModalTarget.showModal();
    this.newFolderInputTarget.focus();
  }

  /**
   * submitNewFolder — handle the New Folder form submit.
   * data-action="submit->notes#submitNewFolder" on the <form> inside the dialog.
   *
   * D-NEW-SUBFOLDER-REUSE: if newFolderParent is set (via newSubfolder(path)),
   * the path is composed as `${parent}/${name}`; otherwise just `name`.
   */
  async submitNewFolder(event: Event): Promise<void> {
    event.preventDefault();
    const name = this.newFolderInputTarget.value.trim();
    if (!name) {
      renderFormError(this.newFolderErrorTarget, 'Folder name is required.');
      return;
    }
    // D-NEW-SUBFOLDER-REUSE: compose parent + "/" + name if parent is set.
    const path = this.newFolderParent ? `${this.newFolderParent}/${name}` : name;
    clearFormError(this.newFolderErrorTarget);
    try {
      await createFolder(path);
      this.newFolderModalTarget.close();
      this.newFolderParent = undefined;
      this.currentFolder = path;
      await this.loadFolders();
      initIcons();
    } catch (err: unknown) {
      if (isJinErrorDto(err)) {
        // e.g. code 2 = invalid path (backslash, absolute, "..", ".", empty)
        // Surface inline — do NOT close the dialog.
        renderFormError(this.newFolderErrorTarget, err.message);
      } else {
        renderFormError(
          this.newFolderErrorTarget,
          'An unexpected error occurred. Please try again.'
        );
      }
    }
  }

  /**
   * closeNewFolder — cancel the dialog (Cancel button or backdrop click).
   * data-action="click->notes#closeNewFolder" on the Cancel and close buttons.
   */
  closeNewFolder(): void {
    this.newFolderParent = undefined;
    this.newFolderModalTarget.close();
  }

  // ── Folder management actions (folder-mgmt / S3+S5) ───────────────────────

  /**
   * S4: handleDropNote — called when a note is dropped on a folder row.
   *
   * Same-folder guard: reads `data-note-folder` from the dragged note's DOM element
   * (set in buildNoteRow) to avoid a redundant move when the note is already in the
   * target folder (D-DRAG-DATA).
   */
  async handleDropNote(folderPath: string, noteId: string): Promise<void> {
    // Look up the note's current folder from the DOM (set as data-note-folder in buildNoteRow)
    const noteEl = document.querySelector<HTMLElement>(
      `.browse-row__inner[data-note-id="${noteId}"]`
    );
    const noteCurrentFolder = noteEl?.dataset.noteFolder ?? '';
    if (folderPath === noteCurrentFolder) return; // already here — no-op

    try {
      await moveNoteInvoke(noteId, folderPath);
      await this.loadFolders();
      await this.loadList({ folder: this.currentFolder });
    } catch (err: unknown) {
      if (isJinErrorDto(err)) {
        this.dispatch('error', { detail: err, prefix: 'app', bubbles: true });
      } else {
        console.error('[NotesController] unexpected error moving note via drag:', err);
      }
    }
  }

  /**
   * S5: renameFolder — open the Rename Folder dialog, prefilled with the leaf name.
   * Called from the tree's kebab Rename menuitem via cb.onRename.
   */
  renameFolder(path: string): void {
    this.renameTarget = path;
    const leafName = path.split('/').pop() ?? path;
    this.renameFolderInputTarget.value = leafName;
    clearFormError(this.renameFolderErrorTarget);
    this.renameFolderModalTarget.showModal();
    this.renameFolderInputTarget.focus();
  }

  /**
   * submitRenameFolder — form submit handler for the rename dialog.
   * Computes newPath = parent prefix + new name, calls renameFolderInvoke,
   * applies D-CURRENT-FOLDER-SYNC, reloads tree + list.
   * data-action="submit->notes#submitRenameFolder"
   */
  async submitRenameFolder(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.renameTarget) return;

    const name = this.renameFolderInputTarget.value.trim();
    if (!name) {
      renderFormError(this.renameFolderErrorTarget, 'Folder name is required.');
      return;
    }

    const oldPath = this.renameTarget;
    // Compute new path: preserve the parent prefix.
    const lastSlash = oldPath.lastIndexOf('/');
    const parentPrefix = lastSlash >= 0 ? oldPath.slice(0, lastSlash + 1) : '';
    const newPath = parentPrefix + name;

    clearFormError(this.renameFolderErrorTarget);
    try {
      await renameFolderInvoke(oldPath, newPath);
      this.renameFolderModalTarget.close();
      this.renameTarget = null;
      // D-CURRENT-FOLDER-SYNC: remap currentFolder / expandedFolders / focusedFolderPath
      this.remapAfterRename(oldPath, newPath);
      this.updateScopeTitle();
      await this.loadFolders();
      void this.loadList({ folder: this.currentFolder });
    } catch (err: unknown) {
      if (isJinErrorDto(err)) {
        renderFormError(this.renameFolderErrorTarget, err.message);
      } else {
        renderFormError(
          this.renameFolderErrorTarget,
          'An unexpected error occurred. Please try again.'
        );
      }
    }
  }

  /**
   * closeRenameFolder — cancel the rename dialog.
   * data-action="click->notes#closeRenameFolder"
   */
  closeRenameFolder(): void {
    this.renameTarget = null;
    this.renameFolderModalTarget.close();
  }

  /**
   * S5: deleteFolder — open the Delete Folder confirm dialog.
   * Shows "Move N notes to <parent> and delete?" message from cachedTree.
   * Called from the tree's kebab Delete menuitem via cb.onDelete.
   */
  deleteFolder(path: string): void {
    this.deleteTarget = path;
    const count = this.subtreeNoteCount(path);
    const lastSlash = path.lastIndexOf('/');
    const parentLabel = lastSlash >= 0 ? path.slice(0, lastSlash) || 'Notes' : 'Notes';
    const leafName = path.split('/').pop() ?? path;
    const noun = count === 1 ? 'note' : 'notes';
    this.deleteFolderMessageTarget.textContent =
      `Move ${count} ${noun} to "${parentLabel}" and delete "${leafName}"?`;
    this.deleteFolderModalTarget.showModal();
  }

  /**
   * confirmDeleteFolder — confirm handler for the delete dialog.
   * Calls deleteFolderInvoke, applies D-CURRENT-FOLDER-SYNC, reloads tree + list.
   * data-action="click->notes#confirmDeleteFolder"
   */
  async confirmDeleteFolder(): Promise<void> {
    if (!this.deleteTarget) return;
    const path = this.deleteTarget;
    try {
      await deleteFolderInvoke(path);
      this.deleteFolderModalTarget.close();
      this.deleteTarget = null;
      // D-CURRENT-FOLDER-SYNC: remap after delete
      this.remapAfterDelete(path);
      this.updateScopeTitle();
      await this.loadFolders();
      void this.loadList({ folder: this.currentFolder });
    } catch (err: unknown) {
      if (isJinErrorDto(err)) {
        this.dispatch('error', { detail: err, prefix: 'app', bubbles: true });
      } else {
        console.error('[NotesController] unexpected error deleting folder:', err);
      }
    }
  }

  /**
   * closeDeleteFolder — cancel the delete dialog.
   * data-action="click->notes#closeDeleteFolder"
   */
  closeDeleteFolder(): void {
    this.deleteTarget = null;
    this.deleteFolderModalTarget.close();
  }

  /**
   * newSubfolder — open the New Folder dialog with this path as the parent prefix.
   * Reuses the existing New Folder dialog (D-NEW-SUBFOLDER-REUSE).
   * Called from the tree's kebab New Subfolder menuitem via cb.onNewSubfolder.
   */
  newSubfolder(parentPath: string): void {
    this.newFolderParent = parentPath;
    this.newFolderInputTarget.value = '';
    clearFormError(this.newFolderErrorTarget);
    this.newFolderModalTarget.showModal();
    this.newFolderInputTarget.focus();
  }

  // ── D-CURRENT-FOLDER-SYNC helpers ─────────────────────────────────────────

  /**
   * remapAfterRename — remap currentFolder / expandedFolders / focusedFolderPath
   * after renaming oldPath→newPath (D-CURRENT-FOLDER-SYNC).
   */
  private remapAfterRename(oldPath: string, newPath: string): void {
    const prefix = oldPath + '/';

    // Remap currentFolder
    if (this.currentFolder === oldPath) {
      this.currentFolder = newPath;
    } else if (this.currentFolder?.startsWith(prefix)) {
      this.currentFolder = newPath + this.currentFolder.slice(oldPath.length);
    }

    // Remap expandedFolders
    const newExpanded = new Set<string>();
    for (const f of this.expandedFolders) {
      if (f === oldPath) {
        newExpanded.add(newPath);
      } else if (f.startsWith(prefix)) {
        newExpanded.add(newPath + f.slice(oldPath.length));
      } else {
        newExpanded.add(f);
      }
    }
    this.expandedFolders = newExpanded;

    // Remap focusedFolderPath
    if (this.focusedFolderPath === oldPath) {
      this.focusedFolderPath = newPath;
    } else if (this.focusedFolderPath?.startsWith(prefix)) {
      this.focusedFolderPath = newPath + this.focusedFolderPath.slice(oldPath.length);
    }

    this.saveTreePrefs();
    this.updateScopeTitle();
  }

  /**
   * remapAfterDelete — reset currentFolder / expandedFolders / focusedFolderPath
   * after deleting path (D-CURRENT-FOLDER-SYNC).
   */
  private remapAfterDelete(path: string): void {
    const prefix = path + '/';
    const lastSlash = path.lastIndexOf('/');
    const parent = lastSlash >= 0 ? path.slice(0, lastSlash) : '';

    // Reset currentFolder to parent if it was inside the deleted subtree
    if (this.currentFolder === path || this.currentFolder?.startsWith(prefix)) {
      this.currentFolder = parent;
    }

    // Drop deleted path and all descendants from expandedFolders
    const newExpanded = new Set<string>();
    for (const f of this.expandedFolders) {
      if (f !== path && !f.startsWith(prefix)) {
        newExpanded.add(f);
      }
    }
    this.expandedFolders = newExpanded;

    // Reset focusedFolderPath
    if (this.focusedFolderPath === path || this.focusedFolderPath?.startsWith(prefix)) {
      this.focusedFolderPath = parent;
    }

    this.saveTreePrefs();
    this.updateScopeTitle();
  }

  /**
   * subtreeNoteCount — sum note_count for all nodes whose path is inside the subtree
   * rooted at targetPath (inclusive). Used by deleteFolder to show the move count.
   */
  private subtreeNoteCount(targetPath: string): number {
    const prefix = targetPath + '/';
    let count = 0;
    const walk = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.path === targetPath || node.path.startsWith(prefix)) {
          count += node.note_count;
        }
        if (node.children.length > 0) {
          walk(node.children);
        }
      }
    };
    walk(this.cachedTree);
    return count;
  }

  // ── Declarative Collections ────────────────────────────────────────────────

  private async loadCollections(): Promise<void> {
    try {
      this.collections = await listCollections();
      this.renderCollections();
      this.updateScopeTitle();
      initIcons();
    } catch (err: unknown) {
      if (isJinErrorDto(err)) {
        this.dispatch('error', { detail: err, prefix: 'app', bubbles: true });
      } else {
        console.error('[NotesController] unexpected error loading collections:', err);
      }
    }
  }

  /**
   * Render saved collection rows using DOM APIs only. The rail intentionally
   * exposes filters through the dialog controls, never a raw query language.
   */
  private renderCollections(): void {
    this.collectionListTarget.replaceChildren();
    const allNotesActive = this.currentCollectionId === null && this.currentFolder === undefined;
    this.allNotesButtonTarget.classList.toggle('is-active', allNotesActive);
    if (allNotesActive) {
      this.allNotesButtonTarget.setAttribute('aria-current', 'page');
    } else {
      this.allNotesButtonTarget.removeAttribute('aria-current');
    }

    for (const collection of this.collections) {
      const item = document.createElement('li');
      item.className = 'notes-collection-item';

      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'notes-collection-row jin-navigation-row';
      select.classList.toggle('is-active', collection.id === this.currentCollectionId);
      const label = document.createElement('span');
      label.className = 'jin-navigation-row__label';
      label.textContent = collection.name;
      select.appendChild(label);
      if (collection.id === this.currentCollectionId) {
        select.setAttribute('aria-current', 'page');
      } else {
        select.removeAttribute('aria-current');
      }
      select.addEventListener('click', () => { void this.selectCollection(collection.id); });

      const rename = document.createElement('button');
      rename.type = 'button';
      rename.className = 'notes-collection-action jin-control jin-control--icon';
      rename.setAttribute('aria-label', `Rename ${collection.name}`);
      rename.textContent = 'Rename';
      rename.addEventListener('click', () => this.renameCollection(collection.id));

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'notes-collection-action jin-control jin-control--icon';
      remove.setAttribute('aria-label', `Delete ${collection.name}`);
      remove.textContent = 'Delete';
      remove.addEventListener('click', () => this.deleteCollection(collection.id));

      const actions = document.createElement('div');
      actions.className = 'notes-collection-actions jin-navigation-row__actions';
      actions.append(rename, remove);
      item.append(select, actions);
      this.collectionListTarget.appendChild(item);
    }
  }

  async selectCollection(id: string): Promise<void> {
    if (!(await this.leaveDetailForScope())) return;
    this.currentCollectionId = id;
    this.currentFolder = undefined;
    this.updateScopeTitle();
    this.collapsePaneForCompactNavigation();
    this.renderCollections();
    void this.loadFolders();
    await this.loadActiveList();
  }

  newCollection(): void {
    this.collectionNameInputTarget.value = '';
    this.collectionFilterInputTarget.value = 'all';
    this.collectionFilterValueInputTarget.value = '';
    this.collectionSortInputTarget.value = 'updated';
    this.collectionDirectionInputTarget.value = 'desc';
    clearFormError(this.collectionErrorTarget);
    this.collectionModalTarget.showModal();
    this.collectionNameInputTarget.focus();
  }

  async submitCollection(event: Event): Promise<void> {
    event.preventDefault();
    const name = this.collectionNameInputTarget.value.trim();
    const filterKind = this.collectionFilterInputTarget.value;
    const filterValue = this.collectionFilterValueInputTarget.value.trim();
    if (!name) {
      renderFormError(this.collectionErrorTarget, 'Collection name is required.');
      return;
    }
    if (filterKind !== 'all' && !filterValue) {
      renderFormError(this.collectionErrorTarget, 'Enter a value for this filter.');
      return;
    }

    const filter: CollectionFilterDto = filterKind === 'all'
      ? { op: 'all', clauses: [] }
      : filterKind === 'tag'
        ? { op: 'tag', value: filterValue }
        : filterKind === 'status'
          ? { op: 'status', value: filterValue }
          : { op: 'body_contains', value: filterValue };
    const query: CollectionQueryDto = {
      version: 1,
      filter,
      sort: [{
        field: this.collectionSortInputTarget.value as 'created' | 'updated' | 'title',
        direction: this.collectionDirectionInputTarget.value as 'asc' | 'desc',
      }],
      limit: null,
    };

    try {
      const created = await createCollection({ name, query });
      this.collectionModalTarget.close();
      await this.loadCollections();
      this.updateScopeTitle();
      await this.selectCollection(created.id);
    } catch (err: unknown) {
      renderFormError(
        this.collectionErrorTarget,
        isJinErrorDto(err) ? err.message : 'Could not create the collection.'
      );
    }
  }

  closeCollection(): void {
    this.collectionModalTarget.close();
  }

  renameCollection(id: string): void {
    const collection = this.collections.find((candidate) => candidate.id === id);
    if (!collection) return;
    this.collectionRenameTarget = collection;
    this.renameCollectionInputTarget.value = collection.name;
    clearFormError(this.renameCollectionErrorTarget);
    this.renameCollectionModalTarget.showModal();
    this.renameCollectionInputTarget.focus();
  }

  async submitRenameCollection(event: Event): Promise<void> {
    event.preventDefault();
    const target = this.collectionRenameTarget;
    const name = this.renameCollectionInputTarget.value.trim();
    if (!target || !name) {
      renderFormError(this.renameCollectionErrorTarget, 'Collection name is required.');
      return;
    }
    try {
      await renameCollectionInvoke(target.id, name);
      this.renameCollectionModalTarget.close();
      this.collectionRenameTarget = null;
      await this.loadCollections();
      this.updateScopeTitle();
    } catch (err: unknown) {
      renderFormError(
        this.renameCollectionErrorTarget,
        isJinErrorDto(err) ? err.message : 'Could not rename the collection.'
      );
    }
  }

  closeRenameCollection(): void {
    this.collectionRenameTarget = null;
    this.renameCollectionModalTarget.close();
  }

  deleteCollection(id: string): void {
    const collection = this.collections.find((candidate) => candidate.id === id);
    if (!collection) return;
    this.collectionDeleteTarget = collection;
    this.deleteCollectionMessageTarget.textContent = `Delete "${collection.name}"?`;
    this.deleteCollectionModalTarget.showModal();
  }

  async confirmDeleteCollection(): Promise<void> {
    const target = this.collectionDeleteTarget;
    if (!target) return;
    try {
      await deleteCollectionInvoke(target.id);
      this.deleteCollectionModalTarget.close();
      this.collectionDeleteTarget = null;
      const wasActive = this.currentCollectionId === target.id;
      if (wasActive) {
        this.currentCollectionId = null;
        this.currentFolder = undefined;
        this.updateScopeTitle();
      }
      await this.loadCollections();
      if (wasActive) await this.loadList({});
    } catch (err: unknown) {
      this.dispatch('error', {
        detail: isJinErrorDto(err) ? err : { message: 'Could not delete the collection.' },
        prefix: 'app',
        bubbles: true,
      });
    }
  }

  closeDeleteCollection(): void {
    this.collectionDeleteTarget = null;
    this.deleteCollectionModalTarget.close();
  }

  // ── List actions ──────────────────────────────────────────────────────────

  /**
   * loadList — invoke list_notes, transform, and render.
   * Called on connect and when filters change.
   */
  async loadList(filter: NotesFilter): Promise<void> {
    const el = this.viewElements;
    showListLoading(el);

    try {
      const notes = await listNotes({ tag: filter.tag, folder: filter.folder });
      hideListLoading(el);

      const filtered = filterNotesList(notes, filter);
      const sorted = sortNotesList(filtered);
      this.renderList(sorted);
    } catch (err: unknown) {
      hideListLoading(el);
      if (isJinErrorDto(err)) {
        this.dispatch('error', { detail: err, prefix: 'app', bubbles: true });
      } else {
        console.error('[NotesController] unexpected error loading notes:', err);
      }
    }
  }

  /** Reload the selected collection or the selected folder/all-notes list. */
  private async loadActiveList(): Promise<void> {
      if (this.currentCollectionId) {
        const collectionId = this.currentCollectionId;
        const el = this.viewElements;
        showListLoading(el);
        try {
          const notes = await evaluateCollection(collectionId);
          if (this.currentCollectionId !== collectionId) return;
          hideListLoading(el);
          this.renderList(notes);
        } catch (err: unknown) {
          hideListLoading(el);
          if (isJinErrorDto(err)) {
            this.dispatch('error', { detail: err, prefix: 'app', bubbles: true });
          } else {
            console.error('[NotesController] unexpected error evaluating collection:', err);
          }
        }
        return;
      }
      await this.loadList({ folder: this.currentFolder });
    }

    private renderList(notes: Parameters<typeof renderNotesList>[2]): void {
      renderNotesList(this.viewElements, this.viewTemplates, notes, (kind, id) => {
        if (kind === 'notes') {
          void this.loadDetail(id);
        } else {
          this.navigateTo(kind, id);
        }
      });
      initIcons();
    }

    /** Debounce literal-only FTS requests; stale responses never repaint the list. */
    onSearchInput(): void {
      const query = this.searchInputTarget.value.trim();
      const requestId = ++this.searchRequestId;
      if (this.searchTimer !== null) {
        clearTimeout(this.searchTimer);
        this.searchTimer = null;
      }
      if (!query) {
        this.searchCountTarget.textContent = '';
        void this.loadActiveList();
        return;
      }
      this.searchCountTarget.textContent = 'Searching…';
      this.searchTimer = setTimeout(() => {
        this.searchTimer = null;
        void this.runSearch(query, requestId);
      }, 250);
    }

    onSearchKeydown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (!this.searchInputTarget.value) return;
      this.searchInputTarget.value = '';
      this.onSearchInput();
      this.searchInputTarget.focus();
    }

    private async runSearch(query: string, requestId: number): Promise<void> {
      try {
        const notes = await searchNotes(query);
        // The user may have typed, cleared, or switched scope while the bridge
        // request was in flight. Do not let an old result replace their list.
        if (requestId !== this.searchRequestId || this.searchInputTarget.value.trim() !== query) return;
        this.renderList(sortNotesList(filterNotesList(notes, {})));
        this.searchCountTarget.textContent = `${notes.length} ${notes.length === 1 ? 'note' : 'notes'} found`;
      } catch (err: unknown) {
        if (requestId !== this.searchRequestId) return;
        this.searchCountTarget.textContent = 'Search unavailable';
        if (isJinErrorDto(err)) {
          this.dispatch('error', { detail: err, prefix: 'app', bubbles: true });
        } else {
          console.error('[NotesController] unexpected error searching notes:', err);
        }
      }
    }

  // ── Detail actions ────────────────────────────────────────────────────────

  /**
   * openDetail — handle jin:open-detail event from RouterController.
   * data-action="jin:open-detail->notes#openDetail" on the section element.
   */
  openDetail(event: Event): void {
    const ce = event as CustomEvent<{ id: string }>;
    if (!ce.detail?.id) return;
    void this.loadDetail(ce.detail.id);
  }

  /**
   * showList — go back to the list view (back button).
   * data-action="click->notes#showList" on the back button.
   */
  showList(): void {
    if (this.conflictActive) {
      this.conflictStatusTarget.textContent = 'Resolve the conflict before leaving this note.';
      this.conflictPanelTarget.focus();
      return;
    }
    this.detailPanelTarget.classList.add('hidden');
    this.element.classList.remove('detail-open');
    this.listPanelTarget.classList.remove('hidden');
  }

  /**
   * Leave a detail view only when it is safe to do so. A stale-write panel owns
   * an unsaved local draft, so navigation cannot silently discard it.
   */
  private async leaveDetailForScope(): Promise<boolean> {
    if (this.conflictActive) {
      this.conflictStatusTarget.textContent = 'Resolve the conflict before changing note scope.';
      this.conflictPanelTarget.focus();
      return false;
    }
    if (this.editorHandle) {
      await this.editorHandle.flush();
      this.editorHandle.destroy();
      this.editorHandle = null;
      this.currentNoteId = null;
      this.lastSavedBody = '';
    }
    this.showList();
    return true;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async loadDetail(id: string): Promise<void> {
    if (this.conflictActive) {
      this.conflictStatusTarget.textContent = id === this.currentNoteId
        ? 'Resolve the conflict before reloading this note.'
        : 'Resolve the conflict before opening another note.';
      this.conflictPanelTarget.focus();
      return;
    }
    const el = this.viewElements;

    // ── Flush + destroy the outgoing editor before switching notes ────────────
    // This ensures any unsaved changes in the PREVIOUS note are persisted before
    // we re-mount for the new note. The caret-safe invariant requires that mount/
    // destroy only happen here, NEVER on the autosave path (§5 / R1 spec).
    if (this.editorHandle) {
      await this.editorHandle.flush();
      this.editorHandle.destroy();
      this.editorHandle = null;
    }

    // Show detail panel, hide list; expand grid to 3 columns.
    this.listPanelTarget.classList.add('hidden');
    this.detailPanelTarget.classList.remove('hidden');
    this.element.classList.add('detail-open');

    // Show detail loading state.
    el.detailLoadingState.classList.remove('hidden');
    el.detailNotFoundState.classList.add('hidden');
    el.detailContent.classList.add('hidden');

    // item 3: clear breadcrumb while loading; item 1: clear stale action buttons.
    this.detailBreadcrumbTarget.textContent = '';
    this.detailActionsTarget.innerHTML = '';

    try {
      const note = await getNoteById(id);

      // Track state for onSave (dirty-check baseline — the LOADED body, not re-fetched).
      this.currentNoteId = note.id;
      this.lastSavedBody = note.body_markdown ?? '';
      this.currentNoteRevision = note.revision ?? undefined;

      el.detailLoadingState.classList.add('hidden');
      el.detailContent.classList.remove('hidden');

      // Mount the CM6 editor via renderNoteDetail and store the handle.
      // The handle is the ONLY way to interact with the editor after mounting.
      this.editorHandle = renderNoteDetail(
        el,
        this.viewTemplates,
        note,
        (kind, targetId) => { this.navigateTo(kind, targetId); },
        (noteId, targetId) => { this.openAttachDialog(noteId, targetId); },
        (sourceId, targetId) => { this.openLinkDialog(sourceId, targetId); },
        async (body) => { await this.onSave(note.id, body); },
        async (newTitle) => { await this.onTitleSave(note.id, newTitle); },
        (noteId) => { void this.addAttachment(noteId); },
        (noteId) => { void this.openHistory(noteId); },
      );

      // item 3: set breadcrumb from currentFolder (controller state, not note DTO —
      // NoteDto.folder_path is null on get_note). Falls back to "Notes" at root or
      // when no folder context is set (deep-link / backlink navigation).
      this.detailBreadcrumbTarget.textContent = this.currentFolder
        ? `Notes / ${this.currentFolder.replace(/\//g, ' / ')}`
        : 'Notes';

      initIcons();
    } catch (err: unknown) {
      el.detailLoadingState.classList.add('hidden');
      if (isJinErrorDto(err) && err.code === 3) {
        el.detailNotFoundState.classList.remove('hidden');
      } else if (isJinErrorDto(err)) {
        this.dispatch('error', { detail: err, prefix: 'app', bubbles: true });
      } else {
        console.error('[NotesController] unexpected error loading note detail:', err);
      }
    }
  }

  /**
   * onSave — caret-safe autosave handler (replaces the old commitBody).
   *
   * Called by the CM6 module's debounced autosave (600 ms) or on flush.
   * Critically: this method NEVER calls renderNoteDetail / setDoc / getNoteById.
   * The editor is NOT re-mounted here — only metadata is updated via targeted DOM.
   * This is the §5 / R1 guard: re-mounting here would destroy the caret.
   *
   * Flow:
   *  1. Stale-closure guard (different note now open → discard).
   *  2. Dirty-check vs lastSavedBody (no-op if unchanged).
   *  3. editNote(id, { body }) — body-only, in-place overwrite.
   *  4. lastSavedBody = body (the SENT text — no re-fetch, no setDoc).
   *  5. Update the list-row date via targeted DOM from the returned NoteDto.
   *  6. On error: dispatch app:error; re-throw so the module shows "Save failed"
   *     and lastSavedBody stays unchanged (next flush retries).
   */
  private async onSave(id: string, body: string): Promise<void> {
    // 1. Stale-closure guard.
    if (id !== this.currentNoteId) return;
    // 2. Dirty-check.
    if (body === this.lastSavedBody) return;

    try {
      // 3. Save body-only (title/folder preserved by the in-place overwrite branch).
      const updated = await editNote(id, {
        body,
        expected_revision: this.currentNoteRevision,
      });

      // 4. Update lastSavedBody to the SENT text — NOT a re-fetch.
      //    A re-fetch + setDoc would clobber in-flight typing and move the caret.
      this.lastSavedBody = body;
      this.currentNoteRevision = updated.revision ?? undefined;

      // 5. Targeted DOM update: refresh the list-row date from the returned NoteDto.
      //    Uses .querySelector to find the note row if it is currently visible.
      if (updated.updated) {
        const rowInner = document.querySelector<HTMLElement>(
          `.browse-row__inner[data-note-id="${id}"]`
        );
        const dateEl = rowInner?.closest('.browse-row')?.querySelector('.note-row__date');
        if (dateEl) dateEl.textContent = formatNoteDate(updated.updated);
      }
      // The "Saved" status indicator is updated by the module's callOnSave wrapper.
    } catch (err: unknown) {
      // A stale write is not retried or overwritten. Keep the mounted editor and
      // local body intact, then require an explicit recovery action.
      if (isJinErrorDto(err) && err.code === 4) {
        this.presentConflict(id, body, err);
      } else if (isJinErrorDto(err)) {
        this.dispatch('error', { detail: err, prefix: 'app', bubbles: true });
      } else {
        console.error('[NotesController] unexpected error saving note body:', err);
      }
      // lastSavedBody unchanged → next flush will retry.
      throw err;
    }
  }

  /**
   * onTitleSave — caret-safe title-rename handler (NN-1).
   *
   * Called by the inline title input's blur/Enter commit path (via the onTitleSave
   * callback wired in renderNoteDetail). Mirrors onSave's targeted-DOM pattern:
   *   1. Defensive flush — drain any pending body save before rename.
   *   2. editNote(id, { title }) — ULID preserved; body-save still routes by ULID.
   *   3. Targeted DOM: update the list-row .browse-row__title + aria-label + date.
   *
   * CRITICAL (caret-safe): does NOT call renderNoteDetail; does NOT touch editorHandle
   * identity. The CM6 body editor stays mounted with the same EditorView (§5 / D-CARET-SAFE).
   */
  private async onTitleSave(id: string, newTitle: string): Promise<void> {
    if (id !== this.currentNoteId) return;
    try {
      // 1. Defensive flush: drain any pending body change before rename.
      await this.editorHandle?.flush();

      // 2. Save the title (ULID preserved by jin-core — body-save still routes).
      const updated = await editNote(id, {
        title: newTitle,
        expected_revision: this.currentNoteRevision,
      });
      this.currentNoteRevision = updated.revision ?? undefined;

      // 3. Targeted DOM: mirror onSave list-row update pattern (~531-539).
      const rowInner = document.querySelector<HTMLElement>(
        `.browse-row__inner[data-note-id="${id}"]`
      );
      if (rowInner) {
        const row = rowInner.closest('.browse-row');
        const rowTitleEl = row?.querySelector('.browse-row__title');
        if (rowTitleEl) rowTitleEl.textContent = noteDisplayTitle(newTitle);
        if (updated.updated) {
          const dateEl = row?.querySelector('.note-row__date');
          if (dateEl) dateEl.textContent = formatNoteDate(updated.updated);
        }
        rowInner.setAttribute('aria-label', noteDisplayTitle(newTitle));
      }
    } catch (err: unknown) {
      if (isJinErrorDto(err) && err.code === 4) {
        this.presentConflict(id, this.editorHandle?.getDoc() ?? this.lastSavedBody, err);
      } else if (isJinErrorDto(err)) {
        this.dispatch('error', { detail: err, prefix: 'app', bubbles: true });
      } else {
        console.error('[NotesController] unexpected error saving note title:', err);
      }
      // re-throw so the blur handler's .catch() runs and baseline is NOT advanced
      throw err;
    }
  }

  // ── Attachments, recovery, and local conflicts ─────────────────────────────

  /**
   * Import a user-selected file into the managed asset store and insert its
   * inert Markdown reference at the current CM6 selection. This is distinct
   * from the semantic "Attach to Event" action.
   */
  private async addAttachment(noteId: string): Promise<void> {
    if (noteId !== this.currentNoteId || !this.editorHandle || this.conflictActive) return;
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: false,
        multiple: false,
        title: 'Add attachment',
      });
      if (!selected) return;
      const source = typeof selected === 'string' ? selected : selected[0];
      if (!source) return;
      const asset = await importAttachment(source);
      const filename = this.escapeMarkdownLinkLabel(asset.original_names[0] || 'attachment');
      this.editorHandle.insertText(`[${filename}](jin-asset://sha256/${asset.sha256})`);
    } catch (err: unknown) {
      if (isJinErrorDto(err)) {
        this.dispatch('error', { detail: err, prefix: 'app', bubbles: true });
      } else {
        console.error('[NotesController] unexpected error importing attachment:', err);
      }
    }
  }

  private escapeMarkdownLinkLabel(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
  }

  async openHistory(noteId: string | Event = this.currentNoteId ?? ''): Promise<void> {
    if (noteId instanceof Event) noteId = this.currentNoteId ?? '';
    if (!noteId || noteId !== this.currentNoteId) return;
    this.selectedHistoryRevision = null;
    this.restoreRevisionButtonTarget.disabled = true;
    this.historyRevisionListTarget.replaceChildren();
    this.historyPreviewTarget.textContent = '';
    this.historyStatusTarget.textContent = 'Loading revisions…';
    this.historyModalTarget.showModal();
    try {
      const revisions = await listNoteRevisions(noteId);
      this.historyStatusTarget.textContent = revisions.length
        ? 'Select a revision to preview it before restoring.'
        : 'No saved revisions are available.';
      for (const revision of [...revisions].reverse()) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'notes-history__revision btn-secondary';
        button.textContent = `Revision ${revision}`;
        button.addEventListener('click', () => { void this.previewHistoryRevision(noteId, revision); });
        this.historyRevisionListTarget.appendChild(button);
      }
    } catch (err: unknown) {
      this.historyStatusTarget.textContent = isJinErrorDto(err)
        ? err.message
        : 'Could not load revision history.';
    }
  }

  private async previewHistoryRevision(noteId: string, revision: number): Promise<void> {
    this.selectedHistoryRevision = revision;
    this.restoreRevisionButtonTarget.disabled = true;
    try {
      const preview = await previewNoteRevision(noteId, revision);
      if (this.selectedHistoryRevision !== revision) return;
      this.restoreRevisionButtonTarget.disabled = false;
      // textContent keeps history content inert; it is not rendered as HTML or Markdown.
      this.historyPreviewTarget.textContent =
        `${preview.title}\nRevision ${preview.revision} · ${preview.updated}\n\n${preview.body_markdown}`;
      this.historyStatusTarget.textContent = `Previewing revision ${revision}.`;
    } catch (err: unknown) {
      if (this.selectedHistoryRevision !== revision) return;
      this.selectedHistoryRevision = null;
      this.historyStatusTarget.textContent = isJinErrorDto(err)
        ? err.message
        : 'Could not preview this revision.';
    }
  }

  closeHistory(): void {
    this.historyModalTarget.close();
    this.selectedHistoryRevision = null;
  }

  requestRestoreRevision(): void {
    if (this.selectedHistoryRevision === null) return;
    this.restoreRevisionMessageTarget.textContent =
      `Restore revision ${this.selectedHistoryRevision}? The current note is preserved as a new revision.`;
    this.restoreRevisionConfirmModalTarget.showModal();
  }

  closeRestoreRevisionConfirm(): void {
    this.restoreRevisionConfirmModalTarget.close();
  }

  async confirmRestoreRevision(): Promise<void> {
    const noteId = this.currentNoteId;
    const revision = this.selectedHistoryRevision;
    if (!noteId || revision === null) return;
    try {
      // A normal history restore promises to retain the present note as a new
      // revision, including any debounced CM6 edits. A conflict draft stays
      // paused and is never flushed implicitly.
      if (!this.conflictActive) await this.editorHandle?.flush();
      await restoreNoteRevision(noteId, revision, this.currentNoteRevision);
      this.restoreRevisionConfirmModalTarget.close();
      this.closeHistory();
      this.disposeEditorWithoutSaving();
      this.clearConflict();
      await this.loadActiveList();
      await this.loadDetail(noteId);
    } catch (err: unknown) {
      this.restoreRevisionConfirmModalTarget.close();
      if (isJinErrorDto(err) && err.code === 4) {
        this.presentConflict(noteId, this.editorHandle?.getDoc() ?? this.lastSavedBody, err);
      } else if (isJinErrorDto(err)) {
        this.dispatch('error', { detail: err, prefix: 'app', bubbles: true });
      } else {
        console.error('[NotesController] unexpected error restoring revision:', err);
      }
    }
  }

  private presentConflict(id: string, draft: string, error: unknown): void {
    if (id !== this.currentNoteId) return;
    this.conflictActive = true;
    this.conflictDraft = draft;
    this.editorHandle?.setAutosavePaused(true);
    this.conflictPanelTarget.classList.remove('hidden');
    const detail = isJinErrorDto(error) ? error.details : undefined;
    this.conflictMessageTarget.textContent = detail && 'current_revision' in detail
      ? `The latest version is revision ${detail.current_revision}; your draft began from revision ${detail.expected_revision}.`
      : 'The latest saved version differs from the version you were editing.';
    this.conflictStatusTarget.textContent = '';
  }

  requestConflictReload(): void {
    if (!this.conflictActive) return;
    this.conflictReloadModalTarget.showModal();
  }

  closeConflictReload(): void {
    this.conflictReloadModalTarget.close();
  }

  async confirmConflictReload(): Promise<void> {
    const noteId = this.currentNoteId;
    if (!noteId) return;
    this.conflictReloadModalTarget.close();
    // This is the only path that discards the local editor document.
    this.discardConflictDraft();
    await this.loadDetail(noteId);
    await this.loadActiveList();
  }

  async copyConflictDraft(): Promise<void> {
    const draft = this.editorHandle?.getDoc() ?? this.conflictDraft;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(draft);
      } else {
        const fallback = document.createElement('textarea');
        fallback.value = draft;
        fallback.setAttribute('readonly', '');
        fallback.style.position = 'fixed';
        fallback.style.opacity = '0';
        document.body.appendChild(fallback);
        fallback.select();
        const copied = document.execCommand('copy');
        fallback.remove();
        if (!copied) throw new Error('Clipboard copy was rejected');
      }
      this.conflictStatusTarget.textContent = 'Local draft copied.';
    } catch {
      this.conflictStatusTarget.textContent = 'Could not copy the local draft. Select and copy it from the editor instead.';
    }
  }

  private clearConflict(): void {
    this.conflictActive = false;
    this.conflictDraft = '';
    this.editorHandle?.setAutosavePaused(false);
    this.conflictPanelTarget.classList.add('hidden');
    this.conflictMessageTarget.textContent = '';
    this.conflictStatusTarget.textContent = '';
  }

  /**
   * Explicitly discard a paused conflict draft. Destroying before unpausing is
   * essential: `flush()` restores its pending flag after a rejected save, so
   * resuming first would silently retry and overwrite during the reload flow.
   */
  private discardConflictDraft(): void {
    this.disposeEditorWithoutSaving();
    this.clearConflict();
  }

  /** Tear down an editor after an explicit replacement without invoking flush(). */
  private disposeEditorWithoutSaving(): void {
    const editor = this.editorHandle;
    this.editorHandle = null;
    editor?.destroy();
  }

  /**
   * newNote — create a note in the current folder, open it, and focus the title.
   *
   * NN-2 folder rule (owner-locked):
   *   currentFolder undefined (no selection) → folder = '' (root / "Notes")
   *   currentFolder 'Work' → folder = 'Work'
   *
   * data-action="click->notes#newNote" on the compose button.
   */
  async newNote(): Promise<void> {
    if (this.conflictActive) {
      this.conflictStatusTarget.textContent = 'Resolve the conflict before creating another note.';
      return;
    }
    const folder = this.currentFolder ?? '';
    try {
      const note = await createNote({ title: '', body: '', tags: [], folder });
      await this.loadActiveList();
      await this.loadDetail(note.id);
      // Focus + select-all so the user can immediately type a name.
      const titleInput = this.detailContentTarget.querySelector<HTMLInputElement>(
        '.browse-detail__title'
      );
      if (titleInput) {
        titleInput.focus();
        titleInput.select();
      }
    } catch (err: unknown) {
      if (isJinErrorDto(err)) {
        this.dispatch('error', { detail: err, prefix: 'app', bubbles: true });
      } else {
        console.error('[NotesController] unexpected error creating note:', err);
      }
    }
  }

  /**
   * navigateTo — dispatch jin:navigate so RouterController can open the target section.
   */
  private navigateTo(kind: 'notes' | 'tasks' | 'events', id: string): void {
    if (this.conflictActive) {
      this.conflictStatusTarget.textContent = 'Resolve the conflict before opening another item.';
      this.conflictPanelTarget.focus();
      return;
    }
    this.dispatch('navigate', {
      detail: { kind, id },
      prefix: 'jin',
      bubbles: true,
    });
  }

  private openAttachDialog(noteId: string, targetId: string): void {
    this.dispatch('open-attach', {
      detail: { noteId, targetId },
      prefix: 'jin',
      bubbles: true,
    });
  }

  private openLinkDialog(sourceId: string, targetId: string): void {
    this.dispatch('open-link', {
      detail: { sourceId, targetId },
      prefix: 'jin',
      bubbles: true,
    });
  }

  private get viewElements(): NotesViewElements {
    return {
      listPanel: this.listPanelTarget,
      list: this.listTarget,
      emptyState: this.emptyStateTarget,
      loadingState: this.loadingStateTarget,
      detailPanel: this.detailPanelTarget,
      detailLoadingState: this.detailLoadingStateTarget,
      detailNotFoundState: this.detailNotFoundStateTarget,
      detailContent: this.detailContentTarget,
      // item 1: header action cluster (icon-only attach/link buttons)
      detailActions: this.detailActionsTarget,
    };
  }

  /** Reflect the selected real folder or collection without changing search feedback. */
  private updateScopeTitle(): void {
    if (this.currentCollectionId) {
      const collection = this.collections.find((candidate) => candidate.id === this.currentCollectionId);
      this.scopeTitleTarget.textContent = collection?.name ?? 'All Notes';
      return;
    }
    this.scopeTitleTarget.textContent = this.currentFolder || 'All Notes';
  }

  private isCompactNotesViewport(): boolean {
    return (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 640px)').matches)
      || (document.documentElement.dataset.textScale === 'accessibility' && window.innerWidth < 760);
  }

  private collapsePaneForCompactNavigation(): void {
    if (!this.isCompactNotesViewport()) return;
    this.paneCollapsed = true;
    this.element.classList.add('rail-collapsed');
  }

  private get viewTemplates(): NotesTemplates {
    const noteRowEl = document.getElementById('tmpl-note-row') as HTMLTemplateElement | null;
    const backlinkRowEl = document.getElementById(
      'tmpl-backlink-row'
    ) as HTMLTemplateElement | null;
    const folderRowEl = document.getElementById('tmpl-folder-row') as HTMLTemplateElement | null;
    if (!noteRowEl || !backlinkRowEl || !folderRowEl) {
      throw new Error(
        '[NotesController] required <template> elements not found. ' +
          'Ensure #tmpl-note-row, #tmpl-backlink-row, and #tmpl-folder-row are present in the document.'
      );
    }
    return { noteRow: noteRowEl, backlinkRow: backlinkRowEl, folderRow: folderRowEl };
  }
}
