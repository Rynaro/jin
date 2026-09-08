/**
 * render.ts — DOM rendering functions for the Today/Agenda view.
 *
 * Extracted from the controller so they can be unit-tested directly in jsdom
 * without starting a Stimulus application. All rendering uses <template>
 * cloning (HTML-first Stimulus pattern). No raw innerHTML string injection —
 * only template cloning + textContent/attribute assignment.
 *
 * The controller (TodayController) calls these functions as a thin adapter.
 *
 * Tested by: src/__tests__/today_controller.test.ts
 */

import type { AgendaEventDto, AgendaTaskDto, TodayFocusEventDto } from '../../types/dto';
import type { AgendaRowPresentation, GroupedAgenda } from './transform';
import { sourceBadgeLabel, sourceBadgeIcon, isRecurring } from './transform';

// ── Interface types ───────────────────────────────────────────────────────────

/** References to the named target elements managed by TodayController. */
export interface TodayViewElements {
  allDaySection: HTMLElement;
  allDayList: HTMLElement;
  timedSection: HTMLElement;
  timedList: HTMLElement;
  emptyState: HTMLElement;
  loadingState: HTMLElement;
  focusSection?: HTMLElement;
  focusList?: HTMLElement;
  attentionSection?: HTMLElement;
  attentionList?: HTMLElement;
  dueSection?: HTMLElement;
  dueList?: HTMLElement;
  flexibleSection?: HTMLElement;
  flexibleList?: HTMLElement;
  contextSection?: HTMLElement;
  contextList?: HTMLElement;
  scheduleClear?: HTMLElement;
}

/** References to the <template> elements used for dynamic rows. */
export interface TodayTemplates {
  eventRow: HTMLTemplateElement;
  prepNote: HTMLTemplateElement;
}

/**
 * NavigateCallback — fired when the user activates a task or note link.
 * section: 'tasks' | 'notes'
 * id: the Jin object id to navigate to
 */
export type NavigateCallback = (section: 'events' | 'tasks' | 'notes', id: string) => void;

// ── Lifecycle helpers ─────────────────────────────────────────────────────────

/**
 * showLoading — show the loading spinner, hide content and empty-state.
 * Called before the today_agenda invoke resolves.
 */
export function showLoading(el: TodayViewElements): void {
  el.loadingState.classList.remove('hidden');
  el.allDaySection.classList.add('hidden');
  el.timedSection.classList.add('hidden');
  el.focusSection?.classList.add('hidden');
  el.attentionSection?.classList.add('hidden');
  el.dueSection?.classList.add('hidden');
  el.flexibleSection?.classList.add('hidden');
  el.contextSection?.classList.add('hidden');
  el.scheduleClear?.classList.add('hidden');
  el.emptyState.classList.add('hidden');
}

/**
 * hideLoading — hide the loading spinner.
 * Called once today_agenda resolves (success or error).
 */
export function hideLoading(el: TodayViewElements): void {
  el.loadingState.classList.add('hidden');
}

/**
 * showEmptyState — show the "nothing scheduled" empty state.
 * Called when isEmpty is true.
 */
export function showEmptyState(el: TodayViewElements): void {
  el.allDaySection.classList.add('hidden');
  el.timedSection.classList.add('hidden');
  el.focusSection?.classList.add('hidden');
  el.attentionSection?.classList.add('hidden');
  el.dueSection?.classList.add('hidden');
  el.flexibleSection?.classList.add('hidden');
  el.contextSection?.classList.add('hidden');
  el.scheduleClear?.classList.add('hidden');
  el.emptyState.classList.remove('hidden');
}

// ── Main render ───────────────────────────────────────────────────────────────

/**
 * renderTodayView — populate the Today view with a GroupedAgenda.
 *
 * - Clears existing event rows in both buckets.
 * - Clones the event-row <template> for each event.
 * - Renders all-day bucket, then timed schedule.
 * - Handles originating_task, prep_notes, source badge, and recurring flag.
 * - Shows the empty state when both buckets are empty.
 * - Fires onNavigate when task or note links are activated.
 */
export function renderTodayView(
  el: TodayViewElements,
  templates: TodayTemplates,
  grouped: GroupedAgenda,
  onNavigate: NavigateCallback
): void {
  // Clear stale rows
  el.allDayList.replaceChildren();
  el.timedList.replaceChildren();
  el.focusList?.replaceChildren();
  el.attentionList?.replaceChildren();
  el.dueList?.replaceChildren();
  el.flexibleList?.replaceChildren();
  el.contextList?.replaceChildren();

  if (grouped.isEmpty) {
    showEmptyState(el);
    return;
  }

  // ── All-day bucket ──────────────────────────────────────────────────────────
  if (grouped.allDay.length > 0) {
    for (const event of grouped.allDay) {
      el.allDayList.appendChild(buildEventRow(templates, event, onNavigate));
    }
    el.allDaySection.classList.remove('hidden');
  } else {
    el.allDaySection.classList.add('hidden');
  }

  // ── Timed schedule ──────────────────────────────────────────────────────────
  if (grouped.timed.length > 0) {
    for (const event of grouped.timed) {
      el.timedList.appendChild(
        buildEventRow(templates, event, onNavigate, grouped.presentationById?.get(event.id)),
      );
    }
    el.timedSection.classList.remove('hidden');
  } else {
    el.timedSection.classList.add('hidden');
  }

  renderFocus(el, grouped, onNavigate);
  if (el.attentionSection && el.attentionList) renderTaskLane(el.attentionSection, el.attentionList, grouped.attentionTasks ?? [], onNavigate);
  if (el.dueSection && el.dueList) renderTaskLane(el.dueSection, el.dueList, grouped.dueTasks ?? [], onNavigate);
  if (el.flexibleSection && el.flexibleList) renderTaskLane(el.flexibleSection, el.flexibleList, grouped.flexibleTasks ?? [], onNavigate);
  renderConnectedWork(el, grouped, onNavigate);
  el.scheduleClear?.classList.toggle('hidden', grouped.timed.length > 0 || grouped.isEmpty);

  // Make sure empty-state is hidden when content rendered
  el.emptyState.classList.add('hidden');
}

function renderFocus(el: TodayViewElements, grouped: GroupedAgenda, onNavigate: NavigateCallback): void {
  if (!el.focusSection || !el.focusList) return;
  const byId = new Map(grouped.timed.map((event) => [event.id, event]));
  const focusItems: Array<{ focus: TodayFocusEventDto; phase: 'Now' | 'Up next' }> = [
    ...(grouped.activeFocus ?? []).map((focus) => ({ focus, phase: 'Now' as const })),
    ...(grouped.nextFocus ? [{ focus: grouped.nextFocus, phase: 'Up next' as const }] : []),
  ];
  for (const { focus, phase } of focusItems) {
    const event = byId.get(focus.event_id);
    if (!event) continue;
    const item = document.createElement('li');
    item.className = 'today-focus-item';
    const label = document.createElement('span');
    label.className = 'today-focus-item__phase';
    label.textContent = phase;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'today-focus-item__event';
    button.textContent = event.title;
    button.dataset.todayPreviewKind = 'events';
    button.dataset.todayPreviewId = event.id;
    button.setAttribute('aria-label', `${phase}: ${event.title}`);
    button.addEventListener('click', () => onNavigate('events', event.id));
    const minutes = document.createElement('span');
    minutes.className = 'today-focus-item__minutes';
    minutes.textContent = phase === 'Now' ? `${focus.minutes} min left` : `Starts in ${focus.minutes} min`;
    const range = document.createElement('span');
    range.className = 'today-focus-item__range';
    range.textContent = grouped.presentationById?.get(event.id)?.timeRange ?? event.display_start;
    range.setAttribute('aria-label', `Time: ${range.textContent}`);
    item.append(label, button, range, minutes);
    el.focusList.appendChild(item);
  }
  el.focusSection.classList.toggle('hidden', el.focusList.childElementCount === 0);
}

function renderTaskLane(section: HTMLElement, list: HTMLElement, tasks: AgendaTaskDto[], onNavigate: NavigateCallback): void {
  for (const task of tasks) {
    const item = document.createElement('li');
    item.className = 'today-task-row';
    const status = document.createElement('span');
    status.className = 'today-task-row__status';
    status.textContent = task.status === 'doing' ? 'In progress' : 'Open';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'today-task-row__title';
    button.textContent = task.title;
    button.dataset.todayPreviewKind = 'tasks';
    button.dataset.todayPreviewId = task.id;
    button.setAttribute('aria-label', `Open task: ${task.title}`);
    button.addEventListener('click', () => onNavigate('tasks', task.id));
    const meta = document.createElement('span');
    meta.className = 'today-task-row__meta';
    meta.textContent = task.due ? `Due ${task.due}` : task.list;
    item.append(status, button, meta);
    list.appendChild(item);
  }
  section.classList.toggle('hidden', tasks.length === 0);
}

function renderConnectedWork(el: TodayViewElements, grouped: GroupedAgenda, onNavigate: NavigateCallback): void {
  if (!el.contextSection || !el.contextList) return;
  const entities = new Map<string, { kind: 'tasks' | 'notes'; id: string; title: string; events: Array<{ id: string; title: string }> }>();
  for (const event of [...grouped.allDay, ...grouped.timed]) {
    if (event.originating_task) addContextEntity(entities, 'tasks', event.originating_task.id, event.originating_task.title, event.id, event.title);
    for (const note of event.prep_notes) addContextEntity(entities, 'notes', note.id, note.title, event.id, event.title);
  }
  for (const entity of entities.values()) {
    const item = document.createElement('li');
    item.className = 'today-context-item';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'today-context-item__link';
    button.textContent = entity.title;
    button.setAttribute('aria-label', `Open ${entity.kind === 'tasks' ? 'task' : 'note'}: ${entity.title}`);
    button.addEventListener('click', () => onNavigate(entity.kind, entity.id));
    const events = document.createElement('span');
    events.className = 'today-context-item__events';
    events.textContent = entity.events.map((event) => event.title).join(', ');
    item.append(button, events);
    el.contextList.appendChild(item);
  }
  el.contextSection.classList.toggle('hidden', entities.size === 0);
}

function addContextEntity(
  entities: Map<string, { kind: 'tasks' | 'notes'; id: string; title: string; events: Array<{ id: string; title: string }> }>,
  kind: 'tasks' | 'notes', id: string, title: string, eventId: string, eventTitle: string,
): void {
  const key = `${kind}:${id}`;
  const entity = entities.get(key) ?? { kind, id, title, events: [] };
  if (!entity.events.some((event) => event.id === eventId)) entity.events.push({ id: eventId, title: eventTitle });
  entities.set(key, entity);
}

// ── Internal ──────────────────────────────────────────────────────────────────

/**
 * buildEventRow — clone the event-row <template> and fill it with event data.
 *
 * Fills:
 *   - display_start (time label)
 *   - title
 *   - source badge: icon + text label (NOT color-only — WCAG 1.4.1)
 *   - recurring badge (when recurrence_unexpanded)
 *   - originating_task block (when non-null) — id + title, navigable
 *   - prep_notes list (when non-empty) — each note id + title, navigable
 *
 * Returns the populated <li> element ready to append.
 */
function buildEventRow(
  templates: TodayTemplates,
  event: AgendaEventDto,
  onNavigate: NavigateCallback,
  presentation?: AgendaRowPresentation,
): HTMLElement {
  const frag = templates.eventRow.content.cloneNode(true) as DocumentFragment;
  // Template has a single root <li class="today-event-row">
  const row = frag.firstElementChild as HTMLElement;

  row.dataset.eventId = event.id;
  row.setAttribute('aria-label', event.title);

  // ── Time range ────────────────────────────────────────────────────────────
  const timeEl = row.querySelector('.today-event-row__display-start');
  if (timeEl) {
    const timeRange = presentation?.timeRange ?? event.display_start;
    timeEl.textContent = timeRange;
    timeEl.setAttribute('aria-label', `Time: ${timeRange}`);
  }

  if (presentation?.overlaps) {
    row.classList.add('today-event-row--overlap');
    const overlapEl = row.querySelector('.today-event-row__overlap') as HTMLElement | null;
    if (overlapEl) {
      overlapEl.classList.remove('hidden');
      overlapEl.setAttribute('aria-label', 'Overlaps another scheduled event');
    }
  }

  // ── Title ─────────────────────────────────────────────────────────────────
  const titleEl = row.querySelector('.today-event-row__title') as HTMLButtonElement | null;
  if (titleEl) {
    titleEl.textContent = event.title;
    titleEl.dataset.todayPreviewKind = 'events';
    titleEl.dataset.todayPreviewId = event.id;
    titleEl.setAttribute('aria-label', `Open event: ${event.title}`);
    titleEl.addEventListener('click', () => onNavigate('events', event.id));
  }
  const typeEl = row.querySelector('.today-event-row__type');
  if (typeEl) typeEl.textContent = event.originating_task ? 'Task time block' : 'Event';

  // ── Source badge — text label + icon (NEVER color-only) ───────────────────
  const badgeEl = row.querySelector('.today-event-row__source-badge') as HTMLElement | null;
  const badgeLabelEl = row.querySelector('.today-event-row__source-label');
  const badgeIconEl = row.querySelector('.today-event-row__source-icon');
  if (badgeEl && badgeLabelEl && badgeIconEl) {
    const label = sourceBadgeLabel(event.source);
    badgeLabelEl.textContent = label;
    badgeIconEl.setAttribute('data-lucide', sourceBadgeIcon(event.source));
    badgeEl.setAttribute('aria-label', `Source: ${label}`);
    // data-source is a supplementary CSS hook for colour (NOT the primary identifier)
    badgeEl.dataset.source = event.source.toLowerCase();
  }

  // ── Recurring flag ────────────────────────────────────────────────────────
  if (isRecurring(event)) {
    const recurEl = row.querySelector('.today-event-row__recurring-badge') as HTMLElement | null;
    if (recurEl) {
      recurEl.classList.remove('hidden');
      // aria-label already set in the template; re-affirm for clarity
      recurEl.setAttribute('aria-label', 'Recurring event (not expanded)');
    }
  }

  // ── Originating task ──────────────────────────────────────────────────────
  if (event.originating_task != null) {
    const task = event.originating_task;
    const taskContainerEl = row.querySelector('.today-event-row__task') as HTMLElement | null;
    const taskLinkEl = row.querySelector('.today-event-row__task-link') as HTMLAnchorElement | null;
    const taskTitleEl = row.querySelector('.today-event-row__task-title');
    const taskIdEl = row.querySelector('.today-event-row__task-id');

    if (taskContainerEl && taskLinkEl && taskTitleEl && taskIdEl) {
      taskContainerEl.classList.remove('hidden');
      taskLinkEl.dataset.taskId = task.id;
      taskLinkEl.dataset.todayPreviewKind = 'tasks';
      taskLinkEl.dataset.todayPreviewId = task.id;
      taskLinkEl.setAttribute('aria-label', `Task: ${task.title}`);
      taskTitleEl.textContent = task.title;
      taskIdEl.textContent = task.id;

      taskLinkEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onNavigate('tasks', task.id);
      });
    }
  }

  // ── Prep notes ────────────────────────────────────────────────────────────
  if (event.prep_notes.length > 0) {
    const notesContainerEl = row.querySelector('.today-event-row__notes') as HTMLElement | null;
    const notesListEl = row.querySelector('.today-event-row__notes-list');

    if (notesContainerEl && notesListEl) {
      notesContainerEl.classList.remove('hidden');

      for (const note of event.prep_notes) {
        const noteFrag = templates.prepNote.content.cloneNode(true) as DocumentFragment;
        // Template has single root <li class="today-prep-note">
        const noteItem = noteFrag.firstElementChild as HTMLElement;
        const noteLinkEl = noteItem.querySelector('.today-prep-note__link') as HTMLAnchorElement | null;
        const noteTitleEl = noteItem.querySelector('.today-prep-note__title');
        const noteIdEl = noteItem.querySelector('.today-prep-note__id');

        if (noteLinkEl && noteTitleEl && noteIdEl) {
          noteLinkEl.dataset.noteId = note.id;
          noteLinkEl.setAttribute('aria-label', `Note: ${note.title}`);
          noteTitleEl.textContent = note.title;
          noteIdEl.textContent = note.id;

          noteLinkEl.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            onNavigate('notes', note.id);
          });
        }

        notesListEl.appendChild(noteItem);
      }
    }
  }

  return row;
}
