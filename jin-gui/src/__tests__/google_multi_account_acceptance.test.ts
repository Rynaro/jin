import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

interface FixtureBridge {
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
}

function freshBridge(): FixtureBridge {
  const source = readFileSync(
    fileURLToPath(new URL('../../tools/tauri-fixture-init.js', import.meta.url)),
    'utf8',
  );
  const dom = new JSDOM('', { url: 'http://127.0.0.1:1420', runScripts: 'outside-only' });
  dom.window.eval(source);
  return (dom.window as unknown as { __TAURI_INTERNALS__: FixtureBridge }).__TAURI_INTERNALS__;
}

describe('Google multi-account acceptance fixture', () => {
  it('exposes one Calendar Accounts flow and keeps BYO OAuth as advanced guidance', () => {
    const html = readFileSync(
      fileURLToPath(new URL('../../index.html', import.meta.url)),
      'utf8',
    );

    expect(html.match(/>Calendar Accounts</g)).toHaveLength(1);
    expect(html).not.toContain('aria-label="Google Account"');
    expect(html).not.toContain('Google Cloud OAuth Setup');
    expect(html).toContain('Advanced: use your own Google OAuth client');
  });

  it('starts every fresh context with two aliased accounts and exact calendar roles', async () => {
    const first = await freshBridge().invoke('list_google_accounts') as Array<Record<string, any>>;
    const second = await freshBridge().invoke('list_google_accounts') as Array<Record<string, any>>;

    expect(first).toEqual(second);
    expect(first.map((account) => account.alias)).toEqual(['Personal', 'Work']);
    expect(first[0].calendars).toEqual(expect.arrayContaining([
      expect.objectContaining({ calendar_id: 'personal-primary', access_role: 'owner', writable: true }),
      expect.objectContaining({ calendar_id: 'family-shared', access_role: 'reader', writable: false }),
    ]));
    expect(first[1].calendars).toEqual(expect.arrayContaining([
      expect.objectContaining({ calendar_id: 'work-primary', access_role: 'writer', writable: true }),
    ]));
  });

  it('coexists across Jin and both Google accounts with complete sync DTO context', async () => {
    const events = await freshBridge().invoke('list_events') as Array<Record<string, any>>;
    expect(events.find((event) => event.id === 'e1')).toMatchObject({ source: 'jin', sync_context: null });
    expect(events.find((event) => event.id === 'e7')).toMatchObject({
      source: 'google', authority: 'google',
      sync_context: {
        provider: 'google', account_id: 'acct-personal', account_alias: 'Personal',
        calendar_id: 'personal-primary', calendar_name: 'Personal', access_role: 'owner',
        writable: true, state: 'synced',
      },
    });
    expect(events.find((event) => event.id === 'e8')).toMatchObject({
      sync_context: { account_id: 'acct-work', calendar_id: 'work-primary', access_role: 'writer' },
    });
  });

  it('publishes promotion to the explicitly selected account and calendar', async () => {
    const bridge = freshBridge();
    const promoted = await bridge.invoke('promote_task', {
      task_id: 't6', slot: { when: '2026-08-28T09:00:00', tzid: 'America/Sao_Paulo' },
      operation_id: 'acceptance-promote-work', account_id: 'acct-work', calendar_id: 'work-primary',
    }) as Record<string, any>;

    expect(promoted).toMatchObject({
      source: 'jin', authority: 'jin', derived_from: 't6',
      sync_context: {
        provider: 'google', account_id: 'acct-work', account_alias: 'Work',
        calendar_id: 'work-primary', calendar_name: 'Team Calendar',
        access_role: 'writer', writable: true, state: 'pending',
      },
    });
  });
});
