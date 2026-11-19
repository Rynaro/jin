import type { EventDto, NoteDto, TaskDto } from '../../types/dto';
import { formatEventDate, formatEventTime, sourceBadgeLabel } from '../events/transform';
import { formatTaskDue, taskPriorityLabel, taskStatusLabel } from '../tasks/transform';

export type FindKind = 'notes' | 'tasks' | 'events';
export type FindFilter = 'all' | FindKind;

export interface FindItem {
  id: string;
  kind: FindKind;
  title: string;
  detail: string;
  preview: string;
  searchText: string;
  updated: string;
}

function normalized(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim();
}

function updatedTime(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/** Read projections only. Opening a result hydrates its authoritative detail. */
export function noteFindItems(notes: NoteDto[]): FindItem[] {
  return notes.filter(note => !note.deleted_at).map(note => ({
    id: note.id, kind: 'notes', title: note.title || 'Untitled note',
    detail: ['Note', note.folder_path || 'Notes', note.status === 'archived' ? 'Archived' : ''].filter(Boolean).join(' · '),
    preview: note.excerpt || '',
    searchText: [note.title, note.excerpt, note.folder_path, ...note.tags].join(' '),
    updated: note.updated,
  }));
}

export function taskFindItems(tasks: TaskDto[], listNames: ReadonlyMap<string, string> = new Map()): FindItem[] {
  return tasks.filter(task => !task.deleted_at).map(task => ({
    id: task.id, kind: 'tasks', title: task.title || 'Untitled task',
    detail: ['Task', listNames.get(task.list), taskStatusLabel(task.status), task.due ? `Due ${formatTaskDue(task.due)}` : '', task.priority !== 'none' ? taskPriorityLabel(task.priority) : ''].filter(Boolean).join(' · '),
    preview: '',
    searchText: [task.title, listNames.get(task.list), taskStatusLabel(task.status), taskPriorityLabel(task.priority), ...(task.tags ?? [])].join(' '),
    updated: task.updated,
  }));
}

export function eventFindItems(events: EventDto[]): FindItem[] {
  return events.map(event => {
    // Floating wall times retain their literal date. Recurring records keep
    // their canonical identity and start, without synthesizing occurrences.
    const date = formatEventDate(event.start, event.is_all_day || event.floating, event.start_tzid);
    const time = formatEventTime(event.start, event.end, event.is_all_day, event.floating, event.start_tzid);
    const calendar = event.sync_context?.calendar_name || sourceBadgeLabel(event.source);
    return {
      id: event.id, kind: 'events', title: event.title || 'Untitled event',
      detail: ['Event', date, time, !event.is_all_day ? event.start_tzid : '', calendar,
        event.recurrence.length ? 'Recurring series' : '', event.status === 'cancelled' ? 'Cancelled' : ''].filter(Boolean).join(' · '),
      preview: event.location || '',
      searchText: [event.title, event.location, event.description, calendar].join(' '),
      updated: event.updated,
    };
  });
}

export function findMatches(items: FindItem[], query: string, filter: FindFilter, matchedNoteIds: ReadonlySet<string> = new Set()): FindItem[] {
  const term = normalized(query);
  const words = term.split(/\s+/).filter(Boolean);
  function rank(item: FindItem): number {
    const title = normalized(item.title);
    if (title === term) return 0;
    if (title.startsWith(term)) return 1;
    if (title.includes(term)) return 2;
    return 3;
  }
  return items.filter(item => (filter === 'all' || item.kind === filter)
    && ((item.kind === 'notes' && matchedNoteIds.has(item.id))
      || words.every(word => normalized(item.searchText).includes(word))))
    .sort((a, b) => (term ? rank(a) - rank(b) : 0)
      || updatedTime(b.updated) - updatedTime(a.updated)
      || a.title.localeCompare(b.title)
      || a.kind.localeCompare(b.kind)
      || a.id.localeCompare(b.id));
}
