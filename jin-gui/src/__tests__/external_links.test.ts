// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: vi.fn(() => true) }));
vi.mock('../invoke', () => ({ openExternalUrl: vi.fn(() => Promise.resolve()) }));

import { isTauri } from '@tauri-apps/api/core';
import { openExternalUrl } from '../invoke';
import { confirmExternalLink, installExternalLinkService, normalizeExternalUrl } from '../lib/ui/externalLinks';

const dialog = () => document.querySelector<HTMLDialogElement>('.notes-external-dialog')!;
const button = (label: string) => Array.from(dialog().querySelectorAll<HTMLButtonElement>('button'))
  .find(candidate => candidate.textContent === label)!;

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event('close')); };
  installExternalLinkService();
});

afterEach(() => {
  if (dialog().open) dialog().close();
  document.querySelector('.test-reading')?.remove();
  vi.mocked(openExternalUrl).mockReset().mockResolvedValue();
  vi.mocked(isTauri).mockReturnValue(true);
});

describe('confirmed Notes external links', () => {
  it('accepts only complete credential-free HTTP(S) destinations', () => {
    expect(normalizeExternalUrl('https://example.com/a?x=1&y=2#part')).toBe('https://example.com/a?x=1&y=2#part');
    for (const bad of ['mailto:a@example.com', '//example.com', 'file:///tmp/a', 'javascript:alert(1)', 'https://a:b@example.com', 'https://example.com\n']) {
      expect(normalizeExternalUrl(bad)).toBeNull();
    }
  });

  it('blocks Read click, modifier, keyboard and aux activation before confirmation; Cancel opens nothing', () => {
    const host = document.createElement('div'); host.className = 'test-reading notes-detail-pane';
    host.innerHTML = '<div class="cm-reading-wrapper"><a href="https://example.com/path?x=1">Example</a></div>';
    document.body.append(host);
    const anchor = host.querySelector('a')!;
    for (const event of [
      new MouseEvent('click', { bubbles: true, cancelable: true }),
      new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }),
      new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }),
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }),
    ]) {
      anchor.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(dialog().open).toBe(true);
      expect(document.activeElement).toBe(button('Cancel'));
      button('Cancel').click();
      expect(dialog().open).toBe(false);
    }
    expect(openExternalUrl).not.toHaveBeenCalled();
  });

  it('opens one immutable destination only after explicit confirmation and handles failures without navigating Jin', async () => {
    confirmExternalLink('https://example.com/one?x=1&y=2');
    confirmExternalLink('https://other.example/two');
    expect(dialog().textContent).toContain('https://example.com/one?x=1&y=2');
    button('Open in browser').click();
    button('Open in browser').click();
    await vi.waitFor(() => expect(openExternalUrl).toHaveBeenCalledTimes(1));
    expect(openExternalUrl).toHaveBeenCalledWith('https://example.com/one?x=1&y=2');
    await vi.waitFor(() => expect(dialog().open).toBe(false));

    vi.mocked(openExternalUrl).mockRejectedValueOnce(new Error('blocked'));
    confirmExternalLink('https://example.com/retry');
    button('Open in browser').click();
    await vi.waitFor(() => expect(dialog().textContent).toContain('could not open'));
    expect(dialog().open).toBe(true);
    expect(button('Open in browser').disabled).toBe(false);
  });

  it('blocks unsupported links with feedback and detects browser popup blocking', async () => {
    confirmExternalLink('mailto:someone@example.com');
    expect(button('Open in browser').disabled).toBe(true);
    expect(dialog().textContent).toContain('Only complete http or https');
    button('Cancel').click();

    vi.mocked(isTauri).mockReturnValue(false);
    const popup = vi.spyOn(window, 'open').mockReturnValue(null);
    confirmExternalLink('https://example.com');
    button('Open in browser').click();
    await vi.waitFor(() => expect(dialog().textContent).toContain('could not open'));
    expect(popup).toHaveBeenCalledWith('about:blank', '_blank');
    popup.mockRestore();
  });
});
