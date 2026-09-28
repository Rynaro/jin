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
import { syncContextStatusCopy } from './status_copy';

export interface EventPreviewCallbacks {
  onEdit?: () => void;
  onOpenFullDetails?: (eventId: string) => void;
  onJoin?: (href: string) => void;
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
  const nameEl = document.createElement('p');
  nameEl.className = 'event-preview__calendar-name';
  nameEl.textContent = calendarName;
  identityText.appendChild(nameEl);

  const alias = context.accountAlias ?? membership.accountAlias;
  if (alias && alias !== calendarName) {
    const aliasEl = document.createElement('p');
    aliasEl.className = 'event-preview__account-alias text-footnote';
    aliasEl.textContent = alias;
    identityText.appendChild(aliasEl);
  }

  const provenance = document.createElement('p');
  provenance.className = 'event-preview__provenance text-footnote color-secondary';
  provenance.textContent = provenanceCopy(event, locale);
  identityText.appendChild(provenance);

  identity.appendChild(identityText);

  // Title and time lead the compact inspector; calendar identity follows once.
  const title = document.createElement('h2');
  title.className = 'event-preview__title';
  title.textContent = event.title || eventMessage('eventTitle', locale);
  title.dataset.companionFocus = 'preview-title';
  root.appendChild(title);

  const when = document.createElement('p');
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
  const zone =
    !event.is_all_day && !event.floating && event.start_tzid ? ` · ${event.start_tzid}` : '';
  when.textContent = `${datePart} · ${timePart}${zone}`;
  root.appendChild(when);
  root.appendChild(identity);

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
  const attendees = event.attendees ?? [];
  if (attendees.length > 0 || event.organizer) {
    const guests = document.createElement('section');
    guests.className = 'event-preview__guests';
    const heading = document.createElement('h3');
    heading.className = 'event-preview__section-title';
    heading.textContent = eventMessage('attendees', locale);
    guests.appendChild(heading);
    if (event.organizer?.email || event.organizer?.displayName) {
      const org = document.createElement('p');
      org.className = 'text-footnote';
      org.textContent = `${eventMessage('organizer', locale)}: ${
        event.organizer.displayName ?? event.organizer.email ?? ''
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
    taskEl.textContent = `${eventMessage('originTask', locale)}: ${task.title}`;
    root.appendChild(taskEl);
  }
  if (event.backlinks?.length) {
    const links = document.createElement('ul');
    links.className = 'event-preview__backlinks';
    for (const link of event.backlinks) {
      const item = document.createElement('li');
      item.textContent = link.label || link.source_id;
      links.appendChild(item);
    }
    root.appendChild(links);
  }

  // 8. Concise sync status
  const syncCopy = syncContextStatusCopy(event, locale, context.operationState, context.statusMessage);
  if (syncCopy) {
    const sync = document.createElement('p');
    sync.className = 'event-preview__sync text-footnote';
    sync.textContent = syncCopy;
    root.appendChild(sync);
  }

  // 9. Open full details
  if (callbacks.onOpenFullDetails) {
    const openFull = document.createElement('button');
    openFull.type = 'button';
    openFull.className = 'btn-secondary tap-target event-preview__open-full';
    openFull.textContent = eventMessage('openFullDetails', locale);
    openFull.dataset.companionFocus = 'preview-open-full';
    openFull.addEventListener('click', () => {
      callbacks.onOpenFullDetails?.(event.id);
    });
    root.appendChild(openFull);
  }

  return root;
}
