/**
 * Shared Event Preview presenter — pure DOM from EventDetailDto + callbacks.
 * Never fetches or mutates; callers own data and actions.
 */

import type { EventDetailDto, EventDto } from '../../types/dto';
import {
  applyCalendarColor,
  calendarMembershipIdentity,
  calendarProvenanceLabel,
} from '../calendar/colors';
import {
  eventMessage,
  resolveEventLocale,
  type EventLocaleKey,
} from './locale';
import { formatEventDate, formatEventTime } from './transform';
import type { EventOperationState } from './operation_state';
import { eventRemovalLabels } from './removal';
import { syncContextStatusCopy } from './status_copy';

export interface EventPreviewCallbacks {
  onEdit?: () => void;
  /** The host owns confirmation and mutation. Preview only exposes the action. */
  onRemove?: (invoker: HTMLButtonElement) => void;
  onOpenFullDetails?: (eventId: string) => void;
  onJoin?: (href: string) => void;
  onCreatePrepNote?: () => void;
  onNavigate?: (kind: 'notes' | 'tasks' | 'events', id: string) => void;
}

export interface EventPreviewContext {
  locale?: EventLocaleKey;
  operationState?: EventOperationState;
  calendarName?: string;
  accountAlias?: string;
  statusMessage?: string | null;
  /** Stable projection reason when temporal move/resize is unavailable (AC-055). */
  temporalDisabledReason?: string | null;
}

function safeHttpsHref(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return url.href;
  } catch {
    return null;
  }
  return null;
}

function joinHrefFor(event: EventDto): string | null {
  const fromHangout = safeHttpsHref(event.hangout_link);
  if (fromHangout) return fromHangout;
  const entries = event.conference_data?.entryPoints ?? [];
  for (const entry of entries) {
    const href = safeHttpsHref(entry.uri);
    if (href) return href;
  }
  return null;
}

function meetIsPending(event: EventDto): boolean {
  const data = event.conference_data;
  if (!data) return false;
  if (data.pendingCreateRequest) return true;
  return data.createRequest?.status?.statusCode === 'pending';
}

function provenanceCopy(event: EventDto, locale: EventLocaleKey): string {
  return calendarProvenanceLabel(event, {
    createdInJin: eventMessage('createdInJin', locale),
    sourceGoogle: eventMessage('sourceGoogle', locale),
    sourceJin: eventMessage('sourceJin', locale),
  });
}

function normalizedIdentity(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? '';
}

/** Render shared Preview DOM. */
export function renderEventPreview(
  detail: EventDetailDto,
  callbacks: EventPreviewCallbacks = {},
  context: EventPreviewContext = {},
): HTMLElement {
  const locale = context.locale ?? resolveEventLocale();
  const event = detail.event;
  const root = document.createElement('article');
  root.className = 'event-preview';
  root.dataset.companionFocus = 'preview-root';

  // 1. Calendar color / name / account alias; provenance secondary
  const membership = calendarMembershipIdentity(event, eventMessage('jinCalendarName', locale));
  const identity = document.createElement('div');
  identity.className = 'event-preview__identity';

  const swatch = document.createElement('span');
  swatch.className = 'event-preview__color';
  swatch.setAttribute('aria-hidden', 'true');
  applyCalendarColor(swatch, membership.color);
  identity.appendChild(swatch);

  const identityText = document.createElement('div');
  identityText.className = 'event-preview__identity-text';

  const calendarName = context.calendarName ?? membership.label;
  const identityPrimary = document.createElement('p');
  identityPrimary.className = 'event-preview__identity-primary';
  const nameEl = document.createElement('span');
  nameEl.className = 'event-preview__calendar-name';
  nameEl.textContent = calendarName;
  identityPrimary.appendChild(nameEl);

  const alias = context.accountAlias ?? membership.accountAlias;
  if (alias && alias !== calendarName) {
    const aliasEl = document.createElement('span');
    aliasEl.className = 'event-preview__account-alias text-footnote';
    aliasEl.textContent = alias;
    identityPrimary.append(' · ', aliasEl);
  }
  identityText.appendChild(identityPrimary);

  const provenance = document.createElement('p');
  provenance.className = 'event-preview__provenance text-footnote color-secondary';
  provenance.textContent = provenanceCopy(event, locale);
  identityText.appendChild(provenance);

  identity.appendChild(identityText);

  const header = document.createElement('header');
  header.className = 'event-preview__header';

  // Title and time lead the compact inspector; calendar identity follows once.
  const title = document.createElement('h2');
  title.className = 'event-preview__title';
  title.textContent = event.title || eventMessage('eventTitle', locale);
  title.dataset.companionFocus = 'preview-title';
  header.appendChild(title);

  const when = document.createElement('div');
  when.className = 'event-preview__when';
  const datePart = formatEventDate(event.start, event.is_all_day, event.start_tzid, locale);
  const timePart = formatEventTime(
    event.start,
    event.end,
    event.is_all_day,
    event.floating,
    event.start_tzid,
    locale,
  );
  const date = document.createElement('span');
  date.className = 'event-preview__date';
  date.textContent = datePart;
  const time = document.createElement('span');
  time.className = 'event-preview__time';
  time.textContent = timePart;
  when.append(date, time);
  if (!event.is_all_day && !event.floating && event.start_tzid) {
    const zone = document.createElement('span');
    zone.className = 'event-preview__zone';
    zone.textContent = event.start_tzid;
    when.append(zone);
  }
  header.append(when, identity);
  root.appendChild(header);

  if (context.temporalDisabledReason) {
    const reason = document.createElement('p');
    reason.className = 'event-preview__temporal-disabled text-footnote';
    reason.dataset.companionFocus = 'preview-temporal-disabled';
    const key =
      context.temporalDisabledReason === 'ambiguous_wall_time'
        ? 'temporalDisabledAmbiguous'
        : context.temporalDisabledReason === 'unresolvable_local_time'
          ? 'temporalDisabledUnresolvable'
          : context.temporalDisabledReason === 'invalid_timezone'
            ? 'temporalDisabledInvalidTz'
            : null;
    reason.textContent = key
      ? eventMessage(key, locale)
      : context.temporalDisabledReason;
    root.appendChild(reason);
  }

  // 3. Primary action: Join if real link, else Edit if can_edit; no fake disabled button
  const actions = document.createElement('div');
  actions.className = 'event-preview__actions';

  const pendingMeet = meetIsPending(event);
  const href = pendingMeet ? null : joinHrefFor(event);

  if (pendingMeet) {
    const pending = document.createElement('p');
    pending.className = 'event-preview__meet-pending text-footnote';
    pending.textContent = eventMessage('meetBeingCreated', locale);
    actions.appendChild(pending);
  } else if (href) {
    const join = document.createElement('a');
    join.className = 'btn-primary tap-target event-preview__join';
    join.href = href;
    join.target = '_blank';
    join.rel = 'noopener noreferrer';
    join.textContent = eventMessage('joinMeeting', locale);
    join.dataset.companionFocus = 'preview-join';
    join.addEventListener('click', () => callbacks.onJoin?.(href));
    actions.appendChild(join);
  } else if (detail.capabilities.can_edit && callbacks.onEdit) {
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn-primary tap-target event-preview__edit';
    edit.textContent = eventMessage('edit', locale);
    edit.dataset.companionFocus = 'preview-edit';
    edit.addEventListener('click', () => callbacks.onEdit?.());
    actions.appendChild(edit);
  }

  if (detail.capabilities.can_delete && callbacks.onRemove) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn-secondary tap-target event-preview__remove';
    remove.textContent = eventRemovalLabels(detail, locale).confirmLabel;
    remove.dataset.companionFocus = 'preview-remove';
    remove.addEventListener('click', () => callbacks.onRemove?.(remove));
    actions.appendChild(remove);
  }

  if (actions.childNodes.length) root.appendChild(actions);

  // 4. Location and description
  if (event.location) {
    const location = document.createElement('p');
    location.className = 'event-preview__location';
    location.textContent = event.location;
    root.appendChild(location);
  }
  if (event.description) {
    const description = document.createElement('p');
    description.className = 'event-preview__description';
    description.textContent = event.description;
    root.appendChild(description);
  }

  // 5. Guests
  const attendees = (event.attendees ?? []).filter(attendee =>
    attendee.self !== true && attendee.resource !== true && attendee.organizer !== true,
  );
  const organizerName = event.organizer?.displayName ?? event.organizer?.email;
  const organizerMatchesCalendar = normalizedIdentity(organizerName) === normalizedIdentity(calendarName);
  const meaningfulOrganizer = Boolean(organizerName && !organizerMatchesCalendar);
  if (attendees.length > 0 || meaningfulOrganizer) {
    const guests = document.createElement('section');
    guests.className = 'event-preview__guests';
    const heading = document.createElement('h3');
    heading.className = 'event-preview__section-title';
    heading.textContent = eventMessage('attendees', locale);
    guests.appendChild(heading);
    if (meaningfulOrganizer) {
      const org = document.createElement('p');
      org.className = 'text-footnote';
      org.textContent = `${eventMessage('organizer', locale)}: ${
        organizerName ?? ''
      }`;
      guests.appendChild(org);
    }
    if (attendees.length > 0) {
      const list = document.createElement('ul');
      list.className = 'event-preview__guest-list';
      for (const guest of attendees) {
        const item = document.createElement('li');
        item.textContent = guest.displayName ?? guest.email ?? eventMessage('guest', locale);
        list.appendChild(item);
      }
      guests.appendChild(list);
    }
    root.appendChild(guests);
  }

  // 6. Meet state (when not already shown as pending primary)
  if (!pendingMeet && event.conference_data && !href) {
    const meet = document.createElement('p');
    meet.className = 'event-preview__meet text-footnote';
    meet.textContent = event.conference_data.conferenceSolution?.name
      ?? eventMessage('conferencing', locale);
    root.appendChild(meet);
  }

  // 7. Linked task / backlinks
  const task = detail.capabilities.originating_task;
  if (task) {
    const taskEl = document.createElement('p');
    taskEl.className = 'event-preview__task text-footnote';
    const openTask = document.createElement('button');
    openTask.type = 'button';
    openTask.className = 'btn-secondary';
    openTask.textContent = `${eventMessage('originTask', locale)}: ${task.title}`;
    openTask.addEventListener('click', () => callbacks.onNavigate?.('tasks', task.id));
    if (callbacks.onNavigate) taskEl.append(openTask);
    else taskEl.textContent = `${eventMessage('originTask', locale)}: ${task.title}`;
    root.appendChild(taskEl);
  }
  if (event.backlinks?.length) {
    const links = document.createElement('ul');
    links.className = 'event-preview__backlinks';
    for (const link of event.backlinks) {
      const item = document.createElement('li');
      const kind = link.source_kind.toLowerCase();
      const route = kind === 'note' ? 'notes' : kind === 'task' ? 'tasks' : kind === 'event' ? 'events' : null;
      if (route && callbacks.onNavigate) {
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'btn-secondary';
        open.textContent = link.label || link.source_id;
        open.addEventListener('click', () => callbacks.onNavigate?.(route, link.source_id));
        item.append(open);
      } else item.textContent = link.label || link.source_id;
      links.appendChild(item);
    }
    root.appendChild(links);
  }

  let secondaryActions: HTMLElement | null = null;
  const appendSecondaryAction = (action: HTMLButtonElement): void => {
    if (!secondaryActions) {
      secondaryActions = document.createElement('div');
      secondaryActions.className = 'event-preview__secondary-actions';
    }
    secondaryActions.appendChild(action);
  };

  if (callbacks.onCreatePrepNote) {
    const create = document.createElement('button');
    create.type = 'button';
    create.className = 'btn-secondary event-preview__new-prep';
    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', 'file-text');
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = eventMessage('newPrepNote', locale);
    create.append(icon, label);
    create.addEventListener('click', callbacks.onCreatePrepNote);
    appendSecondaryAction(create);
  }

  // 8. Concise sync status
  const syncCopy = syncContextStatusCopy(event, locale, context.operationState, context.statusMessage);
  if (syncCopy) {
    const sync = document.createElement('p');
    sync.className = 'event-preview__sync text-footnote';
    // A confirmed provider sync is reassuring context, not an action or warning.
    // Keep other operation and caller-provided statuses at their normal contrast.
    if (!context.operationState && !context.statusMessage && event.sync_context?.state === 'synced') {
      sync.classList.add('event-preview__sync--routine');
    }
    sync.textContent = syncCopy;
    root.appendChild(sync);
  }

  // 9. Open full details
  if (callbacks.onOpenFullDetails) {
    const openFull = document.createElement('button');
    openFull.type = 'button';
    openFull.className = 'btn-secondary tap-target event-preview__open-full';
    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', 'chevron-right');
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = eventMessage('openFullDetails', locale);
    openFull.append(icon, label);
    openFull.dataset.companionFocus = 'preview-open-full';
    openFull.addEventListener('click', () => {
      callbacks.onOpenFullDetails?.(event.id);
    });
    appendSecondaryAction(openFull);
  }

  if (secondaryActions) root.appendChild(secondaryActions);

  return root;
}
