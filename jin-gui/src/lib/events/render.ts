/**
 * events/render.ts — DOM rendering functions for the Events browse + detail view.
 *
 * All rendering uses <template> cloning (list rows) or createElement (detail panels).
 * No raw innerHTML string injection — only template cloning + textContent/attribute assignment.
 *
 * The controller (EventsController) calls these as a thin adapter.
 * Tested by: src/__tests__/events_controller.test.ts
 */

import type {
  ConferenceEntryPointDto,
  EventAttendeeDto,
  EventDto,
  EventBacklinkDto,
  EventDetailDto,
  EventReminderSettingsDto,
} from '../../types/dto';
import {
  sourceBadgeLabel,
  sourceBadgeIcon,
  formatEventTime,
  formatEventDate,
} from './transform';
import type { BrowseNavigateCallback } from '../notes/render';
import { eventMessage, resolveEventLocale, type EventLocaleKey } from './locale';

// ── Interface types ───────────────────────────────────────────────────────────

/** References to the named target elements managed by EventsController. */
export interface EventsViewElements {
  listPanel: HTMLElement;
  list: HTMLElement;
  emptyState: HTMLElement;
  loadingState: HTMLElement;
  detailPanel: HTMLElement;
  detailLoadingState: HTMLElement;
  detailNotFoundState: HTMLElement;
  detailContent: HTMLElement;
}

export interface EventDetailRenderOptions {
  locale?: EventLocaleKey;
  onEdit?: (detail: EventDetailDto) => void;
  onRemove?: (detail: EventDetailDto) => void;
}

/** References to the <template> elements used for dynamic rows. */
export interface EventsTemplates {
  eventBrowseRow: HTMLTemplateElement;
  backlinkRow: HTMLTemplateElement;
}

// ── Lifecycle helpers ─────────────────────────────────────────────────────────

export function showEventsListLoading(el: EventsViewElements): void {
  el.loadingState.classList.remove('hidden');
  el.list.classList.add('hidden');
  el.emptyState.classList.add('hidden');
}

export function hideEventsListLoading(el: EventsViewElements): void {
  el.loadingState.classList.add('hidden');
  el.list.classList.remove('hidden');
}

export function showEventsListEmptyState(el: EventsViewElements): void {
  el.list.classList.add('hidden');
  el.emptyState.classList.remove('hidden');
}

// ── List rendering ────────────────────────────────────────────────────────────

/**
 * renderEventsList — populate the events list.
 *
 * - Clears existing rows.
 * - Clones the event-browse-row <template> for each event.
 * - Source badge carries text label (not color-only — WCAG 1.4.1).
 * - Fires onNavigate when a row is activated.
 */
export function renderEventsList(
  el: EventsViewElements,
  templates: EventsTemplates,
  events: EventDto[],
  onNavigate: BrowseNavigateCallback
): void {
  el.list.innerHTML = '';

  if (events.length === 0) {
    showEventsListEmptyState(el);
    return;
  }

  el.emptyState.classList.add('hidden');
  el.list.classList.remove('hidden');

  for (const event of events) {
    el.list.appendChild(buildEventBrowseRow(templates, event, onNavigate));
  }
}

// ── Detail rendering ──────────────────────────────────────────────────────────

/**
 * renderEventDetail — populate the event detail panel.
 *
 * Renders:
 *   - Title
 *   - Source/authority badge (text label — never color-only)
 *   - Temporal display (start/end in correct tz, all-day + floating handled)
 *   - Description + location (when present)
 *   - Recurring flag (when recurrence_unexpanded — label only, never edit affordance)
 *   - Derived-from originating task (when derived_from is non-null — reachable, fires navigate)
 *   - Prep notes from backlinks (notes with prep-for edge — reachable, fires navigate)
 */
export function renderEventDetail(
  el: EventsViewElements,
  templates: EventsTemplates,
  detailOrEvent: EventDetailDto | EventDto,
  onNavigate: BrowseNavigateCallback,
  onAttach?: (noteId: string, targetId: string) => void,
  onLink?: (sourceId: string, targetId: string) => void,
  options: EventDetailRenderOptions = {},
): void {
  el.detailContent.innerHTML = '';
  const locale = options.locale ?? resolveEventLocale();
  const detail: EventDetailDto = 'event' in detailOrEvent
    ? detailOrEvent
    : {
        event: detailOrEvent,
        capabilities: {
          display_kind: detailOrEvent.derived_from ? 'time-block' : 'event',
          can_edit: false,
          can_delete: false,
          read_only_reason: null,
          can_return_task_to_flexible: false,
          originating_task: null,
        },
        edit_token: '',
      };
  const event = detail.event;

  const article = document.createElement('article');
  article.className = 'event-detail';

  const header = document.createElement('header');
  header.className = 'event-detail__header';
  const headingGroup = document.createElement('div');
  headingGroup.className = 'event-detail__heading-group';

  const titleEl = document.createElement('h2');
  titleEl.className = 'browse-detail__title text-title2';
  titleEl.textContent = event.title;
  headingGroup.appendChild(titleEl);
  header.appendChild(headingGroup);

  const headerActions = document.createElement('div');
  headerActions.className = 'event-detail__header-actions';
  if (detail.capabilities.can_edit && options.onEdit) {
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn-secondary event-detail__edit';
    edit.textContent = eventMessage('edit', locale);
    edit.setAttribute('aria-label', `${eventMessage('edit', locale)} ${event.title}`);
    edit.addEventListener('click', () => options.onEdit?.(detail));
    headerActions.appendChild(edit);
  }
  if (detail.capabilities.can_delete && options.onRemove) {
    const overflow = document.createElement('details');
    overflow.className = 'event-detail__overflow';
    const summary = document.createElement('summary');
    summary.className = 'btn-icon tap-target';
    summary.setAttribute('aria-label', eventMessage('more', locale));
    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', 'ellipsis-vertical');
    icon.setAttribute('aria-hidden', 'true');
    summary.appendChild(icon);
    const destructive = document.createElement('button');
    destructive.type = 'button';
    destructive.className = 'event-detail__destructive';
    destructive.textContent = detail.capabilities.display_kind === 'time-block'
      ? eventMessage('remove', locale)
      : eventMessage('delete', locale);
    destructive.addEventListener('click', () => options.onRemove?.(detail));
    overflow.appendChild(summary);
    overflow.appendChild(destructive);
    headerActions.appendChild(overflow);
  }
  header.appendChild(headerActions);
  article.appendChild(header);

  const metaEl = document.createElement('div');
  metaEl.className = 'browse-detail__meta';

  const sourceBadgeEl = document.createElement('span');
  sourceBadgeEl.className = 'event-detail__source-badge jin-badge';
  sourceBadgeEl.setAttribute('role', 'img');
  const srcLabel = event.source.toLowerCase() === 'google'
    ? eventMessage('sourceGoogle', locale)
    : eventMessage('sourceJin', locale);
  sourceBadgeEl.setAttribute('aria-label', srcLabel);
  sourceBadgeEl.dataset.source = event.source.toLowerCase();

  const sourceIconEl = document.createElement('i');
  sourceIconEl.className = 'event-detail__source-icon';
  sourceIconEl.setAttribute('data-lucide', sourceBadgeIcon(event.source));
  sourceIconEl.setAttribute('aria-hidden', 'true');

  const sourceLabelEl = document.createElement('span');
  sourceLabelEl.className = 'event-detail__source-label';
  sourceLabelEl.textContent = srcLabel;

  sourceBadgeEl.appendChild(sourceIconEl);
  sourceBadgeEl.appendChild(sourceLabelEl);
  metaEl.appendChild(sourceBadgeEl);

  if (detail.capabilities.display_kind === 'time-block') {
    const kind = document.createElement('span');
    kind.className = 'event-detail__kind-badge jin-badge';
    kind.textContent = eventMessage('timeBlock', locale);
    metaEl.appendChild(kind);
  }

  // ── Recurring flag (label-only, no edit affordance per spec §1.5) ─────────
  if (event.recurrence_unexpanded) {
    const recurEl = document.createElement('span');
    recurEl.className = 'event-detail__recurring-badge jin-badge';
    recurEl.setAttribute('aria-label', eventMessage('readRecurring', locale));

    const recurIconEl = document.createElement('i');
    recurIconEl.setAttribute('data-lucide', 'repeat');
    recurIconEl.setAttribute('aria-hidden', 'true');
    recurIconEl.className = 'event-detail__recurring-icon';

    const recurLabelEl = document.createElement('span');
    recurLabelEl.textContent = eventMessage('recurring', locale);

    recurEl.appendChild(recurIconEl);
    recurEl.appendChild(recurLabelEl);
    metaEl.appendChild(recurEl);
  }

  article.appendChild(metaEl);

  if (detail.capabilities.read_only_reason) {
    const notice = document.createElement('p');
    notice.className = 'event-detail__read-only';
    notice.setAttribute('role', 'status');
    notice.textContent = eventMessage(
      detail.capabilities.read_only_reason === 'cancelled'
        ? 'readCancelled'
        : detail.capabilities.read_only_reason === 'recurring_milestone_1'
          ? 'readRecurring'
          : 'readExternal',
      locale,
    );
    article.appendChild(notice);
  }

  // ── Temporal display (tz-aware) ───────────────────────────────────────────
  const timeSection = document.createElement('div');
  timeSection.className = 'event-detail__time-section';

  const dateEl = document.createElement('p');
  dateEl.className = 'event-detail__date text-headline';
  dateEl.textContent = formatEventDate(event.start, event.is_all_day, event.start_tzid, locale);
  timeSection.appendChild(dateEl);

  const timeEl = document.createElement('p');
  timeEl.className = 'event-detail__time text-callout';
  const timeStr = formatEventTime(
    event.start,
    event.end,
    event.is_all_day,
    event.floating,
    event.start_tzid,
    locale,
  );
  timeEl.textContent = timeStr;
  timeEl.setAttribute('aria-label', timeStr);
  timeSection.appendChild(timeEl);

  if (event.start_tzid && !event.is_all_day && !event.floating) {
    const tzEl = document.createElement('p');
    tzEl.className = 'event-detail__tz text-footnote color-secondary';
    tzEl.textContent = event.start_tzid;
    timeSection.appendChild(tzEl);
  }

  article.appendChild(timeSection);

  if (event.location) {
    const locEl = document.createElement('p');
    locEl.className = 'event-detail__location text-callout';
    locEl.setAttribute('aria-label', `${eventMessage('location', locale)}: ${event.location}`);
    locEl.textContent = event.location;
    article.appendChild(locEl);
  }

  // ── Description ───────────────────────────────────────────────────────────
  if (event.description) {
    const descEl = document.createElement('p');
    descEl.className = 'event-detail__description text-body';
    descEl.textContent = event.description;
    article.appendChild(descEl);
  }

  const meetingMetadata = buildGoogleMeetingMetadata(event, locale);
  if (meetingMetadata) article.appendChild(meetingMetadata);

  if (detail.capabilities.originating_task) {
    article.appendChild(buildOriginatingTaskSection(
      detail.capabilities.originating_task.id,
      detail.capabilities.originating_task.title,
      onNavigate,
      locale,
    ));
  }

  // ── Prep notes from backlinks (reachable) ─────────────────────────────────
  const prepNotes = event.backlinks.filter(
    (bl) =>
      bl.edge_type === 'prep-for' &&
      (bl.source_kind === 'note' || bl.source_kind === 'Note')
  );
  if (prepNotes.length > 0) {
    const prepSection = buildPrepNotesSection(prepNotes, templates, onNavigate, locale, onAttach
      ? () => onAttach('', event.id)
      : undefined);
    article.appendChild(prepSection);
  } else if (onAttach) {
    article.appendChild(buildEmptyContextAction(
      eventMessage('prepNotes', locale),
      eventMessage('findPrep', locale),
      () => onAttach('', event.id),
    ));
  }

  // ── All backlinks (remaining, for full context) ────────────────────────────
  const otherBacklinks = event.backlinks.filter(
    (bl) => !(bl.edge_type === 'prep-for' && (bl.source_kind === 'note' || bl.source_kind === 'Note'))
  );
  if (otherBacklinks.length > 0) {
    const backlinksSection = buildEventBacklinksSection(otherBacklinks, templates, onNavigate, locale, onLink
      ? () => onLink(event.id, '')
      : undefined);
    article.appendChild(backlinksSection);
  } else if (onLink) {
    article.appendChild(buildEmptyContextAction(
      eventMessage('related', locale),
      eventMessage('findRelated', locale),
      () => onLink(event.id, ''),
    ));
  }

  if (event.source.toLowerCase() === 'google') {
    const privacy = document.createElement('aside');
    privacy.className = 'event-detail__privacy';
    const strong = document.createElement('strong');
    strong.textContent = eventMessage('privateTitle', locale);
    const copy = document.createElement('p');
    copy.textContent = eventMessage('privateCopy', locale);
    privacy.appendChild(strong);
    privacy.appendChild(copy);
    article.appendChild(privacy);
  }

  const more = document.createElement('details');
  more.className = 'event-detail__more';
  const moreLabel = document.createElement('summary');
  moreLabel.textContent = eventMessage('more', locale);
  const moreBody = document.createElement('p');
  moreBody.textContent = [event.status, event.start_tzid].filter(Boolean).join(' · ');
  more.appendChild(moreLabel);
  more.appendChild(moreBody);
  article.appendChild(more);

  const status = document.createElement('p');
  status.className = 'event-detail__operation-status hidden';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  article.appendChild(status);

  el.detailContent.appendChild(article);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function buildGoogleMeetingMetadata(event: EventDto, locale: EventLocaleKey): HTMLElement | null {
  const sections = [
    buildOrganizerSection(event, locale),
    buildAttendeesSection(event.attendees, event.attendees_omitted, locale),
    buildConferenceSection(event, locale),
    buildEventRemindersSection(event.reminders, locale),
  ].filter((section): section is HTMLElement => section !== null);
  if (sections.length === 0) return null;

  const group = document.createElement('div');
  group.className = 'event-detail__google-metadata';
  sections.forEach((section) => group.appendChild(section));
  return group;
}

function metadataSection(title: string, className: string, iconName: string): HTMLElement {
  const section = document.createElement('section');
  section.className = `event-detail__metadata-section ${className}`;
  section.setAttribute('aria-label', title);
  const heading = document.createElement('h3');
  heading.className = 'event-detail__metadata-heading text-subheadline';
  const icon = document.createElement('i');
  icon.setAttribute('data-lucide', iconName);
  icon.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.textContent = title;
  heading.append(icon, label);
  section.appendChild(heading);
  return section;
}

function identityLabel(
  identity: { displayName?: string; email?: string; self?: boolean },
  locale: EventLocaleKey,
): string | null {
  const displayName = identity.displayName?.trim();
  const email = identity.email?.trim();
  if (displayName && email && displayName !== email) return `${displayName} · ${email}`;
  if (displayName) return displayName;
  if (email) return email;
  if (identity.self) return eventMessage('you', locale);
  return null;
}

function buildOrganizerSection(event: EventDto, locale: EventLocaleKey): HTMLElement | null {
  if (!event.organizer) return null;
  const label = identityLabel(event.organizer, locale);
  if (!label) return null;
  const section = metadataSection(eventMessage('organizer', locale), 'event-detail__organizer', 'user-round');
  const identity = document.createElement('p');
  identity.className = 'event-detail__identity text-callout';
  identity.textContent = label;
  if (event.organizer.self && Boolean(event.organizer.displayName?.trim() || event.organizer.email?.trim())) {
    const self = document.createElement('span');
    self.className = 'event-detail__metadata-pill jin-badge';
    self.textContent = eventMessage('you', locale);
    identity.append(' ', self);
  }
  section.appendChild(identity);
  return section;
}

function attendeeResponseLabel(status: string | undefined, locale: EventLocaleKey): string {
  switch (status) {
    case 'accepted': return eventMessage('responseAccepted', locale);
    case 'tentative': return eventMessage('responseTentative', locale);
    case 'declined': return eventMessage('responseDeclined', locale);
    case 'needsAction': return eventMessage('responseNeedsAction', locale);
    default: return status?.trim() || eventMessage('responseNeedsAction', locale);
  }
}

function buildAttendeesSection(
  attendees: EventAttendeeDto[] | null | undefined,
  attendeesOmitted: boolean | null | undefined,
  locale: EventLocaleKey,
): HTMLElement | null {
  if (!attendees?.length && !attendeesOmitted) return null;
  const section = metadataSection(eventMessage('attendees', locale), 'event-detail__attendees', 'users-round');
  if (attendees?.length) {
    const list = document.createElement('ul');
    list.className = 'event-detail__attendee-list';
    list.setAttribute('role', 'list');
    attendees.forEach((attendee) => list.appendChild(buildAttendee(attendee, locale)));
    section.appendChild(list);
  }
  if (attendeesOmitted) {
    const limited = document.createElement('p');
    limited.className = 'event-detail__attendee-limited text-footnote';
    limited.textContent = eventMessage('attendeeListLimited', locale);
    section.appendChild(limited);
  }
  return section;
}

function buildAttendee(attendee: EventAttendeeDto, locale: EventLocaleKey): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'event-detail__attendee';
  const identity = document.createElement('span');
  identity.className = 'event-detail__attendee-identity';
  identity.textContent = identityLabel(attendee, locale) ?? eventMessage('guest', locale);
  const state = document.createElement('span');
  state.className = 'event-detail__response-state';
  state.dataset.response = attendee.responseStatus || 'needsAction';
  state.textContent = attendeeResponseLabel(attendee.responseStatus, locale);
  item.append(identity, state);
  if (attendee.optional) {
    const optional = document.createElement('span');
    optional.className = 'event-detail__metadata-pill jin-badge';
    optional.textContent = eventMessage('optional', locale);
    item.appendChild(optional);
  }
  return item;
}

function safeExternalHref(value: string | null | undefined, allowTelephone = false): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return url.href;
    if (allowTelephone && url.protocol === 'tel:' && /^\+?[0-9().,*#; -]+$/.test(url.pathname)) {
      return value;
    }
  } catch {
    return null;
  }
  return null;
}

function externalLink(label: string, href: string, className: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = className;
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = label;
  return link;
}

function entryPointLabel(entry: ConferenceEntryPointDto): string | null {
  return entry.label?.trim() || entry.uri?.trim() || entry.entryPointType?.trim() || null;
}

function entryPointCredentials(
  entry: ConferenceEntryPointDto,
  locale: EventLocaleKey,
): Array<{ label: string; value: string }> {
  const knownFields: Array<[string, string | undefined]> = [
    [eventMessage('conferencePin', locale), entry.pin],
    [eventMessage('conferenceAccessCode', locale), entry.accessCode],
    [eventMessage('conferenceMeetingCode', locale), entry.meetingCode],
    [eventMessage('conferencePasscode', locale), entry.passcode],
    [eventMessage('conferencePassword', locale), entry.password],
  ];
  return knownFields.flatMap(([label, value]) => {
    const normalized = value?.trim();
    return normalized ? [{ label, value: normalized }] : [];
  });
}

function buildConferenceSection(event: EventDto, locale: EventLocaleKey): HTMLElement | null {
  const data = event.conference_data;
  const entryPoints = data?.entryPoints ?? [];
  const joinHref = safeExternalHref(event.hangout_link)
    ?? safeExternalHref(entryPoints.find((entry) => entry.entryPointType === 'video')?.uri);
  const details = entryPoints
    .map((entry) => ({
      label: entryPointLabel(entry),
      href: safeExternalHref(entry.uri, true),
      credentials: entryPointCredentials(entry, locale),
    }))
    .filter(({ label, href, credentials }) => Boolean((label && href && href !== joinHref) || credentials.length));
  const hasDetails = Boolean(
    data?.conferenceSolution?.name || data?.conferenceId || data?.notes || details.length,
  );
  if (!joinHref && !hasDetails) return null;

  const section = metadataSection(eventMessage('conferencing', locale), 'event-detail__conference', 'video');
  if (joinHref) {
    const join = externalLink(eventMessage('joinMeeting', locale), joinHref, 'event-detail__join-link btn-primary');
    join.setAttribute('aria-label', eventMessage('joinMeeting', locale));
    section.appendChild(join);
  }
  if (data?.conferenceSolution?.name) {
    const solution = document.createElement('p');
    solution.className = 'event-detail__conference-solution text-callout';
    solution.textContent = data.conferenceSolution.name;
    section.appendChild(solution);
  }
  if (data?.conferenceId) {
    const conferenceId = document.createElement('p');
    conferenceId.className = 'event-detail__conference-id text-footnote';
    conferenceId.textContent = `${eventMessage('conferenceId', locale)}: ${data.conferenceId}`;
    section.appendChild(conferenceId);
  }
  if (details.length > 0) {
    const list = document.createElement('ul');
    list.className = 'event-detail__conference-links';
    list.setAttribute('role', 'list');
    details.forEach(({ label, href, credentials }) => {
      const item = document.createElement('li');
      item.className = 'event-detail__conference-entry';
      const displayLabel = label || eventMessage('conferenceEntryPoint', locale);
      if (label && href && href !== joinHref) {
        item.appendChild(externalLink(label, href, 'event-detail__conference-link'));
      } else if (credentials.length) {
        const title = document.createElement('span');
        title.className = 'event-detail__conference-entry-label';
        title.textContent = displayLabel;
        item.appendChild(title);
      }
      if (credentials.length) {
        const credentialList = document.createElement('dl');
        credentialList.className = 'event-detail__conference-credentials';
        credentialList.setAttribute('aria-label', `${displayLabel} ${eventMessage('conferenceCredentials', locale)}`);
        credentials.forEach((credential) => {
          const row = document.createElement('div');
          const term = document.createElement('dt');
          term.textContent = credential.label;
          const value = document.createElement('dd');
          value.textContent = credential.value;
          row.append(term, value);
          credentialList.appendChild(row);
        });
        item.appendChild(credentialList);
      }
      list.appendChild(item);
    });
    section.appendChild(list);
  }
  if (data?.notes) {
    const notes = document.createElement('p');
    notes.className = 'event-detail__conference-notes text-footnote';
    notes.textContent = data.notes;
    section.appendChild(notes);
  }
  return section;
}

function reminderMethodLabel(method: string, locale: EventLocaleKey): string {
  if (method === 'popup') return eventMessage('reminderPopup', locale);
  if (method === 'email') return eventMessage('reminderEmail', locale);
  return method;
}

function buildEventRemindersSection(reminders: EventReminderSettingsDto | null | undefined, locale: EventLocaleKey): HTMLElement | null {
  if (!reminders) return null;
  const section = metadataSection(eventMessage('reminders', locale), 'event-detail__event-reminders', 'bell');
  if (reminders.useDefault) {
    const defaults = document.createElement('p');
    defaults.className = 'event-detail__reminder-summary text-callout';
    defaults.textContent = eventMessage('calendarDefault', locale);
    section.appendChild(defaults);
    return section;
  }
  if (!reminders.overrides?.length) {
    const none = document.createElement('p');
    none.className = 'event-detail__reminder-summary text-callout';
    none.textContent = eventMessage('noReminders', locale);
    section.appendChild(none);
    return section;
  }
  const list = document.createElement('ul');
  list.className = 'event-detail__reminder-list';
  list.setAttribute('role', 'list');
  reminders.overrides.forEach((override) => {
    const item = document.createElement('li');
    const timing = override.minutes === 0
      ? eventMessage('atEventTime', locale)
      : `${override.minutes} ${eventMessage(override.minutes === 1 ? 'minute' : 'minutes', locale)} ${eventMessage('beforeEvent', locale)}`;
    item.textContent = `${reminderMethodLabel(override.method, locale)} · ${timing}`;
    list.appendChild(item);
  });
  section.appendChild(list);
  return section;
}

function buildEventBrowseRow(
  templates: EventsTemplates,
  event: EventDto,
  onNavigate: BrowseNavigateCallback
): HTMLElement {
  const frag = templates.eventBrowseRow.content.cloneNode(true) as DocumentFragment;
  const row = frag.firstElementChild as HTMLElement;

  const btnEl = row.querySelector('.browse-row__inner') as HTMLElement | null;
  const timeEl = row.querySelector('.event-browse-row__time');
  const titleEl = row.querySelector('.browse-row__title');
  const sourceBadgeEl = row.querySelector('.event-browse-row__source-badge') as HTMLElement | null;
  const sourceIconEl = row.querySelector('.event-browse-row__source-icon');
  const sourceLabelEl = row.querySelector('.event-browse-row__source-label');

  if (btnEl) {
    btnEl.dataset.eventId = event.id;
    btnEl.setAttribute('aria-label', event.title);
    btnEl.addEventListener('click', () => {
      onNavigate('events', event.id);
    });
  }

  if (timeEl) {
    const timeStr = formatEventTime(
      event.start,
      event.end,
      event.is_all_day,
      event.floating,
      event.start_tzid
    );
    timeEl.textContent = timeStr;
    timeEl.setAttribute('aria-label', `Time: ${timeStr}`);
  }

  if (titleEl) titleEl.textContent = event.title;

  // Source badge: text label (primary) + icon (supplementary) — NEVER color-only
  const srcLabel = sourceBadgeLabel(event.source);
  if (sourceBadgeEl) {
    sourceBadgeEl.setAttribute('aria-label', `Source: ${srcLabel}`);
    sourceBadgeEl.dataset.source = event.source.toLowerCase();
  }
  if (sourceIconEl) sourceIconEl.setAttribute('data-lucide', sourceBadgeIcon(event.source));
  if (sourceLabelEl) sourceLabelEl.textContent = srcLabel;

  return row;
}

/**
 * buildDerivedFromSection — renders the originating task as a reachable link.
 */
function buildOriginatingTaskSection(
  taskId: string,
  taskTitle: string,
  onNavigate: BrowseNavigateCallback,
  locale: EventLocaleKey,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'browse-detail__links-section event-detail__derived-from';
  section.setAttribute('aria-label', eventMessage('originTask', locale));

  const h3 = document.createElement('h3');
  h3.className = 'browse-detail__links-heading text-subheadline';
  h3.textContent = eventMessage('originTask', locale);
  section.appendChild(h3);

  const ul = document.createElement('ul');
  ul.className = 'browse-detail__links-list';
  ul.setAttribute('role', 'list');

  const li = document.createElement('li');
  li.className = 'browse-link-row';

  const btn = document.createElement('button');
  btn.className = 'browse-link-row__btn tap-target';
  btn.dataset.linkId = taskId;
  btn.dataset.linkKind = 'task';
  btn.setAttribute('aria-label', `${eventMessage('open', locale)} ${taskTitle}`);

  const iconEl = document.createElement('i');
  iconEl.setAttribute('data-lucide', 'check-square');
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.className = 'browse-link-row__icon';

  const labelEl = document.createElement('span');
  labelEl.className = 'browse-link-row__label text-callout';
  labelEl.textContent = taskTitle;

  btn.appendChild(iconEl);
  btn.appendChild(labelEl);

  btn.addEventListener('click', () => {
    onNavigate('tasks', taskId);
  });

  li.appendChild(btn);
  ul.appendChild(li);
  section.appendChild(ul);

  return section;
}

/**
 * buildPrepNotesSection — renders prep notes from backlinks as reachable links.
 */
function buildPrepNotesSection(
  prepNotes: EventBacklinkDto[],
  templates: EventsTemplates,
  onNavigate: BrowseNavigateCallback,
  locale: EventLocaleKey,
  onSearch?: () => void,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'browse-detail__links-section event-detail__prep-notes';
  section.setAttribute('aria-label', eventMessage('prepNotes', locale));

  const h3 = document.createElement('h3');
  h3.className = 'browse-detail__links-heading text-subheadline';
  h3.textContent = eventMessage('prepNotes', locale);
  section.appendChild(h3);
  if (onSearch) section.appendChild(buildSearchButton(eventMessage('findPrep', locale), onSearch));

  const ul = document.createElement('ul');
  ul.className = 'browse-detail__links-list';
  ul.setAttribute('role', 'list');

  for (const note of prepNotes) {
    ul.appendChild(buildEventBacklinkItem(note, templates, onNavigate));
  }

  section.appendChild(ul);
  return section;
}

/**
 * buildEventBacklinksSection — renders remaining backlinks as reachable links.
 */
function buildEventBacklinksSection(
  backlinks: EventBacklinkDto[],
  templates: EventsTemplates,
  onNavigate: BrowseNavigateCallback,
  locale: EventLocaleKey,
  onSearch?: () => void,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'browse-detail__links-section';
  section.setAttribute('aria-label', eventMessage('related', locale));

  const h3 = document.createElement('h3');
  h3.className = 'browse-detail__links-heading text-subheadline';
  h3.textContent = eventMessage('related', locale);
  section.appendChild(h3);
  if (onSearch) section.appendChild(buildSearchButton(eventMessage('findRelated', locale), onSearch));

  const ul = document.createElement('ul');
  ul.className = 'browse-detail__links-list';
  ul.setAttribute('role', 'list');

  for (const bl of backlinks) {
    ul.appendChild(buildEventBacklinkItem(bl, templates, onNavigate));
  }

  section.appendChild(ul);
  return section;
}

function buildEventBacklinkItem(
  backlink: EventBacklinkDto,
  templates: EventsTemplates,
  onNavigate: BrowseNavigateCallback
): HTMLElement {
  const frag = templates.backlinkRow.content.cloneNode(true) as DocumentFragment;
  const row = frag.firstElementChild as HTMLElement;

  const btnEl = row.querySelector('.browse-link-row__btn') as HTMLElement | null;
  const labelEl = row.querySelector('.browse-link-row__label');
  const idEl = row.querySelector('.browse-link-row__id');

  const displayLabel = backlink.label || 'Untitled';

  if (btnEl) {
    btnEl.dataset.linkId = backlink.source_id;
    btnEl.dataset.linkKind = backlink.source_kind;
    btnEl.setAttribute('aria-label', `${backlink.source_kind}: ${displayLabel}`);
    btnEl.addEventListener('click', () => {
      const kind = resolveEventKind(backlink.source_kind);
      onNavigate(kind, backlink.source_id);
    });
  }

  if (labelEl) labelEl.textContent = displayLabel;
  idEl?.remove();

  return row;
}

function buildSearchButton(label: string, onSearch: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'event-detail__context-search btn-secondary';
  button.textContent = label;
  button.addEventListener('click', onSearch);
  return button;
}

function buildEmptyContextAction(heading: string, label: string, onSearch: () => void): HTMLElement {
  const section = document.createElement('section');
  section.className = 'browse-detail__links-section event-detail__context-empty';
  section.setAttribute('aria-label', heading);
  const title = document.createElement('h3');
  title.className = 'browse-detail__links-heading text-subheadline';
  title.textContent = heading;
  section.appendChild(title);
  section.appendChild(buildSearchButton(label, onSearch));
  return section;
}

function resolveEventKind(sourceKind: string): 'notes' | 'tasks' | 'events' {
  switch (sourceKind.toLowerCase()) {
    case 'note':
      return 'notes';
    case 'task':
      return 'tasks';
    default:
      return 'events';
  }
}
