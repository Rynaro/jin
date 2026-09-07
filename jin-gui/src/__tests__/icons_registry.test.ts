// @vitest-environment jsdom
/**
 * icons_registry.test.ts — AC-X-03 icon-registry sweep (S8's own action plan
 * item 4: "every data-lucide name introduced anywhere in the wave is
 * registered in src/lib/icons/index.ts").
 *
 * Design (why this is NOT a hand-typed name list, and so cannot drift the way
 * a duplicated list would — the exact bug class the R4 audit is about):
 *
 *   Lucide's real `createIcons()` (lib/icons/index.ts#initIcons, UNMOCKED
 *   here — every other tasks/lists test file mocks it) replaces every
 *   `<i data-lucide="name">` element whose PascalCase name resolves in the
 *   `icons` map it is given, and leaves an UNRESOLVED one untouched —
 *   `console.warn`s and returns (see node_modules/lucide/dist/esm/
 *   replaceElement.js) — the element keeps its `data-lucide` attribute and
 *   never becomes an <svg>. That is precisely "renders as NOTHING, silently".
 *
 *   So the gate is mechanical, not a re-typed list: mount the REAL tasks
 *   surface (real index.html + real Stimulus controllers, real render.ts /
 *   lib/lists/render.ts — the actual source, never a hand-copied fixture),
 *   drive it through enough real states to render a broad set of icons, run
 *   the REAL initIcons(), and assert NO `[data-lucide]` element survives
 *   (every one of them got replaced by an <svg>, i.e. resolved) — with an
 *   anti-vacuity guard (a gate that can never FIRE is as worthless as one
 *   that can never pass, R4's own words) proving icons were actually found
 *   and replaced, not merely that zero elements existed to scan.
 *
 * Verified in both directions (documented, not asserted in-file — the
 * verify_method is a source-tree scan against the registry, this is the
 * runtime half): clean on the current (fully-registered) tree; reverting
 * `lib/icons/index.ts` to omit a name this fixture renders (e.g. removing
 * `RotateCcw`) reddens this test (leftover `[data-lucide="rotate-ccw"]`
 * element + a console.warn) — see the story report for the transcript.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Application, defaultSchema } from '@hotwired/stimulus';
import type { ListDto, TaskDto } from '../types/dto';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));
// Deliberately NOT mocking '../lib/icons' — this file's whole point is to
// drive the REAL Lucide createIcons() against the REAL rendered DOM.

import TasksController from '../controllers/tasks_controller';
import ListsController from '../controllers/lists_controller';
import * as InvokeModule from '../invoke';

const INDEX_HTML = readFileSync(resolve(process.cwd(), 'index.html'), 'utf-8');

function extractBodyInnerHTML(html: string): string {
  const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!match) throw new Error('Could not extract <body> from index.html');
  return match[1];
}

const BODY_CONTENT = extractBodyInnerHTML(INDEX_HTML);

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
    task_count: 0,
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

describe('AC-X-03 — every data-lucide icon rendered by the tasks surface is registered', () => {
  let app: Application;

  beforeEach(async () => {
    stubDialogPrototype();
    document.body.innerHTML = '';

    // A rich fixture: every TaskStatus, a couple of priorities, tags, a
    // reminder, and a parent/child pair — deliberately broad so the run
    // touches most of the dynamic data-lucide setAttribute call sites in
    // lib/tasks/render.ts, lib/tasks/item.ts and lib/lists/render.ts.
    const parent = makeTask({
      id: 'parent-1',
      title: 'Parent Task',
      status: 'doing',
      priority: 'high',
      tags: ['urgent'],
      reminders: [{ kind: 'relative', value: '-1h' }],
      due: '2026-07-01',
    });
    const child = makeTask({
      id: 'child-1',
      title: 'Child Task',
      status: 'todo',
      priority: 'medium',
      parent: 'parent-1',
    });
    const doneTask = makeTask({ id: 'done-1', title: 'Done Task', status: 'done', priority: 'low' });
    const cancelledTask = makeTask({
      id: 'cancelled-1',
      title: 'Cancelled Task',
      status: 'cancelled',
      priority: 'none',
    });

    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([
      makeList({
        sections: [
          { id: 'sec-1', list_id: 'inbox', name: 'Backlog', position: 'a', task_count: 2 },
        ],
      }),
      makeList({ id: 'work', name: 'Work', is_default: false, position: 'B' }),
    ]);
    vi.spyOn(InvokeModule, 'listTasks').mockResolvedValue([parent, child, doneTask, cancelledTask]);
    vi.spyOn(InvokeModule, 'listTags').mockResolvedValue([
      { slug: 'urgent', name: 'Urgent', color: 'danger', task_count: 1 },
    ]);
    vi.spyOn(InvokeModule, 'getTaskById').mockResolvedValue(parent);

    document.body.innerHTML = BODY_CONTENT;

    app = Application.start(document.documentElement, defaultSchema);
    app.register('tasks', TasksController);
    app.register('lists', ListsController);

    await new Promise<void>((res) => setTimeout(res, 250));
  });

  afterEach(() => {
    app?.stop();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('every_task_icon_is_registered', async () => {
    // Drive a few more real states so board (Reopen glyph), the section
    // collapse toggle, and the pane (reminders / promote / subtasks) all
    // render at least once in the same pass.

    // Select the parent task → opens the pane (reminders bell, bell-plus,
    // promote calendar-plus, due calendar, subtasks trash-2/chevron).
    const bodyBtn = document.querySelector<HTMLButtonElement>('.task-item__body');
    expect(bodyBtn, 'a task item body must render').not.toBeNull();
    bodyBtn!.click();
    await new Promise<void>((res) => setTimeout(res, 50));

    // Toggle to board view (Reopen rotate-ccw on the Done column's card;
    // layout-grid/list on the toggle button itself).
    const viewToggle = document.querySelector<HTMLButtonElement>(
      '[data-action="click->tasks#setView"][data-view="board"]',
    );
    expect(viewToggle, 'view toggle button must render').not.toBeNull();
    viewToggle!.click();
    await new Promise<void>((res) => setTimeout(res, 50));
    document.querySelector<HTMLButtonElement>('[data-view="list"]')!.click();
    await new Promise<void>((res) => setTimeout(res, 50));

    // Collapse a section header (chevron-down -> chevron-right).
    const sectionToggle = document.querySelector<HTMLButtonElement>(
      '.tasks-section-group__toggle',
    );
    if (sectionToggle) {
      sectionToggle.click();
    }

    // Run the REAL Lucide pass — the mechanism this whole test exists to
    // exercise. Never mocked in this file (see the top-of-file comment).
    const { initIcons } = await import('../lib/icons');
    initIcons();

    // ── Anti-vacuity guard ────────────────────────────────────────────────
    // A gate that can never FIRE is as worthless as one that can never pass
    // (R4). Prove icons were actually found and replaced by Lucide, not that
    // there was simply nothing to scan.
    const replaced = document.querySelectorAll('svg.lucide');
    expect(replaced.length).toBeGreaterThan(10);

    // ── The gate itself ───────────────────────────────────────────────────
    // A RESOLVED icon is replaced wholesale: the original `<i data-lucide>`
    // element is swapped for an `<svg>` (which, per replaceElement.js, keeps
    // the data-lucide attribute for CSS/debugging purposes — so checking for
    // the attribute alone is NOT the right test). An UNRESOLVED icon name
    // leaves the original `<i>` element completely untouched (still an `<i>`
    // tag, never becomes an `<svg>`) — that is the "renders as nothing"
    // failure this gate exists to catch.
    const unresolved = Array.from(document.querySelectorAll('i[data-lucide]'));
    const unresolvedNames = unresolved.map((el) => el.getAttribute('data-lucide'));
    expect(unresolvedNames, 'every rendered data-lucide name must be registered').toEqual([]);
  });
});

describe('event metadata icon registry', () => {
  it('hydrates every icon used by Google meeting metadata', async () => {
    document.body.innerHTML = [
      '<i data-lucide="user-round"></i>',
      '<i data-lucide="users-round"></i>',
      '<i data-lucide="video"></i>',
      '<i data-lucide="bell"></i>',
    ].join('');

    const { initIcons } = await import('../lib/icons');
    initIcons();

    expect(document.querySelectorAll('svg.lucide')).toHaveLength(4);
    expect(document.querySelectorAll('i[data-lucide]')).toHaveLength(0);
  });
});
