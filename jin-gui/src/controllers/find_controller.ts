import { Controller } from '@hotwired/stimulus';
import { listEvents, listLists, listNotes, listTasks, searchNotes } from '../invoke';
import { FindModal } from '../lib/find/modal';
import { eventFindItems, findMatches, noteFindItems, taskFindItems, type FindFilter, type FindItem } from '../lib/find/transform';

export default class FindController extends Controller {
  private modal: FindModal | null = null;
  private items: FindItem[] = [];
  private filter: FindFilter = 'all';
  private loading = false;
  private failed: string[] = [];
  private generation = 0;
  private queryGeneration = 0;
  private queryTimer: ReturnType<typeof setTimeout> | null = null;
  private fullTextItems: FindItem[] = [];
  private fullTextLoading = false;
  private fullTextFailed = false;

  connect(): void {
    window.addEventListener('keydown', this.shortcut);
    const shortcut = this.element.querySelector('[data-find-shortcut]');
    if (shortcut) shortcut.textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ ⇧ F' : 'Ctrl ⇧ F';
  }

  disconnect(): void {
    window.removeEventListener('keydown', this.shortcut);
    this.generation += 1;
    this.cancelQuery();
    this.modal?.destroy();
    this.modal = null;
  }

  open(): void {
    if (document.querySelector('dialog[open]')) return;
    this.modal ??= this.createModal();
    this.items = [];
    this.failed = [];
    this.filter = 'all';
    this.fullTextItems = [];
    this.fullTextFailed = false;
    this.modal.input.value = '';
    this.modal.open();
    void this.load();
  }

  private createModal(): FindModal {
    const modal = new FindModal();
    modal.onQuery = () => { this.queueQuery(); };
    modal.onFilter = filter => { this.filter = filter; this.queueQuery(); };
    modal.onRetry = () => { void this.load(); this.queueQuery(); };
    modal.onDismiss = () => { this.generation += 1; this.cancelQuery(); };
    modal.onChoose = item => {
      modal.close();
      this.element.dispatchEvent(new CustomEvent('jin:navigate', {
        bubbles: true, detail: { kind: item.kind, id: item.id },
      }));
    };
    return modal;
  }

  private async load(): Promise<void> {
    const generation = ++this.generation;
    this.loading = true;
    this.render();
    const results = await Promise.allSettled([listNotes(), listTasks(), listEvents(), listLists()]);
    if (generation !== this.generation || !this.modal?.isOpen) return;
    const [notes, tasks, events, lists] = results;
    const listNames = new Map(lists.status === 'fulfilled' ? lists.value.map(list => [list.id, list.name]) : []);
    this.items = [
      ...(notes.status === 'fulfilled' ? noteFindItems(notes.value) : []),
      ...(tasks.status === 'fulfilled' ? taskFindItems(tasks.value, listNames) : []),
      ...(events.status === 'fulfilled' ? eventFindItems(events.value) : []),
    ];
    this.failed = results.flatMap((result, index) => result.status === 'rejected' ? [['notes', 'tasks', 'calendar', 'list names'][index]] : []);
    this.loading = false;
    this.render();
  }

  private render(): void {
    if (!this.modal) return;
    const combined = new Map(this.items.map(item => [`${item.kind}:${item.id}`, item]));
    for (const item of this.fullTextItems) combined.set(`notes:${item.id}`, item);
    const matches = findMatches([...combined.values()], this.modal.input.value, this.filter,
      new Set(this.fullTextItems.map(item => item.id)));
    let message = this.modal.input.value.trim()
      ? `${matches.length} result${matches.length === 1 ? '' : 's'}`
      : matches.length ? 'Recently updated in your workspace' : 'Your workspace has no notes, tasks, or events yet.';
    if (this.modal.input.value.trim() && !matches.length) message = 'No matches. Try another word or search type.';
    if (matches.length > 50) message += ' · Showing the first 50. Refine your search for more.';
    if (this.failed.length) message = `Could not load ${this.failed.join(', ')}.${this.items.length ? ' Other results are available.' : ''} Retry to refresh.`;
    if (this.fullTextLoading) message += ' · Searching full note text…';
    if (this.fullTextFailed) message += ' · Full note text is unavailable. Titles and previews are still searchable. Retry to refresh.';
    if (this.loading) message = 'Searching your workspace…';
    this.modal.render(matches, this.filter, message, this.loading, !!this.failed.length || this.fullTextFailed);
  }

  private cancelQuery(): void {
    this.queryGeneration += 1;
    if (this.queryTimer !== null) clearTimeout(this.queryTimer);
    this.queryTimer = null;
    this.fullTextLoading = false;
  }

  private queueQuery(): void {
    this.cancelQuery();
    this.fullTextItems = [];
    this.fullTextFailed = false;
    const query = this.modal?.input.value.trim() ?? '';
    if (!query || this.filter === 'tasks' || this.filter === 'events') { this.render(); return; }
    const generation = this.queryGeneration;
    this.fullTextLoading = true;
    this.render();
    this.queryTimer = setTimeout(() => {
      this.queryTimer = null;
      void this.searchNoteText(query, generation);
    }, 180);
  }

  private async searchNoteText(query: string, generation: number): Promise<void> {
    try {
      const notes = await searchNotes(query);
      if (generation !== this.queryGeneration || !this.modal?.isOpen) return;
      this.fullTextItems = noteFindItems(notes);
    } catch {
      if (generation !== this.queryGeneration || !this.modal?.isOpen) return;
      this.fullTextFailed = true;
    }
    if (generation === this.queryGeneration && this.modal?.isOpen) {
      this.fullTextLoading = false;
      this.render();
    }
  }

  private readonly shortcut = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing || event.repeat || event.altKey
      || !(event.metaKey || event.ctrlKey) || !event.shiftKey || event.key.toLowerCase() !== 'f'
      || document.querySelector('dialog[open]')) return;
    event.preventDefault();
    this.open();
  };
}
