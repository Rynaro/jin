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

import type { AgendaEventDto } from '../../types/dto';
import type { GroupedAgenda } from './transform';
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
export type NavigateCallback = (section: 'tasks' | 'notes', id: string) => void;

// ── Lifecycle helpers ─────────────────────────────────────────────────────────

/**
 * showLoading — show the loading spinner, hide content and empty-state.
 * Called before the today_agenda invoke resolves.
 */
export function showLoading(el: TodayViewElements): void {
  el.loadingState.classList.remove('hidden');
  el.allDaySection.classList.add('hidden');
  el.timedSection.classList.add('hidden');
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
  el.allDayList.innerHTML = '';
  el.timedList.innerHTML = '';

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
      el.timedList.appendChild(buildEventRow(templates, event, onNavigate));
    }
    el.timedSection.classList.remove('hidden');
  } else {
    el.timedSection.classList.add('hidden');
  }

  // Make sure empty-state is hidden when content rendered
  el.emptyState.classList.add('hidden');
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
  onNavigate: NavigateCallback
): HTMLElement {
  const frag = templates.eventRow.content.cloneNode(true) as DocumentFragment;
  // Template has a single root <li class="today-event-row">
  const row = frag.firstElementChild as HTMLElement;

  row.dataset.eventId = event.id;
  row.setAttribute('aria-label', event.title);

  // ── Time / display_start ──────────────────────────────────────────────────
  const timeEl = row.querySelector('.today-event-row__display-start');
  if (timeEl) {
    timeEl.textContent = event.display_start;
    timeEl.setAttribute('aria-label', `Time: ${event.display_start}`);
  }

  // ── Title ─────────────────────────────────────────────────────────────────
  const titleEl = row.querySelector('.today-event-row__title');
  if (titleEl) titleEl.textContent = event.title;

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
      taskLinkEl.setAttribute('aria-label', `Task: ${task.title}`);
      taskTitleEl.textContent = task.title;
      taskIdEl.textContent = task.id;

      taskLinkEl.addEventListener('click', (e) => {
        e.preventDefault();
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
            onNavigate('notes', note.id);
          });
        }

        notesListEl.appendChild(noteItem);
      }
    }
  }

  return row;
}
