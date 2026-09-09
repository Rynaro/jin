/**
 * notes/render.ts — DOM rendering functions for the Notes browse + detail view.
 *
 * All rendering uses <template> cloning (list rows) or createElement (detail panels).
 * No raw innerHTML string injection — only template cloning + textContent/attribute assignment.
 *
 * The controller (NotesController) calls these as a thin adapter.
 * Tested by: src/__tests__/notes_controller.test.ts
 */

import type { NoteDto, BacklinkDto, FolderDto, LinkDto } from '../../types/dto';
import { noteStatusLabel, noteStatusGlyph, noteStatusTooltip, formatNoteDate, noteDisplayTitle } from './transform';

let statusInfoSequence = 0;
import { mountEditor, type EditorHandle } from './editor';
import type { TreeNode } from './folderTree';

// ── Interface types ───────────────────────────────────────────────────────────

/** References to the named target elements managed by NotesController. */
export interface NotesViewElements {
  listPanel: HTMLElement;
  list: HTMLElement;
  emptyState: HTMLElement;
  loadingState: HTMLElement;
  detailPanel: HTMLElement;
  detailLoadingState: HTMLElement;
  detailNotFoundState: HTMLElement;
  detailContent: HTMLElement;
  /**
   * Optional: header container for icon-only attach/link action buttons (item 1).
   * When present, renderNoteDetail populates it with icon-only buttons rather than
   * appending full-width pills to the scroll region.
   */
  detailActions?: HTMLElement;
}

/** References to the <template> elements used for dynamic rows. */
export interface NotesTemplates {
  noteRow: HTMLTemplateElement;
  backlinkRow: HTMLTemplateElement;
  folderRow: HTMLTemplateElement;
}

/**
 * BrowseNavigateCallback — fired when the user activates a cross-object link.
 * kind: 'notes' | 'tasks' | 'events'
 * id: the Jin object id to navigate to
 */
export type BrowseNavigateCallback = (kind: 'notes' | 'tasks' | 'events', id: string) => void;

// ── Lifecycle helpers ─────────────────────────────────────────────────────────

export function showListLoading(el: NotesViewElements): void {
  el.loadingState.classList.remove('hidden');
  el.list.classList.add('hidden');
  el.emptyState.classList.add('hidden');
}

export function hideListLoading(el: NotesViewElements): void {
  el.loadingState.classList.add('hidden');
  el.list.classList.remove('hidden');
}

export function showListEmptyState(el: NotesViewElements): void {
  el.list.classList.add('hidden');
  el.emptyState.classList.remove('hidden');
}

// ── Folder tree rendering (Wave 2B — tree + keyboard nav) ────────────────────

/**
 * renderFolderTree — populate the folder rail with a recursive WAI-ARIA tree.
 *
 * Clears the container, sets role="tree", then recursively clones
 * #tmpl-folder-row for each TreeNode (treeitem + nested ul[role=group]).
 *
 * D-SELECTOR-STABILITY: retains .folder-row__btn[data-folder-path] as a
 * non-focusable div with a click-to-select listener, keeping VG-FE /
 * VG-FE-FOLDER-OPEN gates green with zero test edits.
 *
 * D-RERENDER: full re-render only on data refresh (loadFolders). Expand/collapse
 * + keyboard nav use the targeted-DOM helpers (setTreeItemExpanded, focusTreeItem).
 */
export function renderFolderTree(
  folderListEl: HTMLElement,
  templates: NotesTemplates,
  tree: TreeNode[],
  view: {
    activeFolder: string | undefined;
    expanded: Set<string>;
    focusedPath: string | null;
  },
  cb: {
    onSelect: (path: string) => void;
    onToggle: (path: string) => void;
    /** S4: drop a note onto this folder (D-DRAG-DATA). */
    onDropNote?: (folderPath: string, noteId: string) => void;
    /** S5: open the rename dialog for this folder path. */
    onRename?: (folderPath: string) => void;
    /** S5: open the delete confirm dialog for this folder path. */
    onDelete?: (folderPath: string) => void;
    /** S5: open the New Subfolder dialog with this folder as parent. */
    onNewSubfolder?: (folderPath: string) => void;
  }
): void {
  folderListEl.innerHTML = '';
  folderListEl.setAttribute('role', 'tree');

  // Determine the initial focused path for roving tabindex.
  // Preference order: explicitly set focusedPath → activeFolder → first node.
  const effectiveFocused = view.focusedPath ?? view.activeFolder ?? null;

  function buildNode(node: TreeNode): HTMLElement {
    const frag = templates.folderRow.content.cloneNode(true) as DocumentFragment;
    const li = frag.firstElementChild as HTMLElement;

    const btn = li.querySelector<HTMLElement>('.folder-row__btn');
    const chevronEl = li.querySelector<HTMLElement>('.folder-row__chevron');
    const nameEl = li.querySelector('.folder-row__name');
    const countEl = li.querySelector('.folder-row__count');
    const groupEl = li.querySelector<HTMLElement>('.folder-row__group');

    // ── treeitem role + ARIA attributes ─────────────────────────────────────
    li.setAttribute('role', 'treeitem');
    li.setAttribute('aria-level', String(node.depth + 1));
    li.setAttribute('aria-selected', node.path === view.activeFolder ? 'true' : 'false');
    // Roving tabindex: one 0 (focused/active), rest -1.
    li.setAttribute('tabindex', node.path === effectiveFocused ? '0' : '-1');
    if (node.path === view.activeFolder) {
      li.classList.add('is-active');
    }
    // aria-expanded only on parents (D-ARIA spec).
    if (node.isParent) {
      const isExpanded = view.expanded.has(node.path);
      li.setAttribute('aria-expanded', String(isExpanded));
    }

    // ── .folder-row__btn (non-focusable div, D-SELECTOR-STABILITY) ──────────
    if (btn) {
      btn.dataset.folderPath = node.path;
      // Depth-based indent via CSS custom property.
      btn.style.setProperty('--tree-depth', String(node.depth));
      // Row-body click → select (fires via both mouse and programmatic .click()).
      btn.addEventListener('click', (e) => {
        // If the click originated from the chevron it has already been stopped;
        // this listener only fires for the non-chevron row body.
        e.stopPropagation();
        cb.onSelect(node.path);
      });

      // ── S4: Drop target for note drag-and-drop (D-DRAG-DATA) ────────────
      if (cb.onDropNote) {
        btn.addEventListener('dragover', (e: DragEvent) => {
          e.preventDefault();
          btn.classList.add('folder-row__btn--drop-target');
        });
        btn.addEventListener('dragleave', () => {
          btn.classList.remove('folder-row__btn--drop-target');
        });
        btn.addEventListener('drop', (e: DragEvent) => {
          e.preventDefault();
          btn.classList.remove('folder-row__btn--drop-target');
          const noteId = e.dataTransfer?.getData('application/x-jin-note-id') ?? '';
          if (noteId) cb.onDropNote!(node.path, noteId);
        });
      }
    }

    // ── S5: Per-row kebab menu (D-AFFORDANCE) ────────────────────────────
    const menuBtn = li.querySelector<HTMLElement>('.folder-row__menu-btn');
    const menu = li.querySelector<HTMLElement>('.folder-row__menu');
    const menuItems = li.querySelectorAll<HTMLElement>('.folder-row__menuitem');

    if (menuBtn && menu) {
      const openMenu = () => {
        menuBtn.setAttribute('aria-expanded', 'true');
        menu.removeAttribute('hidden');
      };
      const closeMenu = () => {
        menuBtn.setAttribute('aria-expanded', 'false');
        menu.setAttribute('hidden', '');
      };

      menuBtn.addEventListener('click', (e: Event) => {
        e.stopPropagation(); // never triggers row select or chevron toggle
        const isOpen = menuBtn.getAttribute('aria-expanded') === 'true';
        if (isOpen) closeMenu(); else openMenu();
      });

      // Escape closes the menu
      li.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Escape' && menuBtn.getAttribute('aria-expanded') === 'true') {
          e.stopPropagation();
          closeMenu();
          menuBtn.focus();
        }
      });

      // Outside-click closes the menu (document-level, one per node)
      const outsideClick = (e: Event) => {
        if (!li.contains(e.target as Node)) closeMenu();
      };
      document.addEventListener('click', outsideClick);

      // Wire menuitems: [0]=Rename [1]=Delete [2]=New Subfolder
      const wireItem = (index: number, handler: (() => void) | undefined) => {
        const item = menuItems[index];
        if (item && handler) {
          item.addEventListener('click', (e: Event) => {
            e.stopPropagation();
            closeMenu();
            handler();
          });
        }
      };
      wireItem(0, cb.onRename ? () => cb.onRename!(node.path) : undefined);
      wireItem(1, cb.onDelete ? () => cb.onDelete!(node.path) : undefined);
      wireItem(2, cb.onNewSubfolder ? () => cb.onNewSubfolder!(node.path) : undefined);
    }

    // ── Chevron (parents) / leaf spacer ─────────────────────────────────────
    if (chevronEl) {
      if (!node.isParent) {
        // Leaf: clear the icon to produce an equal-width spacer for label alignment.
        const icon = chevronEl.querySelector('i');
        if (icon) icon.remove();
        chevronEl.classList.add('folder-row__chevron--leaf');
      } else {
        // Parent: chevron click toggles expand ONLY (stopPropagation → no select).
        chevronEl.addEventListener('click', (e) => {
          e.stopPropagation();
          cb.onToggle(node.path);
        });
      }
    }

    // ── Text content ─────────────────────────────────────────────────────────
    if (nameEl) nameEl.textContent = node.name;
    if (countEl) countEl.textContent = node.note_count > 0 ? String(node.note_count) : '';

    // ── Children (rendered eagerly; visibility controlled by [hidden]) ───────
    if (node.isParent && node.children.length > 0 && groupEl) {
      const isExpanded = view.expanded.has(node.path);
      if (isExpanded) {
        groupEl.removeAttribute('hidden');
      } else {
        groupEl.setAttribute('hidden', '');
      }
      for (const child of node.children) {
        groupEl.appendChild(buildNode(child));
      }
    }

    return li;
  }

  for (const node of tree) {
    folderListEl.appendChild(buildNode(node));
  }
}

// ── Targeted-DOM helpers (used by controller on expand/collapse + keyboard) ───

/**
 * setTreeItemExpanded — flip aria-expanded and show/hide the child group for one
 * path, WITHOUT a full re-render (D-RERENDER targeted-DOM path).
 */
export function setTreeItemExpanded(
  container: HTMLElement,
  path: string,
  expanded: boolean
): void {
  const escapedPath = path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const btn = container.querySelector<HTMLElement>(`.folder-row__btn[data-folder-path="${escapedPath}"]`);
  const li = btn?.closest<HTMLElement>('[role="treeitem"]');
  if (!li) return;

  li.setAttribute('aria-expanded', String(expanded));
  const group = li.querySelector<HTMLElement>('.folder-row__group');
  if (group) {
    if (expanded) {
      group.removeAttribute('hidden');
    } else {
      group.setAttribute('hidden', '');
    }
  }
}

/**
 * focusTreeItem — apply roving tabindex + DOM focus to a single treeitem by path.
 *
 * Resets all treeitems in the container to tabindex=-1, then sets the target
 * treeitem to tabindex=0 and calls .focus(). Safe to call with paths that are
 * currently visible (inside a non-hidden group).
 */
export function focusTreeItem(container: HTMLElement, path: string): void {
  // Reset all treeitems.
  container.querySelectorAll<HTMLElement>('[role="treeitem"]').forEach((item) => {
    item.setAttribute('tabindex', '-1');
  });

  // Focus the target.
  const escapedPath = path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const btn = container.querySelector<HTMLElement>(`.folder-row__btn[data-folder-path="${escapedPath}"]`);
  const li = btn?.closest<HTMLElement>('[role="treeitem"]');
  if (li) {
    li.setAttribute('tabindex', '0');
    li.focus();
  }
}

// ── Legacy flat folder list (kept as thin alias for backward compatibility) ───

/** @deprecated Use renderFolderTree with a pre-built TreeNode tree instead. */
export function renderFolderRail(
  folderListEl: HTMLElement,
  templates: NotesTemplates,
  folders: FolderDto[],
  activeFolder: string | undefined,
  onSelect: (path: string) => void
): void {
  // Thin shim: build a flat tree (no hierarchy) and render it.
  folderListEl.innerHTML = '';
  folderListEl.setAttribute('role', 'tree');

  for (const folder of folders) {
    const frag = templates.folderRow.content.cloneNode(true) as DocumentFragment;
    const li = frag.firstElementChild as HTMLElement;
    const btn = li.querySelector<HTMLElement>('.folder-row__btn');
    const nameEl = li.querySelector('.folder-row__name');
    const countEl = li.querySelector('.folder-row__count');
    const chevronEl = li.querySelector<HTMLElement>('.folder-row__chevron');

    li.setAttribute('role', 'treeitem');
    li.setAttribute('aria-selected', folder.path === activeFolder ? 'true' : 'false');
    li.setAttribute('tabindex', '-1');
    if (folder.path === activeFolder) li.classList.add('is-active');

    if (btn) {
      btn.dataset.folderPath = folder.path;
      btn.addEventListener('click', () => onSelect(folder.path));
    }
    if (chevronEl) {
      const icon = chevronEl.querySelector('i');
      if (icon) icon.remove();
      chevronEl.classList.add('folder-row__chevron--leaf');
    }
    if (nameEl) nameEl.textContent = folder.name;
    if (countEl) countEl.textContent = folder.note_count > 0 ? String(folder.note_count) : '';

    folderListEl.appendChild(li);
  }
}

// ── List rendering ────────────────────────────────────────────────────────────

/**
 * renderNotesList — populate the notes list with the given notes.
 *
 * - Clears existing rows.
 * - Clones the note-row <template> for each note.
 * - Renders title, status badge (text + glyph, never color-only), and tags.
 * - Shows the empty state when notes is empty.
 * - Fires onNavigate when a row is activated.
 */
export function renderNotesList(
  el: NotesViewElements,
  templates: NotesTemplates,
  notes: NoteDto[],
  onNavigate: BrowseNavigateCallback
): void {
  el.list.innerHTML = '';

  if (notes.length === 0) {
    showListEmptyState(el);
    return;
  }

  el.emptyState.classList.add('hidden');
  el.list.classList.remove('hidden');

  for (const note of notes) {
    el.list.appendChild(buildNoteRow(templates, note, onNavigate));
  }
}

// ── Detail rendering ──────────────────────────────────────────────────────────

/**
 * renderNoteDetail — populate the note detail panel with the given note.
 *
 * Renders:
 *   - Title, status badge
 *   - Tags list
 *   - Body (raw text of body_markdown — safe, no script execution)
 *   - Outgoing links (navigable)
 *   - Incoming backlinks (navigable)
 *
 * All link/backlink items are rendered with id + label visible
 * and clicking fires onNavigate so they are reachable.
 */
/**
 * renderNoteDetail — populate the note detail panel with the given note.
 *
 * Apple-Notes-style layout (post-restyle):
 *   detailContent (flex column)
 *   ├── title (.browse-detail__title, flex-shrink:0)
 *   └── bodyEl (.note-detail__body, flex:1) — receives the mountEditor output:
 *       ├── .cm-toolbar (formatting toolbar, flex-shrink:0)
 *       ├── .cm-scroll-region (flex:1; overflow-y:auto)
 *       │   ├── .browse-detail__meta     ← prepended here (status + tags)
 *       │   ├── .cm-editor-wrapper       ← CM6 source editor
 *       │   ├── .cm-reading-wrapper      ← sanitized reading view
 *       │   ├── .browse-detail__links-section (outgoing links, if any)
 *       │   ├── .browse-detail__links-section (backlinks, if any)
 *       │   └── .browse-detail__actions  (attach/link buttons, if any)
 *       └── .cm-footer (stats + save status, flex-shrink:0)
 *
 * Returns an EditorHandle for the mounted CM6 editor so the controller can
 * flush, destroy, and inspect the editor (caret-safe autosave pattern, §5 spec).
 */
export function renderNoteDetail(
  el: NotesViewElements,
  templates: NotesTemplates,
  note: NoteDto,
  onNavigate: BrowseNavigateCallback,
  onAttach?: (noteId: string, targetId: string) => void,
  onLink?: (sourceId: string, targetId: string) => void,
  onSave?: (body: string) => Promise<void>,
  onTitleSave?: (newTitle: string) => Promise<void>,
  onAddAttachment?: (noteId: string) => void,
  onHistory?: (noteId: string) => void,
  onTagsChange?: (add: string[], remove: string[]) => Promise<void>,
): EditorHandle {
  el.detailContent.innerHTML = '';

  // ── Title row (title input + status badge, fixed above the scroll region) ─
  // Gap-B fix: wraps the title input and status badge in a .browse-detail__title-row
  // flex container so the badge sits right-aligned beside the title, above the
  // scroll region, rather than inside it.
  // NN-1: inline-editable input. XSS-safe via .value (never innerHTML).
  // Keeps .browse-detail__title class so existing selectors/tests stay valid.
  const titleRowEl = document.createElement('div');
  titleRowEl.className = 'browse-detail__title-row';

  const titleEl = document.createElement('textarea');
  titleEl.rows = 1;
  titleEl.className = 'browse-detail__title browse-detail__title--input jin-title-field text-title2';
  titleEl.value = note.title;
  titleEl.placeholder = 'Untitled';
  titleEl.setAttribute('aria-label', 'Note title');
  titleEl.setAttribute('aria-multiline', 'true');
  titleRowEl.appendChild(titleEl);

  // ── Status badge (title row, right-aligned via flex) ─────────────────────
  // has-tooltip: item-4 — hover/focus tooltip balloon explaining the status.
  // Moved out of metaEl/scroll-region so it renders on the title row (Gap-B fix).
  const statusEl = document.createElement('button');
  statusEl.type = 'button';
  statusEl.className = 'note-detail__status';
  statusEl.dataset.noteStatus = note.status.toLowerCase();
  const label = noteStatusLabel(note.status);
  const tooltip = noteStatusTooltip(note.status);
  statusEl.setAttribute('aria-label', tooltip);
  statusEl.setAttribute('aria-expanded', 'false');

  const statusIconEl = document.createElement('i');
  statusIconEl.className = 'note-detail__status-icon';
  statusIconEl.setAttribute('data-lucide', noteStatusGlyph(note.status));
  statusIconEl.setAttribute('aria-hidden', 'true');

  const statusLabelEl = document.createElement('span');
  statusLabelEl.className = 'note-detail__status-label';
  statusLabelEl.textContent = label;

  const statusInfoEl = document.createElement('span');
  statusInfoEl.className = 'note-detail__status-info';
  statusInfoEl.id = `jin-note-status-info-${++statusInfoSequence}`;
  statusInfoEl.setAttribute('role', 'tooltip');
  statusInfoEl.textContent = tooltip;
  statusEl.setAttribute('aria-describedby', statusInfoEl.id);

  statusEl.appendChild(statusIconEl);
  statusEl.appendChild(statusLabelEl);
  statusEl.appendChild(statusInfoEl);

  const closeStatusInfo = (): void => {
    statusEl.classList.remove('is-explaining');
    statusEl.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', closeStatusInfoOnOutsidePress);
  };
  const closeStatusInfoOnOutsidePress = (event: PointerEvent): void => {
    if (!statusEl.contains(event.target as Node)) closeStatusInfo();
  };
  statusEl.addEventListener('click', () => {
    statusEl.classList.remove('suppress-focus-info');
    const opening = !statusEl.classList.contains('is-explaining');
    closeStatusInfo();
    if (opening) {
      statusEl.classList.add('is-explaining');
      statusEl.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', closeStatusInfoOnOutsidePress);
    }
  });
  statusEl.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    statusEl.classList.add('suppress-focus-info');
    closeStatusInfo();
  });
  statusEl.addEventListener('blur', () => {
    statusEl.classList.remove('suppress-focus-info');
    closeStatusInfo();
  });

  // Title save wiring (D-TITLE-SAVE-TRIGGER):
  //   blur + Enter commit (dirty-check vs baseline; committing guard prevents double-save).
  //   Escape reverts to baseline; blur that follows is a dirty-check no-op.
  //   On error: baseline NOT advanced → retry on next blur.
  let titleBaseline = note.title;
  let committing = false;

  titleEl.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      titleEl.blur();
    } else if (e.key === 'Escape') {
      titleEl.value = titleBaseline;
      e.preventDefault();
      titleEl.blur();
    }
  });

  const resizeTitle = (): void => {
    titleEl.style.height = 'auto';
    titleEl.style.height = `${titleEl.scrollHeight}px`;
  };
  titleEl.addEventListener('input', resizeTitle);
  const titleResizeFrame = requestAnimationFrame(resizeTitle);
  // A long title can wrap after a narrow pane, text-scale, or reading-mode
  // layout change. Keep the textarea's visible height in sync with its width.
  let titleResizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    titleResizeObserver = new ResizeObserver(resizeTitle);
    titleResizeObserver.observe(titleRowEl);
  }

  titleEl.addEventListener('blur', () => {
    if (committing) return;
    const newTitle = titleEl.value;
    if (newTitle === titleBaseline) return; // dirty-check: no-op if unchanged
    committing = true;
    void (onTitleSave ? onTitleSave(newTitle) : Promise.resolve())
      .then(() => {
        titleBaseline = newTitle; // advance baseline only on success
      })
      .catch(() => {
        // on error: keep input value, do NOT advance baseline (retry on next blur)
      })
      .finally(() => {
        committing = false;
      });
  });

  // ── Tags (quiet metadata in the document header, never in prose flow) ────
  // Status badge is now in the title row; only tags live in metaEl.
  const metaEl = document.createElement('div');
  metaEl.className = 'browse-detail__meta';

  const renderTags = (): void => {
    metaEl.replaceChildren();
    const tagsEl = document.createElement('div');
    tagsEl.className = 'note-detail__tags text-caption1';
    tagsEl.setAttribute('aria-label', note.tags.length ? `Tags: ${note.tags.join(', ')}` : 'No tags');
    for (const tag of note.tags) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'note-detail__tag-chip';
      chip.textContent = `#${tag}`;
      chip.setAttribute('aria-label', `Rename tag ${tag}`);
      chip.title = `Rename ${tag}`;
      chip.addEventListener('click', () => {
        const input = tagsEl.querySelector<HTMLInputElement>('.note-detail__tag-input');
        if (!input) return;
        input.value = tag;
        input.dataset.replaceTag = tag;
        input.placeholder = 'Rename tag';
        input.setAttribute('aria-label', `Rename tag ${tag}`);
        input.focus();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'note-detail__tag-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove tag ${tag}`);
      remove.addEventListener('click', () => {
      void onTagsChange?.([], [tag]).then(() => {
          note.tags = note.tags.filter((value) => value !== tag);
          renderTags();
          el.detailActions?.querySelector<HTMLButtonElement>('[data-tooltip="Manage tags"]')?.setAttribute('aria-label', `Manage tags${note.tags.length ? ` (${note.tags.length})` : ''}`);
        }).catch(() => { /* controller has already surfaced the mutation error */ });
      });
      tagsEl.appendChild(chip);
      tagsEl.appendChild(remove);
    }
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'note-detail__tag-input';
    input.placeholder = 'Add tag';
    input.setAttribute('aria-label', 'Add tag');
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const tag = input.value.trim().replace(/^#/, '');
      const replace = input.dataset.replaceTag;
      if (!tag || note.tags.includes(tag) && tag !== replace) return;
      if (tag === replace) { renderTags(); return; }
      void onTagsChange?.([tag], replace ? [replace] : []).then(() => {
        note.tags = replace ? note.tags.map(value => value === replace ? tag : value) : [...note.tags, tag];
        input.value = '';
        delete input.dataset.replaceTag;
        renderTags();
        el.detailActions?.querySelector<HTMLButtonElement>('[data-tooltip="Manage tags"]')?.setAttribute('aria-label', `Manage tags (${note.tags.length})`);
      }).catch(() => { /* controller has already surfaced the mutation error */ });
    });
    tagsEl.appendChild(input);
    metaEl.appendChild(tagsEl);
  };
  renderTags();

  // ── Body — CM6 source editor (S1/S2/S3 of spec) ─────────────────────────
  // mountEditor creates: formatting toolbar + scroll region + stats footer.
  // The scroll region exposes the .cm-scroll-region element so we can
  // inject tags above the editor and links/actions below it.
  const bodyEl = document.createElement('div');
  bodyEl.className = 'note-detail__body';
  const editorHandle = mountEditor(bodyEl, {
    doc: note.body_markdown ?? '',
    onSave: onSave ?? (async () => {}),
    onAddAttachment: () => onAddAttachment?.(note.id),
  });
  const destroyEditor = editorHandle.destroy.bind(editorHandle);
  editorHandle.destroy = (): void => {
    cancelAnimationFrame(titleResizeFrame);
    titleResizeObserver?.disconnect();
    titleResizeObserver = null;
    closeStatusInfo();
    destroyEditor();
  };

  // Title and body are one writing flow: Enter commits the title and moves into
  // the document; ArrowDown at its end does the same without re-mounting CM6.
  titleEl.addEventListener('keydown', (event) => {
    const atEnd = titleEl.selectionStart === titleEl.value.length && titleEl.selectionEnd === titleEl.value.length;
    if (event.key === 'Enter' || (event.key === 'ArrowDown' && atEnd)) {
      event.preventDefault();
      titleEl.blur();
      editorHandle.focus();
    }
  });

  // Get the scroll region created by mountEditor; fall back to bodyEl.
  const scrollRegion = bodyEl.querySelector('.cm-scroll-region') ?? bodyEl;

  // The toolbar is document chrome, so it sits above the title. The title and
  // editor then become one uninterrupted writing column below it.
  const toolbar = bodyEl.querySelector<HTMLElement>('.cm-toolbar');
  if (toolbar) el.detailContent.appendChild(toolbar);
  el.detailContent.appendChild(bodyEl);
  // Title is part of the same scrollable writing surface as the body.  The
  // toolbar stays above it as document chrome; tags live in their popover.
  scrollRegion.insertBefore(titleRowEl, scrollRegion.firstChild);

  // ── Outgoing links (appended into scroll region, after the editor) ────────
  if (note.links.length > 0) {
    const linksSection = buildLinksSection('Links', note.links, templates, onNavigate);
    scrollRegion.appendChild(linksSection);
  }

  // ── Incoming backlinks ────────────────────────────────────────────────────
  if (note.backlinks.length > 0) {
    const backlinksSection = buildBacklinksSection('Backlinks', note.backlinks, templates, onNavigate);
    scrollRegion.appendChild(backlinksSection);
  }

  // ── Attach / Link actions — icon-only cluster in the detail header (item 1) ─
  // When el.detailActions is present (Notes view), populate it with icon-only
  // ghost buttons (`.cm-toolbar__btn`) with hover/focus tooltip balloons.
  // The old full-width pill buttons appended to the scroll region are replaced.
  // Callbacks are unchanged: onAttach dispatches open-attach, onLink open-link.
  if ((onAttach || onLink || onAddAttachment || onHistory) && el.detailActions) {
    el.detailActions.innerHTML = '';
    el.detailActions.appendChild(statusEl);

    if (onAttach) {
      const attachBtn = document.createElement('button');
      attachBtn.type = 'button';
      attachBtn.className = 'cm-toolbar__btn jin-control jin-control--icon has-tooltip';
      attachBtn.setAttribute('aria-label', `Attach "${note.title}" to an event`);
      attachBtn.setAttribute('data-tooltip', 'Attach to Event');
      attachBtn.dataset.noteId = note.id;

      const attachIcon = document.createElement('i');
      attachIcon.setAttribute('data-lucide', 'link');
      attachIcon.setAttribute('aria-hidden', 'true');

      attachBtn.appendChild(attachIcon);
      attachBtn.addEventListener('click', () => onAttach(note.id, ''));
      el.detailActions.appendChild(attachBtn);
    }

    if (onLink) {
      const linkBtn = document.createElement('button');
      linkBtn.type = 'button';
      linkBtn.className = 'cm-toolbar__btn jin-control jin-control--icon has-tooltip';
      linkBtn.setAttribute('aria-label', 'Connect this note');
      linkBtn.setAttribute('data-tooltip', 'Connect');
      linkBtn.dataset.sourceId = note.id;

      const linkIcon = document.createElement('i');
      linkIcon.setAttribute('data-lucide', 'git-branch');
      linkIcon.setAttribute('aria-hidden', 'true');

      linkBtn.appendChild(linkIcon);
      linkBtn.addEventListener('click', () => onLink(note.id, ''));
      el.detailActions.appendChild(linkBtn);
    }

    if (onHistory) {
      const historyBtn = document.createElement('button');
      historyBtn.type = 'button';
      historyBtn.className = 'cm-toolbar__btn jin-control jin-control--icon has-tooltip';
      historyBtn.setAttribute('aria-label', 'Review note history');
      historyBtn.setAttribute('data-tooltip', 'History');

      const icon = document.createElement('i');
      icon.setAttribute('data-lucide', 'history');
      icon.setAttribute('aria-hidden', 'true');
      historyBtn.appendChild(icon);
      historyBtn.addEventListener('click', () => onHistory(note.id));
      el.detailActions.appendChild(historyBtn);
    }
    // Tags belong to compact document chrome rather than the title/body flow.
    const tagsButton = document.createElement('button');
    tagsButton.type = 'button';
    tagsButton.className = 'cm-toolbar__btn jin-control jin-control--icon has-tooltip';
    tagsButton.setAttribute('aria-label', `Manage tags${note.tags.length ? ` (${note.tags.length})` : ''}`);
    tagsButton.setAttribute('data-tooltip', 'Manage tags');
    tagsButton.setAttribute('aria-expanded', 'false');
    const tagsIcon = document.createElement('i');
    tagsIcon.setAttribute('data-lucide', 'tag');
    tagsIcon.setAttribute('aria-hidden', 'true');
    tagsButton.appendChild(tagsIcon);
    tagsButton.addEventListener('click', () => {
      const open = metaEl.classList.toggle('is-open');
      tagsButton.setAttribute('aria-expanded', String(open));
      if (open) metaEl.querySelector<HTMLInputElement>('input')?.focus();
    });
    el.detailActions.appendChild(tagsButton);
    el.detailActions.appendChild(metaEl);
  } else {
    // Rendering helpers are also used outside the full Notes shell in tests and
    // previews; keep this truthful metadata reachable in that minimal host.
    titleRowEl.append(statusEl, metaEl);
  }

  return editorHandle;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function buildNoteRow(
  templates: NotesTemplates,
  note: NoteDto,
  onNavigate: BrowseNavigateCallback
): HTMLElement {
  const frag = templates.noteRow.content.cloneNode(true) as DocumentFragment;
  const row = frag.firstElementChild as HTMLElement;

  const btnEl = row.querySelector('.browse-row__inner') as HTMLElement | null;
  const titleEl = row.querySelector('.browse-row__title');
  const statusIconEl = row.querySelector('.note-row__status-icon');
  const statusLabelEl = row.querySelector('.note-row__status-label');
  const statusBadgeEl = row.querySelector('.note-row__status') as HTMLElement | null;
  const tagsEl = row.querySelector('.note-row__tags');
  // S3: Apple-Notes list row additions
  const snippetEl = row.querySelector('.note-row__snippet');
  const dateEl = row.querySelector('.note-row__date');

  if (btnEl) {
    btnEl.dataset.noteId = note.id;
    // S4: store current folder so the drop-target same-folder guard can read it.
    btnEl.dataset.noteFolder = note.folder_path ?? '';
    // NN-1: use noteDisplayTitle so empty titles show "Untitled" in the list and aria-label.
    btnEl.setAttribute('aria-label', noteDisplayTitle(note.title));
    // S4: make note rows draggable (D-DRAG-DATA)
    btnEl.setAttribute('draggable', 'true');
    btnEl.addEventListener('dragstart', (e: DragEvent) => {
      if (e.dataTransfer) {
        e.dataTransfer.setData('application/x-jin-note-id', note.id);
        e.dataTransfer.setData('text/plain', note.id);
        e.dataTransfer.effectAllowed = 'move';
      }
    });
    btnEl.addEventListener('click', () => {
      onNavigate('notes', note.id);
    });
  }

  // NN-1: use noteDisplayTitle so empty titles show "Untitled" in the list row.
  if (titleEl) titleEl.textContent = noteDisplayTitle(note.title);

  // #3: every note is "active" by default — showing the badge on every row is noise.
  //     Only render the status badge for non-active states (archived, etc.).
  if (note.status === 'active') {
    if (statusBadgeEl) statusBadgeEl.hidden = true;
  } else {
    const lbl = noteStatusLabel(note.status);
    if (statusBadgeEl) statusBadgeEl.setAttribute('aria-label', `Status: ${lbl}`);
    if (statusIconEl) statusIconEl.setAttribute('data-lucide', noteStatusGlyph(note.status));
    if (statusLabelEl) statusLabelEl.textContent = lbl;
  }

  if (tagsEl) {
    tagsEl.textContent = note.tags.length > 0 ? note.tags.map((t) => `#${t}`).join(' ') : '';
    tagsEl.setAttribute('aria-label', note.tags.length > 0 ? `Tags: ${note.tags.join(', ')}` : '');
  }

  // S3: populate snippet (textContent = XSS-safe) and formatted date.
  if (snippetEl) {
    snippetEl.textContent = note.excerpt ?? '';
  }
  if (dateEl) {
    dateEl.textContent = formatNoteDate(note.updated);
  }

  return row;
}

/**
 * buildLinksSection — builds a "Links" section with navigable link items (outgoing edges).
 */
function buildLinksSection(
  heading: string,
  links: LinkDto[],
  templates: NotesTemplates,
  onNavigate: BrowseNavigateCallback
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'browse-detail__links-section';
  section.setAttribute('aria-label', heading);

  const h3 = document.createElement('h3');
  h3.className = 'browse-detail__links-heading text-subheadline';
  h3.textContent = heading;
  section.appendChild(h3);

  const ul = document.createElement('ul');
  ul.className = 'browse-detail__links-list';
  ul.setAttribute('role', 'list');

  for (const link of links) {
    ul.appendChild(buildLinkItem(link, templates, onNavigate));
  }

  section.appendChild(ul);
  return section;
}

/**
 * buildBacklinksSection — builds a "Backlinks" section with navigable backlink items (incoming edges).
 */
function buildBacklinksSection(
  heading: string,
  backlinks: BacklinkDto[],
  templates: NotesTemplates,
  onNavigate: BrowseNavigateCallback
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'browse-detail__links-section';
  section.setAttribute('aria-label', heading);

  const h3 = document.createElement('h3');
  h3.className = 'browse-detail__links-heading text-subheadline';
  h3.textContent = heading;
  section.appendChild(h3);

  const ul = document.createElement('ul');
  ul.className = 'browse-detail__links-list';
  ul.setAttribute('role', 'list');

  for (const backlink of backlinks) {
    ul.appendChild(buildBacklinkItem(backlink, templates, onNavigate));
  }

  section.appendChild(ul);
  return section;
}

function buildLinkItem(
  link: LinkDto,
  templates: NotesTemplates,
  onNavigate: BrowseNavigateCallback
): HTMLElement {
  const frag = templates.backlinkRow.content.cloneNode(true) as DocumentFragment;
  const row = frag.firstElementChild as HTMLElement;

  const btnEl = row.querySelector('.browse-link-row__btn') as HTMLElement | null;
  const labelEl = row.querySelector('.browse-link-row__label');
  const idEl = row.querySelector('.browse-link-row__id');

  if (btnEl) {
    btnEl.dataset.linkId = link.target;
    btnEl.dataset.linkKind = 'note';
    btnEl.setAttribute('aria-label', `Link to: ${link.target} (${link.edge_type})`);
    btnEl.addEventListener('click', () => {
      onNavigate('notes', link.target);
    });
  }

  if (labelEl) labelEl.textContent = `${link.edge_type}: ${link.target}`;
  if (idEl) idEl.textContent = link.target;

  return row;
}

function buildBacklinkItem(
  backlink: BacklinkDto,
  templates: NotesTemplates,
  onNavigate: BrowseNavigateCallback
): HTMLElement {
  const frag = templates.backlinkRow.content.cloneNode(true) as DocumentFragment;
  const row = frag.firstElementChild as HTMLElement;

  const btnEl = row.querySelector('.browse-link-row__btn') as HTMLElement | null;
  const labelEl = row.querySelector('.browse-link-row__label');
  const idEl = row.querySelector('.browse-link-row__id');

  const displayLabel = backlink.label || backlink.source_id;

  if (btnEl) {
    btnEl.dataset.linkId = backlink.source_id;
    btnEl.dataset.linkKind = backlink.source_kind;
    btnEl.setAttribute('aria-label', `${backlink.source_kind}: ${displayLabel}`);
    btnEl.addEventListener('click', () => {
      const kind = resolveKind(backlink.source_kind);
      onNavigate(kind, backlink.source_id);
    });
  }

  if (labelEl) labelEl.textContent = displayLabel;
  if (idEl) idEl.textContent = backlink.source_id;

  return row;
}

/**
 * resolveKind — maps a source_kind string to a valid BrowseNavigateCallback kind.
 */
function resolveKind(sourceKind: string): 'notes' | 'tasks' | 'events' {
  switch (sourceKind.toLowerCase()) {
    case 'task':
      return 'tasks';
    case 'event':
      return 'events';
    default:
      return 'notes';
  }
}
