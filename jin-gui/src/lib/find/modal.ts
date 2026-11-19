import { JinModal } from '../ui/modal';
import type { FindFilter, FindItem } from './transform';

const FILTERS: Array<[FindFilter, string]> = [['all', 'All'], ['notes', 'Notes'], ['tasks', 'Tasks'], ['events', 'Calendar']];

export class FindModal extends JinModal {
  readonly input = document.createElement('input');
  private readonly results = document.createElement('div');
  private readonly status = document.createElement('p');
  private readonly retry = document.createElement('button');
  private readonly filters = document.createElement('div');
  private items: FindItem[] = [];
  private selected = 0;
  private renderedQuery = '';
  private renderedFilter: FindFilter = 'all';
  onQuery = (): void => {};
  onFilter = (_filter: FindFilter): void => {};
  onChoose = (_item: FindItem): void => {};
  onRetry = (): void => {};
  onDismiss = (): void => {};

  constructor() {
    super({ title: 'Find in Jin', ariaLabel: 'Find in Jin' });
    this.dialog.classList.add('jin-find');
    const body = document.createElement('div');
    body.className = 'jin-find__body';
    const label = document.createElement('label');
    label.className = 'form-label';
    label.htmlFor = 'jin-find-query';
    label.textContent = 'Search notes, tasks, and calendar';
    this.input.id = 'jin-find-query';
    this.input.type = 'search';
    this.input.className = 'form-input jin-find__query';
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.placeholder = 'Title, note text, tag, or location…';
    this.input.setAttribute('role', 'combobox');
    this.input.setAttribute('aria-autocomplete', 'list');
    this.input.setAttribute('aria-expanded', 'true');
    this.input.setAttribute('aria-controls', 'jin-find-results');
    this.input.addEventListener('input', () => this.onQuery());
    this.input.addEventListener('keydown', event => this.move(event));
    this.filters.className = 'jin-segmented-control jin-find__filters';
    this.filters.setAttribute('role', 'group');
    this.filters.setAttribute('aria-label', 'Search type');
    for (const [value, text] of FILTERS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.className = 'jin-segmented-control__item';
      button.dataset.findFilter = value;
      button.setAttribute('aria-pressed', String(value === 'all'));
      button.addEventListener('click', () => this.onFilter(value));
      this.filters.append(button);
    }
    this.status.className = 'jin-find__status';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.retry.type = 'button';
    this.retry.className = 'btn-secondary';
    this.retry.textContent = 'Retry search';
    this.retry.hidden = true;
    this.retry.addEventListener('click', () => this.onRetry());
    this.results.id = 'jin-find-results';
    this.results.className = 'jin-find__results';
    this.results.setAttribute('role', 'listbox');
    this.results.setAttribute('aria-label', 'Search results');
    body.append(label, this.input, this.filters, this.status, this.retry, this.results);
    this.setBody(body);
    const hint = document.createElement('p');
    hint.className = 'jin-find__hint';
    hint.textContent = '↑ ↓ to choose · Enter to open · Esc to close';
    this.setFooter(hint);
  }

  get isOpen(): boolean { return this.dialog.open; }

  protected onOpen(): void { this.input.focus(); }
  protected onClose(): void { this.onDismiss(); }

  render(items: FindItem[], filter: FindFilter, message: string, loading: boolean, failed: boolean): void {
    const prior = this.renderedQuery === this.input.value && this.renderedFilter === filter
      ? this.items[this.selected] : null;
    this.renderedQuery = this.input.value;
    this.renderedFilter = filter;
    this.items = items.slice(0, 50);
    this.selected = 0;
    if (prior) this.selected = Math.max(0, this.items.findIndex(item => item.id === prior.id && item.kind === prior.kind));
    this.status.textContent = message;
    this.retry.hidden = !failed;
    this.retry.disabled = loading;
    this.results.setAttribute('aria-busy', String(loading));
    for (const button of this.filters.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.findFilter === filter));
    }
    this.results.replaceChildren();
    for (const [index, item] of this.items.entries()) {
      const option = document.createElement('div');
      option.id = `jin-find-result-${index}`;
      option.className = 'jin-find__result';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(index === this.selected));
      const title = document.createElement('span');
      title.className = 'jin-find__title';
      title.textContent = item.title;
      const detail = document.createElement('span');
      detail.className = 'jin-find__detail';
      detail.textContent = item.detail;
      option.append(title, detail);
      if (item.preview) {
        const preview = document.createElement('span');
        preview.className = 'jin-find__preview';
        preview.textContent = item.preview;
        option.append(preview);
      }
      option.addEventListener('mousedown', event => event.preventDefault());
      option.addEventListener('click', () => this.onChoose(item));
      this.results.append(option);
    }
    this.syncSelection();
  }

  private move(event: KeyboardEvent): void {
    if (event.isComposing || !this.items.length) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      this.onChoose(this.items[this.selected]);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      this.selected = (this.selected + direction + this.items.length) % this.items.length;
      this.syncSelection();
      this.results.children[this.selected]?.scrollIntoView?.({ block: 'nearest' });
    }
  }

  private syncSelection(): void {
    this.input.removeAttribute('aria-activedescendant');
    for (const [index, option] of Array.from(this.results.children).entries()) {
      option.setAttribute('aria-selected', String(index === this.selected));
    }
    if (this.items.length) this.input.setAttribute('aria-activedescendant', `jin-find-result-${this.selected}`);
  }
}
