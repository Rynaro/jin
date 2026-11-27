/**
 * Shared event cancellation and removal flow.
 *
 * The preview, the full detail view, and the Today surface all use this one
 * path so Google delivery, recurrence scope, and task time-block behavior
 * cannot drift between entry points.
 */

import {
  deleteEvent,
  deleteRoutedEvent,
  newOperationId,
  removeTimeBlock,
} from '../../invoke';
import type { EventDetailDto } from '../../types/dto';
import { eventMessage, eventMessageFormat, type EventLocaleKey } from './locale';
import { ConfirmDialog } from '../ui/confirm_dialog';
import { applyCalendarColor, calendarMembershipIdentity } from '../calendar/colors';
import { formatEventDate, formatEventTime } from './transform';

export type EventRemovalKind = 'cancel-meeting' | 'cancel-event' | 'remove' | 'delete';

export interface EventRemovalLabels {
  kind: EventRemovalKind;
  title: string;
  message: string;
  confirmLabel: string;
  dismissLabel: string;
}

export interface EventRemovalDialogOptions {
  detail: EventDetailDto;
  locale: EventLocaleKey;
  onStart?: () => void;
  onRemoved: () => void | Promise<void>;
  onFailure: (error: unknown) => void | Promise<void>;
  /** The provider accepted the removal, but refreshing the local view failed. */
  onRefreshFailure?: (error: unknown) => void | Promise<void>;
}

function previousCalendarDay(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00`);
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** Date summary which honours the exclusive end used by all-day calendar events. */
function removalDateSummary(detail: EventDetailDto, locale: EventLocaleKey): string {
  const event = detail.event;
  const start = formatEventDate(event.start, event.is_all_day, event.start_tzid, locale);
  const endValue = event.is_all_day ? previousCalendarDay(event.end) : event.end;
  const end = formatEventDate(endValue, event.is_all_day, event.end_tzid ?? event.start_tzid, locale);
  return start === end ? start : `${start} – ${end}`;
}

function removalContext(detail: EventDetailDto, locale: EventLocaleKey): HTMLElement {
  const event = detail.event;
  const identity = calendarMembershipIdentity(event, eventMessage('jinCalendarName', locale));
  const card = document.createElement('section');
  card.className = 'event-removal__context';
  card.setAttribute('aria-label', eventMessage('eventHeading', locale));

  const title = document.createElement('strong');
  title.className = 'event-removal__title';
  title.textContent = event.title || eventMessage('eventTitle', locale);
  const when = document.createElement('p');
  when.className = 'event-removal__when';
  const date = removalDateSummary(detail, locale);
  const time = formatEventTime(event.start, event.end, event.is_all_day, event.floating, event.start_tzid, locale);
  const dateTime = document.createElement('span');
  dateTime.textContent = `${date} · ${time}`;
  when.appendChild(dateTime);
  if (!event.is_all_day && !event.floating && event.start_tzid) {
    const zone = document.createElement('small');
    zone.textContent = `${eventMessage('timeZone', locale)}: ${event.start_tzid}`;
    when.appendChild(zone);
  }
  const calendar = document.createElement('p');
  calendar.className = 'event-removal__calendar';
  const swatch = document.createElement('span');
  swatch.setAttribute('aria-hidden', 'true');
  applyCalendarColor(swatch, identity.color);
  calendar.append(swatch, document.createTextNode(identity.accountAlias ? `${identity.label} · ${identity.accountAlias}` : identity.label));
  card.append(title, when, calendar);
  return card;
}

function isRecurring(detail: EventDetailDto): boolean {
  const event = detail.event;
  return (event.recurrence?.length ?? 0) > 0
    || Boolean(event.recurring_event_id || event.original_start || event.master_id || event.recurrence_unexpanded);
}

function hasNotifiableGuests(detail: EventDetailDto, entireSeries = false): boolean {
  const collaboration = detail.capabilities.collaboration;
  if (entireSeries) {
    return collaboration?.series_has_notifiable_guests ?? collaboration?.has_notifiable_guests === true;
  }
  return collaboration?.has_notifiable_guests === true;
}

/** The label is also used by Preview, before a confirmation is opened. */
export function eventRemovalKind(detail: EventDetailDto): EventRemovalKind {
  const isTimeBlock = detail.capabilities.display_kind === 'time-block';
  // A task-derived time block retains its task-removal semantics unless it is
  // a shared Google meeting.  Publishing it without guests must not turn its
  // "Remove" action into an event cancellation.
  if (detail.event.sync_context?.provider === 'google' && hasNotifiableGuests(detail)) return 'cancel-meeting';
  if (isTimeBlock) return 'remove';
  if (detail.event.sync_context?.provider === 'google') return 'cancel-event';
  return 'delete';
}

export function eventRemovalLabels(detail: EventDetailDto, locale: EventLocaleKey): EventRemovalLabels {
  switch (eventRemovalKind(detail)) {
    case 'cancel-meeting':
      return {
        kind: 'cancel-meeting',
        title: eventMessage('cancelMeetingTitle', locale),
        message: eventMessage('cancelMeetingBody', locale),
        confirmLabel: eventMessage('cancelMeeting', locale),
        dismissLabel: eventMessage('keepMeeting', locale),
      };
    case 'cancel-event':
      return {
        kind: 'cancel-event',
        title: eventMessage('cancelEventTitle', locale),
        message: eventMessage('cancelEventBody', locale),
        confirmLabel: eventMessage('cancelEvent', locale),
        dismissLabel: eventMessage('keepEvent', locale),
      };
    case 'remove':
      return {
        kind: 'remove',
        title: eventMessage('removeTitle', locale),
        message: eventMessage('removeBody', locale),
        confirmLabel: eventMessage('remove', locale),
        dismissLabel: eventMessage('cancel', locale),
      };
    case 'delete':
      return {
        kind: 'delete',
        title: eventMessage('delete', locale),
        message: detail.event.title,
        confirmLabel: eventMessage('delete', locale),
        dismissLabel: eventMessage('cancel', locale),
      };
  }
}

async function removeEvent(
  detail: EventDetailDto,
  entireSeries: boolean,
  guestUpdatePolicy?: string,
): Promise<void> {
  const event = detail.event;
  const route = event.sync_context;
  const sharedGoogleMeeting = route?.provider === 'google' && hasNotifiableGuests(detail);

  // A task time block stays a task operation unless it is a shared Google
  // meeting. That preserves the optional return-to-flexible transaction.
  if (detail.capabilities.display_kind === 'time-block' && !sharedGoogleMeeting) {
    await removeTimeBlock({
      event_id: event.id,
      return_to_flexible: entireSeries,
      operation_id: newOperationId('remove'),
    });
    return;
  }

  if (route?.provider === 'google') {
    await deleteRoutedEvent({
      event_id: event.id,
      account_id: route.account_id,
      calendar_id: route.calendar_id,
      recurrence_scope: isRecurring(detail)
        ? (entireSeries ? 'entire_series' : 'this_occurrence')
        : undefined,
      operation_id: newOperationId('delete'),
      guest_update_policy: guestUpdatePolicy === 'external_only' || guestUpdatePolicy === 'none'
        ? guestUpdatePolicy
        : 'all',
    });
    return;
  }

  await deleteEvent(
    event.id,
    isRecurring(detail) ? (entireSeries ? 'entire_series' : 'this_occurrence') : undefined,
  );
}

export function createEventRemovalDialog(options: EventRemovalDialogOptions): ConfirmDialog {
  const { detail, locale } = options;
  const labels = eventRemovalLabels(detail, locale);
  const recurring = isRecurring(detail);
  // The server decides which scopes can safely mutate this particular event.
  // Do not infer a series option from recurrence metadata alone: an occurrence
  // can be safely actionable while its master is not (and vice versa).
  const supportedScopes = detail.capabilities.recurrence_scopes ?? [];
  const defaultScope = supportedScopes.includes('this_occurrence')
    ? 'this_occurrence'
    : supportedScopes.includes('entire_series')
      ? 'entire_series'
      : undefined;
  const canChooseScope = supportedScopes.length > 1;
  const notifyThisOccurrence = detail.event.sync_context?.provider === 'google'
    && hasNotifiableGuests(detail);
  const notifyEntireSeries = detail.event.sync_context?.provider === 'google'
    && hasNotifiableGuests(detail, true);
  const hasNotificationChoice = notifyThisOccurrence || notifyEntireSeries;
  const isTimeBlock = detail.capabilities.display_kind === 'time-block';
  const context = removalContext(detail, locale);
  if (recurring && !canChooseScope && defaultScope) {
    const scopeNote = document.createElement('p');
    scopeNote.className = 'event-removal__scope-note';
    scopeNote.textContent = defaultScope === 'entire_series'
      ? eventMessage('cancelEntireSeries', locale)
      : eventMessageFormat('onlyThisOccurrence', { date: removalDateSummary(detail, locale) }, locale);
    context.appendChild(scopeNote);
  }
  let dialog: ConfirmDialog;
  dialog = new ConfirmDialog({
    title: labels.title,
    message: labels.message,
    bodyContent: context,
    className: 'event-removal-dialog',
    closeLabel: eventMessage('close', locale),
    confirmLabel: labels.confirmLabel,
    cancelLabel: labels.dismissLabel,
    choiceLabel: canChooseScope ? eventMessage('recurrenceScope', locale) : undefined,
    choiceOptions: canChooseScope ? supportedScopes.map(scope => ({
      value: scope,
      label: eventMessage(scope === 'entire_series' ? 'entireSeries' : 'thisOccurrence', locale),
      description: scope === 'entire_series'
        ? eventMessage('cancelEntireSeries', locale)
        : eventMessageFormat('onlyThisOccurrence', {
          date: removalDateSummary(detail, locale),
        }, locale),
    })) : undefined,
    choiceValue: defaultScope,
    checkboxLabel: !recurring && isTimeBlock && labels.kind === 'remove' && detail.capabilities.can_return_task_to_flexible
      ? eventMessage('returnFlexible', locale)
      : undefined,
    onChoiceChange: canChooseScope && hasNotificationChoice
      ? scope => dialog.setSelectVisible(scope === 'entire_series' ? notifyEntireSeries : notifyThisOccurrence)
      : undefined,
    selectLabel: hasNotificationChoice ? eventMessage('notifyGuests', locale) : undefined,
    selectOptions: hasNotificationChoice ? [
      { value: 'all', label: eventMessage('notifyAllGuests', locale) },
      { value: 'external_only', label: eventMessage('notifyExternalGuests', locale) },
      { value: 'none', label: eventMessage('notifyNoGuests', locale) },
    ] : undefined,
    selectVisible: defaultScope === 'entire_series' ? notifyEntireSeries : notifyThisOccurrence,
    variant: 'danger',
    failureMessage: eventMessage('failedRemoveEvent', locale),
    onConfirm: async (checked, guestUpdatePolicy, scope) => {
      options.onStart?.();
      try {
        await removeEvent(detail, recurring ? (scope ?? defaultScope) === 'entire_series' : checked, guestUpdatePolicy);
      } catch (error) {
        await options.onFailure(error);
        throw error;
      }
      // The durable provider mutation succeeded. A stale list/detail must not
      // turn that success into a retryable cancellation (which could delete a
      // newly-created replacement event). Close normally after reporting the
      // refresh issue through the owning surface.
      try {
        await options.onRemoved();
      } catch (error) {
        try {
          await options.onRefreshFailure?.(error);
        } catch {
          // The mutation is already committed; presentation recovery must not
          // re-open the destructive operation as a retry.
        }
      }
    },
  });
  return dialog;
}
