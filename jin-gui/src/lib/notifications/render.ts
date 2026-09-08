/** DOM rendering for Jin's durable Notification Center. */

import type {
  CalendarInvitationNotificationDto,
  NotificationAction,
  NotificationItemDto,
  NotificationSourceErrorDto,
  TaskReminderNotificationDto,
} from '../../types/dto';

export interface NotificationSourceErrorSummary {
  heading: string;
  detail: string;
}

export function notificationSourceErrorSummary(
  errors: NotificationSourceErrorDto[],
  total: number,
): NotificationSourceErrorSummary {
  const googleOnly = errors.length > 0
    && errors.every((error) => error.source_kind === 'calendar_invitation');
  const heading = googleOnly
    ? `${total} Google Calendar event${total === 1 ? '' : 's'} could not be checked.`
    : `${total} notification source${total === 1 ? '' : 's'} could not be refreshed.`;
  const recovery = googleOnly
    ? 'Sync Google Calendar to refresh invitations.'
    : 'Refresh notifications to try again.';
  return {
    heading,
    detail: `${recovery} Other notifications are still available.`,
  };
}

export interface NotificationRenderOptions {
  selectedId?: string | null;
  busyItemId?: string | null;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name: string): HTMLElement {
  const node = element('i');
  node.dataset.lucide = name;
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function actionButton(label: string, action: string, className = 'btn-secondary'): HTMLButtonElement {
  const button = element('button', `${className} tap-target`, label);
  button.type = 'button';
  button.dataset.notificationAction = action;
  return button;
}

function appendDefinition(list: HTMLDListElement, label: string, value: string | null): void {
  if (!value) return;
  list.append(element('dt', 'notifications-metadata__label', label));
  list.append(element('dd', 'notifications-metadata__value', value));
}

export function formatInstant(value: string, allDay = false): string {
  if (allDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    const calendarDate = new Date(Date.UTC(year, month - 1, day));
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeZone: 'UTC',
    }).format(calendarDate);
  }
  const instant = new Date(value);
  if (Number.isNaN(instant.valueOf())) return value;
  const options: Intl.DateTimeFormatOptions = allDay
    ? { dateStyle: 'medium' }
    : { dateStyle: 'medium', timeStyle: 'short' };
  return new Intl.DateTimeFormat(undefined, options).format(instant);
}

function requestedActionLabel(action: NotificationAction | null): string {
  switch (action) {
    case 'allow': return 'Allow';
    case 'maybe': return 'Maybe';
    case 'refuse': return 'Refuse';
    case 'complete_task': return 'Mark done';
    default: return 'Action';
  }
}

function providerResponseLabel(response: string | null): string | null {
  if (!response) return null;
  switch (response) {
    case 'needsAction': return 'Awaiting your response';
    case 'accepted': return 'Accepted';
    case 'tentative': return 'Maybe';
    case 'declined': return 'Declined';
    default: return response;
  }
}

/** Text-first state cues; every visual state remains understandable without color. */
export function notificationStateLabels(item: NotificationItemDto, selected = false): string[] {
  const labels: string[] = [];
  if (!item.read_at) labels.push('Unread');
  if (selected) labels.push('Selected');
  if (item.status === 'action_pending') {
    labels.push(`Pending sync: ${requestedActionLabel(item.requested_action)}`);
  }
  if (item.action_error) labels.push(`Failed: ${item.action_error.message}`);
  if (item.status === 'superseded') labels.push('Superseded by a newer response');
  if (item.status === 'obsolete') labels.push('No longer available');
  if (item.status === 'acted') labels.push('Completed');
  if (item.capabilities.disabled_reason) {
    labels.push(`Disabled: ${item.capabilities.disabled_reason}`);
  }
  return labels;
}

function itemTime(item: NotificationItemDto): string {
  return item.kind === 'calendar_invitation'
    ? formatInstant(item.start, item.all_day)
    : formatInstant(item.scheduled_at);
}

function itemKindLabel(item: NotificationItemDto): string {
  return item.kind === 'calendar_invitation' ? 'Calendar invitation' : 'Task reminder';
}

export function renderNotificationList(
  container: HTMLElement,
  items: NotificationItemDto[],
  options: NotificationRenderOptions = {},
): void {
  const list = element('ul', 'notifications-list');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Notifications');

  for (const item of items) {
    const selected = item.id === options.selectedId;
    const row = element('button', 'notifications-row');
    row.type = 'button';
    row.dataset.notificationSelect = item.id;
    row.dataset.notificationKind = item.kind;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(selected));
    if (selected) row.classList.add('notifications-row--selected');
    if (!item.read_at) row.classList.add('notifications-row--unread');

    const heading = element('span', 'notifications-row__heading');
    heading.append(element('span', 'notifications-row__kind', itemKindLabel(item)));
    heading.append(element('span', 'notifications-row__time', itemTime(item)));
    row.append(heading);
    row.append(element('span', 'notifications-row__title', item.title));

    const cues = element('span', 'notifications-state-cues');
    for (const label of notificationStateLabels(item, selected)) {
      cues.append(element('span', 'notifications-state-cue', label));
    }
    row.append(cues);

    const listItem = element('li', 'notifications-list__item');
    listItem.setAttribute('role', 'presentation');
    listItem.append(row);
    list.append(listItem);
  }

  container.replaceChildren(list);
}

function renderInvitationMetadata(item: CalendarInvitationNotificationDto): HTMLElement {
  const metadata = element('dl', 'notifications-metadata');
  const organizer = item.organizer_name && item.organizer_email
    ? `${item.organizer_name} (${item.organizer_email})`
    : item.organizer_name ?? item.organizer_email ?? 'Unknown organizer';
  appendDefinition(metadata, 'Organizer', organizer);
  appendDefinition(metadata, 'Account', `${item.account_alias} · ${item.calendar_name}`);
  appendDefinition(
    metadata,
    'When',
    `${formatInstant(item.start, item.all_day)} – ${formatInstant(item.end, item.all_day)}`,
  );
  appendDefinition(metadata, 'Location', item.location);
  appendDefinition(metadata, 'Current response', providerResponseLabel(item.provider_response_status));
  return metadata;
}

function renderInvitationActions(
  item: CalendarInvitationNotificationDto,
  busy: boolean,
): HTMLElement {
  const section = element('section', 'notifications-detail__section');
  const heading = element('h3', 'notifications-detail__section-title', 'Respond');
  section.append(heading);

  const group = element('div', 'notifications-rsvp-actions');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Invitation response');
  group.setAttribute('aria-busy', String(busy || item.status === 'action_pending'));

  const available = item.status === 'active' && item.capabilities.can_respond && !busy;
  for (const response of ['allow', 'maybe', 'refuse'] as const) {
    const label = response === 'allow' ? 'Allow' : response === 'maybe' ? 'Maybe' : 'Refuse';
    const button = actionButton(label, `respond-${response}`, response === 'allow' ? 'btn-primary' : 'btn-secondary');
    button.dataset.response = response;
    button.disabled = !available;
    if (item.capabilities.recurrence_scopes.length > 1) button.dataset.requiresScope = 'true';
    group.append(button);
  }
  section.append(group);

  if (item.status === 'action_pending') {
    section.append(element(
      'p',
      'notifications-pending-copy',
      `Pending sync: ${requestedActionLabel(item.requested_action)}. Google’s confirmed response remains ${providerResponseLabel(item.provider_response_status) ?? 'unknown'}.`,
    ));
  }
  if (item.capabilities.disabled_reason) {
    section.append(element('p', 'notifications-disabled-copy', `Response disabled: ${item.capabilities.disabled_reason}`));
  }
  if (item.status === 'active' && item.action_error?.retryable) {
    const retry = actionButton('Retry', 'retry-rsvp', 'btn-primary');
    retry.disabled = busy || !item.capabilities.can_respond;
    section.append(retry);
  }
  return section;
}

function appendCommonActions(container: HTMLElement, item: NotificationItemDto, busy: boolean): void {
  const group = element('div', 'notifications-common-actions');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Notification actions');

  const read = actionButton(item.read_at ? 'Mark unread' : 'Mark read', 'toggle-read');
  read.disabled = busy || !item.capabilities.can_mark_read;
  group.append(read);

  const defer = actionButton('Defer 1 hour', 'defer');
  defer.disabled = busy || item.status !== 'active' || !item.capabilities.can_defer;
  group.append(defer);

  const tomorrow = actionButton('Defer until tomorrow morning', 'defer-tomorrow');
  tomorrow.disabled = busy || item.status !== 'active' || !item.capabilities.can_defer;
  group.append(tomorrow);

  const custom = actionButton(
    'Defer until…',
    'defer-custom',
    'btn-secondary jin-control jin-control--secondary jin-control--icon-label',
  );
  custom.replaceChildren(
    icon('calendar-days'),
    element('span', 'jin-control__label', 'Defer until…'),
  );
  custom.disabled = busy || item.status !== 'active' || !item.capabilities.can_defer;
  group.append(custom);

  const dismiss = actionButton('Dismiss', 'dismiss');
  dismiss.disabled = busy || item.status !== 'active' || !item.capabilities.can_dismiss;
  group.append(dismiss);
  container.append(group);
}

function renderTaskBody(item: TaskReminderNotificationDto, busy: boolean): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const metadata = element('dl', 'notifications-metadata');
  appendDefinition(metadata, 'Scheduled', formatInstant(item.scheduled_at));
  appendDefinition(metadata, 'List', item.list_name);
  appendDefinition(metadata, 'Project', item.project_name);
  fragment.append(metadata);

  const actions = element('div', 'notifications-source-actions');
  const open = actionButton('Open task', 'open-task');
  open.disabled = !item.capabilities.can_open_source;
  actions.append(open);
  const complete = actionButton('Mark done', 'complete-task', 'btn-primary');
  complete.disabled = busy || item.status !== 'active' || !item.capabilities.can_complete_task;
  actions.append(complete);
  fragment.append(actions);
  return fragment;
}

export function renderNotificationDetail(
  container: HTMLElement,
  item: NotificationItemDto | null,
  options: NotificationRenderOptions = {},
): void {
  if (!item) {
    const empty = element('div', 'notifications-detail-empty');
    empty.setAttribute('role', 'status');
    empty.setAttribute('aria-live', 'polite');
    empty.append(icon('inbox'));
    empty.append(element('p', undefined, 'Choose a notification to review it.'));
    container.replaceChildren(empty);
    return;
  }

  const busy = options.busyItemId === item.id;
  const article = element('article', 'notifications-detail');
  article.dataset.notificationItemId = item.id;
  article.setAttribute('aria-busy', String(busy));

  const back = actionButton('Back to notifications', 'back', 'notifications-back');
  back.prepend(icon('arrow-left'));
  article.append(back);

  const kind = element('p', 'notifications-detail__kind', itemKindLabel(item));
  const title = element('h2', 'notifications-detail__title', item.title);
  title.tabIndex = -1;
  title.dataset.notificationDetailHeading = '';
  article.append(kind, title);

  const cues = element('div', 'notifications-state-cues');
  cues.setAttribute('aria-label', 'Notification status');
  for (const label of notificationStateLabels(item, true)) {
    cues.append(element('span', 'notifications-state-cue', label));
  }
  article.append(cues);

  if (item.kind === 'calendar_invitation') {
    article.append(renderInvitationMetadata(item));
    const source = actionButton('View event', 'open-event');
    source.disabled = !item.capabilities.can_open_source;
    const sourceActions = element('div', 'notifications-source-actions');
    sourceActions.append(source);
    article.append(sourceActions);
    article.append(renderInvitationActions(item, busy));
  } else {
    article.append(renderTaskBody(item, busy));
  }

  if (item.action_error) {
    const error = element('p', 'notifications-action-error', `Failed: ${item.action_error.message}`);
    error.setAttribute('role', 'status');
    article.append(error);
  }
  appendCommonActions(article, item, busy);
  container.replaceChildren(article);
}
