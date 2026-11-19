// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Application } from '@hotwired/stimulus';
import FindController from '../controllers/find_controller';
import { eventFindItems, findMatches, noteFindItems, taskFindItems } from '../lib/find/transform';
import type { EventDto, NoteDto, TaskDto } from '../types/dto';
import { listEvents, listLists, listNotes, listTasks, searchNotes } from '../invoke';

vi.mock('../invoke', () => ({ listNotes: vi.fn(), listTasks: vi.fn(), listEvents: vi.fn(), listLists: vi.fn(), searchNotes: vi.fn() }));
vi.mock('../lib/icons', () => ({ initIcons: vi.fn() }));

const note = (id = 'note-1', title = 'Roadmap'): NoteDto => ({ id, title, status: 'active', created: '2026-11-01', updated: '2026-11-12', deleted_at: null, tags: ['planning'], links: [], backlinks: [], excerpt: 'Coordinate a launch', folder_path: 'Work' });
const task = (): TaskDto => ({ id: 'task-1', title: 'Roadmap review', status: 'todo', priority: 'none', due: null, list: 'inbox', completed_at: null, deleted_at: null, created: '2026-11-01', updated: '2026-11-19', backlinks: [] });
const event = (): EventDto => ({ id: 'event-1', title: 'Review', description: 'Roadmap decisions', location: 'Studio', start: '2026-11-20T09:00:00', end: '2026-11-20T10:00:00', floating: true, is_all_day: false, start_tzid: null, end_tzid: null, status: 'confirmed', source: 'jin', authority: 'local', ical_uid: null, derived_from: null, recurrence: [], recurring_event_id: null, original_start: null, master_id: null, recurrence_unexpanded: false, sequence: 0, created: '2026-11-01', updated: '2026-11-10', backlinks: [] });

describe('workspace Find projections', () => {
  it('ranks exact titles before prefixes and metadata, regardless of update time', () => {
    const items = [...noteFindItems([note()]), ...taskFindItems([task()]), ...eventFindItems([event()])];
    expect(findMatches(items, 'roadmap', 'all').map(item => item.id)).toEqual(['note-1', 'task-1', 'event-1']);
    expect(findMatches(items, 'roadmap', 'events').map(item => item.id)).toEqual(['event-1']);
    expect(findMatches(items, 'launch planning', 'notes').map(item => item.id)).toEqual(['note-1']);
    expect(findMatches(items, 'roadmap missing', 'all')).toEqual([]);
  });

  it('supports accents and deterministic ties and omits deleted objects', () => {
    const items = noteFindItems([note('b', 'Café'), note('a', 'Café'), { ...note('gone'), deleted_at: '2026-11-19' }]);
    expect(findMatches(items, 'cafe', 'all').map(item => item.id)).toEqual(['a', 'b']);
    expect(items).toHaveLength(2);
  });

  it('sorts recent items by instants across timezone offsets and handles old missing dates', () => {
    const items = noteFindItems([
      { ...note('earlier'), updated: '2026-11-19T09:00:00+02:00' },
      { ...note('latest'), updated: '2026-11-19T08:30:00Z' },
      { ...note('legacy'), updated: '' },
    ]);
    expect(findMatches(items, '', 'all').map(item => item.id)).toEqual(['latest', 'earlier', 'legacy']);
  });

  it('retains canonical recurrence identity and literal floating or all-day dates', () => {
    const original = { ...event(), recurrence: ['RRULE:FREQ=WEEKLY'], is_all_day: true, start: '2026-11-20', end: '2026-11-21' };
    const [item] = eventFindItems([original]);
    expect(item.id).toBe(original.id);
    expect(item.detail).toContain('November 20');
    expect(item.detail).toContain('Recurring series');
    expect(eventFindItems([event()])[0].detail).toContain('09:00');
    expect(original.start).toBe('2026-11-20');
  });
});

describe('workspace Find interactions', () => {
  let app: Application;
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const query = () => document.querySelector<HTMLInputElement>('#jin-find-query')!;
  const search = async (value: string) => {
    query().value = value;
    query().dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.mocked(listNotes).mockResolvedValue([note()]);
    vi.mocked(listTasks).mockResolvedValue([task()]);
    vi.mocked(listEvents).mockResolvedValue([event()]);
    vi.mocked(listLists).mockResolvedValue([]);
    vi.mocked(searchNotes).mockResolvedValue([]);
    HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    HTMLDialogElement.prototype.close = function () { this.open = false; };
    document.body.innerHTML = '<div data-controller="find"><button data-action="click->find#open">Find</button></div>';
    app = Application.start();
    app.register('find', FindController);
    await tick();
  });

  afterEach(async () => {
    document.body.innerHTML = '';
    await tick();
    app.stop();
  });

  async function open(): Promise<void> {
    const button = document.querySelector<HTMLButtonElement>('[data-action]')!;
    button.focus();
    button.click();
    await tick();
  }

  it('loads projections once per open, filters locally and opens the selected canonical detail', async () => {
    const navigate = vi.fn();
    document.addEventListener('jin:navigate', navigate, { once: true });
    await open();
    expect(document.activeElement).toBe(query());
    await search('roadmap');
    expect(document.querySelectorAll('[role=option]')).toHaveLength(3);
    await search('road');
    expect(listNotes).toHaveBeenCalledTimes(1);
    expect(listEvents).toHaveBeenCalledTimes(1);
    await search('roadmap');
    query().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    query().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(navigate.mock.calls[0][0].detail).toEqual({ kind: 'tasks', id: 'task-1' });
    expect(document.querySelector('dialog')?.open).toBe(false);
    expect(document.activeElement).toBe(document.querySelector('[data-action]'));
  });

  it('keeps user content inert and announces empty filtered results', async () => {
    vi.mocked(listNotes).mockResolvedValue([note('unsafe', '<img src=x onerror=alert(1)>')]);
    await open();
    expect(document.querySelector('#jin-find-results img')).toBeNull();
    expect(document.querySelector('#jin-find-results')?.textContent).toContain('<img');
    await search('not-present');
    expect(document.querySelector('[role=status]')?.textContent).toMatch(/No matches/);
    expect(query().hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('shows partial source failures with working results and an explicit retry', async () => {
    vi.mocked(listTasks).mockRejectedValueOnce(new Error('locked'));
    await open();
    expect(document.querySelector('[role=status]')?.textContent).toMatch(/Could not load tasks/);
    expect(document.querySelectorAll('[role=option]')).toHaveLength(2);
    const retry = Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Retry search')!;
    retry.click();
    await tick();
    expect(document.querySelectorAll('[role=option]')).toHaveLength(3);
    expect(retry.hidden).toBe(true);
  });

  it('discards stale requests after close and a new open', async () => {
    let resolveOld!: (value: NoteDto[]) => void;
    vi.mocked(listNotes).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
    await open();
    document.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true }));
    await open();
    resolveOld([note('old', 'Obsolete')]);
    await tick();
    expect(document.querySelector('#jin-find-results')?.textContent).not.toContain('Obsolete');
    expect(document.querySelector('#jin-find-results')?.textContent).toContain('Roadmap');
  });

  it('finds text beyond the note preview and rejects an older full-text response', async () => {
    let resolveOld!: (value: NoteDto[]) => void;
    vi.mocked(searchNotes).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
    vi.mocked(searchNotes).mockResolvedValueOnce([note('deep', 'Research notebook')]);
    await open();
    await search('old phrase');
    await new Promise(resolve => setTimeout(resolve, 200));
    await search('deep phrase');
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(searchNotes).toHaveBeenLastCalledWith('deep phrase');
    expect(document.querySelector('#jin-find-results')?.textContent).toContain('Research notebook');
    resolveOld([note('old', 'Obsolete result')]);
    await tick();
    expect(document.querySelector('#jin-find-results')?.textContent).not.toContain('Obsolete result');
    expect(listTasks).toHaveBeenCalledTimes(1);
  });

  it('retains title matches when full-text search fails', async () => {
    vi.mocked(searchNotes).mockRejectedValue(new Error('index busy'));
    await open();
    await search('roadmap');
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(document.querySelector('#jin-find-results')?.textContent).toContain('Roadmap');
    expect(document.querySelector('[role=status]')?.textContent).toContain('Full note text is unavailable');
  });

  it('opens through its distinct shortcut and defers to an already open dialog', async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, shiftKey: true, cancelable: true }));
    await tick();
    expect(document.querySelector('dialog')?.open).toBe(true);
    document.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true }));
    const other = document.createElement('dialog');
    other.open = true;
    document.body.append(other);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, shiftKey: true, cancelable: true }));
    expect(document.querySelector('.jin-find')?.hasAttribute('open')).toBe(false);
    expect(listNotes).toHaveBeenCalledTimes(1);
  });
});
