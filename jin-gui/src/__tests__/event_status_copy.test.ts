// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  operationStatusCopy,
  syncContextStatusCopy,
} from '../lib/events/status_copy';

const FORBIDDEN_EMAIL_DELIVERY_CLAIMS = [
  'email was delivered',
  'email delivered',
  'email was received',
  'email received',
  'email was read',
  'email read',
  'delivered the email',
  'received the email',
  'read the email',
  'e-mail was delivered',
  'e-mail delivered',
  'e-mail was received',
  'e-mail received',
  'e-mail was read',
  'convite foi entregue',
  'e-mail foi entregue',
  'e-mail foi lido',
  'e-mail foi recebido',
] as const;
import { eventMessage, eventMessageFormat } from '../lib/events/locale';
import type { EventDto } from '../types/dto';

function eventWithState(state: string): Pick<EventDto, 'sync_context'> {
  return {
    sync_context: {
      provider: 'google',
      account_id: 'a',
      account_alias: 'Work',
      calendar_id: 'c',
      calendar_name: 'Team',
      access_role: 'owner',
      writable: true,
      state,
      allowed_conference_solution_types: [],
    },
  };
}

describe('operation status copy (AC-CALX-046)', () => {
  it('distinguishes durable local vs provider states without email-delivery claims', () => {
    const locale = 'en' as const;
    expect(operationStatusCopy('sync_pending', eventWithState('pending'), { locale }))
      .toBe(eventMessageFormat('syncingToCalendar', { calendar: 'Team' }, locale));
    expect(operationStatusCopy('confirmed', eventWithState('pending'), { locale }))
      .toBe(eventMessage('savedInJin', locale));
    expect(operationStatusCopy('confirmed', eventWithState('synced'), { locale }))
      .toBe(eventMessage('googleSynced', locale));
    expect(operationStatusCopy('needs_review', eventWithState('paused'), { locale }))
      .toBe(eventMessage('syncNeedsReview', locale));
    expect(operationStatusCopy('reauth_required', eventWithState('paused'), {
      locale,
      accountAlias: 'Work',
    })).toBe(eventMessageFormat('syncReauthRequired', { account: 'Work' }, locale));
    expect(operationStatusCopy('conflict', eventWithState('synced'), { locale }))
      .toBe(eventMessage('eventChangedElsewhere', locale));

    expect(syncContextStatusCopy(eventWithState('paused') as EventDto, locale))
      .toBe(eventMessage('syncNeedsReview', locale));
    expect(syncContextStatusCopy(eventWithState('pending') as EventDto, locale))
      .toBe(eventMessage('awaitingGoogleSync', locale));
  });

  it('forbids email delivery/read/received claims in locale catalogs and status helpers', () => {
    const files = [
      'src/lib/events/locale.ts',
      'src/lib/events/status_copy.ts',
      'src/lib/ui/companion.ts',
      'src/lib/events/preview.ts',
    ].map(rel => readFileSync(resolve(process.cwd(), rel), 'utf8').toLowerCase());

    for (const source of files) {
      for (const claim of FORBIDDEN_EMAIL_DELIVERY_CLAIMS) {
        expect(source.includes(claim), `found forbidden claim "${claim}"`).toBe(false);
      }
    }

    const sample = [
      operationStatusCopy('sync_pending', eventWithState('pending'), { locale: 'en' }),
      operationStatusCopy('confirmed', eventWithState('synced'), { locale: 'en' }),
      operationStatusCopy('needs_review', eventWithState('paused'), { locale: 'en' }),
      operationStatusCopy('reauth_required', eventWithState('paused'), { locale: 'en', accountAlias: 'Work' }),
      operationStatusCopy('conflict', eventWithState('synced'), { locale: 'en' }),
      operationStatusCopy('sync_pending', eventWithState('pending'), { locale: 'pt-BR' }),
      operationStatusCopy('reauth_required', eventWithState('paused'), { locale: 'pt-BR', accountAlias: 'Trabalho' }),
    ].join(' ').toLowerCase();
    for (const claim of FORBIDDEN_EMAIL_DELIVERY_CLAIMS) {
      expect(sample.includes(claim)).toBe(false);
    }
  });
});
