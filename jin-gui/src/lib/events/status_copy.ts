/**
 * Shared operation status copy — durable local vs provider state.
 *
 * Must never claim that invitation mail was sent successfully or opened.
 */

import type { EventDto } from '../../types/dto';
import {
  eventMessage,
  eventMessageFormat,
  type EventLocaleKey,
} from './locale';
import type { EventOperationState } from './operation_state';

export type OperationStatusKind =
  | 'sync_pending'
  | 'confirmed'
  | 'paused_needs_review'
  | 'reauth_required'
  | 'stale_conflict'
  | 'persisting';

export interface OperationStatusContext {
  locale?: EventLocaleKey;
  calendarName?: string | null;
  accountAlias?: string | null;
  /** Provider/account signal that reauthentication is required. */
  reauthRequired?: boolean;
  /** Optional caller override (already localized). */
  override?: string | null;
}

function calendarNameFor(
  event: Pick<EventDto, 'sync_context'> | null | undefined,
  locale: EventLocaleKey,
  override?: string | null,
): string {
  return override
    ?? event?.sync_context?.calendar_name
    ?? eventMessage('calendar', locale);
}

/**
 * Pure status sentence for companion/preview/detail operation regions.
 * Distinguishes local durability from provider confirmation.
 */
export function operationStatusCopy(
  state: EventOperationState | OperationStatusKind | null | undefined,
  event: Pick<EventDto, 'sync_context'> | null | undefined,
  context: OperationStatusContext = {},
): string | null {
  const locale = context.locale ?? 'en';
  if (context.override) return context.override;
  if (context.reauthRequired || state === 'reauth_required') {
    const account = context.accountAlias
      ?? event?.sync_context?.account_alias
      ?? eventMessage('calendar', locale);
    return eventMessageFormat('syncReauthRequired', { account }, locale);
  }
  switch (state) {
    case 'persisting':
      return eventMessage('saving', locale);
    case 'sync_pending':
      return eventMessageFormat(
        'syncingToCalendar',
        { calendar: calendarNameFor(event, locale, context.calendarName) },
        locale,
      );
    case 'confirmed':
      // Local write is durable; provider confirmation is a separate sentence when synced.
      if (event?.sync_context?.state === 'synced') {
        return eventMessage('googleSynced', locale);
      }
      return eventMessage('savedInJin', locale);
    case 'needs_review':
    case 'paused_needs_review':
      return eventMessage('syncNeedsReview', locale);
    case 'conflict':
    case 'stale_conflict':
      return eventMessage('eventChangedElsewhere', locale);
    default:
      return null;
  }
}

/** Map sync_context.state (+ optional operation state) into status copy. */
export function syncContextStatusCopy(
  event: Pick<EventDto, 'sync_context'>,
  locale: EventLocaleKey = 'en',
  operationState?: EventOperationState,
  statusMessage?: string | null,
): string | null {
  if (statusMessage) return statusMessage;
  if (operationState) {
    const fromOp = operationStatusCopy(operationState, event, { locale });
    if (fromOp) return fromOp;
  }
  const state = event.sync_context?.state;
  if (state === 'synced') return eventMessage('googleSynced', locale);
  if (state === 'pending') return eventMessage('awaitingGoogleSync', locale);
  if (state === 'paused' || state === 'sending') {
    return eventMessage('syncNeedsReview', locale);
  }
  return null;
}
