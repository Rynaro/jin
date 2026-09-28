import { Controller } from '@hotwired/stimulus';
import { listGoogleAccounts } from '../invoke';
import type { GoogleAccountDto } from '../types/dto';
import { saveSettingsPane } from '../lib/settings/navigation';

/** Keep account recovery visible across views, including after a failed sync. */
export default class extends Controller<HTMLElement> {
  static targets = ['banner', 'message'];
  declare readonly bannerTarget: HTMLElement;
  declare readonly messageTarget: HTMLElement;
  private revision = 0;
  private refreshTimer?: ReturnType<typeof setInterval>;

  private readonly refresh = async (): Promise<void> => {
    const revision = ++this.revision;
    try {
      const accounts = await listGoogleAccounts();
      if (revision === this.revision) this.render(accounts);
    } catch {
      // A transient registry read failure must not clear a known auth problem.
    }
  };

  private readonly accountsLoaded = (event: Event): void => {
    ++this.revision;
    this.render((event as CustomEvent<GoogleAccountDto[]>).detail);
  };

  connect(): void {
    window.addEventListener('focus', this.refresh);
    window.addEventListener('jin:google-state-changed', this.refresh);
    window.addEventListener('jin:google-accounts-loaded', this.accountsLoaded);
    // Other native/background operations can update the persisted registry.
    // This reads local state only; it does not make Google requests.
    this.refreshTimer = setInterval(() => { if (!document.hidden) void this.refresh(); }, 30_000);
    void this.refresh();
  }

  disconnect(): void {
    ++this.revision;
    clearInterval(this.refreshTimer);
    window.removeEventListener('focus', this.refresh);
    window.removeEventListener('jin:google-state-changed', this.refresh);
    window.removeEventListener('jin:google-accounts-loaded', this.accountsLoaded);
  }

  openSettings(): void {
    saveSettingsPane('calendars');
    this.element.dispatchEvent(new CustomEvent('jin:navigate', {
      bubbles: true, detail: { kind: 'settings' },
    }));
  }

  private render(accounts: GoogleAccountDto[]): void {
    const expired = accounts.filter(account => account.state === 'needs_reauth');
    this.bannerTarget.hidden = expired.length === 0;
    this.messageTarget.textContent = expired.length
      ? `${expired.map(account => account.alias).join(', ')}: Google access expired. Reconnect to resume calendar sync.`
      : '';
  }
}
