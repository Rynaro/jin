// @vitest-environment jsdom
import { Application } from '@hotwired/stimulus';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../invoke', () => ({ listGoogleAccounts: vi.fn() }));
import { listGoogleAccounts } from '../invoke';
import GoogleStatusController from '../controllers/google_status_controller';
import { loadSettingsPane } from '../lib/settings/navigation';
import type { GoogleAccountDto } from '../types/dto';

const account = (state: GoogleAccountDto['state']): GoogleAccountDto => ({
  id: 'personal', alias: 'Personal', principal: null, state, auth_generation: 1, calendars: [],
});
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
let app: Application;
const banner = () => document.querySelector<HTMLElement>('aside')!;
beforeEach(async () => {
  vi.mocked(listGoogleAccounts).mockReset().mockResolvedValue([account('connected')]);
  localStorage.clear();
  document.body.innerHTML = `<main data-controller="google-status">
    <aside hidden data-google-status-target="banner"><p data-google-status-target="message"></p>
    <button data-action="google-status#openSettings">Reconnect Google</button></aside></main>`;
  app = Application.start();
  app.register('google-status', GoogleStatusController);
  await flush();
});
afterEach(async () => {
  document.body.innerHTML = '';
  await flush();
  app.stop();
});

describe('Google recovery notice', () => {
  it('appears after a failed sync changes auth state and routes to Calendar Settings', async () => {
    expect(banner().hidden).toBe(true);
    vi.mocked(listGoogleAccounts).mockResolvedValue([account('needs_reauth')]);
    window.dispatchEvent(new CustomEvent('jin:google-state-changed'));
    await flush();
    expect(banner().hidden).toBe(false);
    expect(banner().textContent).toContain('Personal: Google access expired');
    const navigate = vi.fn();
    document.body.addEventListener('jin:navigate', navigate, { once: true });
    banner().querySelector('button')!.click();
    expect(loadSettingsPane()).toBe('calendars');
    expect(navigate.mock.calls[0][0].detail).toEqual({ kind: 'settings' });
    expect(listGoogleAccounts).toHaveBeenCalledTimes(2);
  });

  it('stays visible on a failed status read and clears after successful reauthentication', async () => {
    window.dispatchEvent(new CustomEvent('jin:google-accounts-loaded', { detail: [account('needs_reauth')] }));
    vi.mocked(listGoogleAccounts).mockRejectedValue(new Error('unavailable'));
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(banner().hidden).toBe(false);
    window.dispatchEvent(new CustomEvent('jin:google-accounts-loaded', { detail: [account('connected')] }));
    expect(banner().hidden).toBe(true);
  });
});
