import type { ListDto } from '../../types/dto';

/** A deliberately small, familiar set for persistent list and board identity. */
export const LIST_IDENTITY_ICONS = [
  { name: 'list', label: 'List' },
  { name: 'layout-grid', label: 'Board' },
  { name: 'briefcase-business', label: 'Work' },
  { name: 'house', label: 'Home' },
  { name: 'heart', label: 'Personal' },
  { name: 'shopping-bag', label: 'Shopping' },
  { name: 'graduation-cap', label: 'Learning' },
  { name: 'plane', label: 'Travel' },
] as const;

type ListIdentityIcon = typeof LIST_IDENTITY_ICONS[number]['name'];

const REGISTERED_SAVED_LIST_ICONS = new Set([
  'inbox', 'list-todo', 'book-open', 'folder', 'tag', 'calendar',
  ...LIST_IDENTITY_ICONS.map(icon => icon.name),
]);

export function defaultListIcon(workflow: 'checklist' | 'board'): ListIdentityIcon {
  return workflow === 'board' ? 'layout-grid' : 'list';
}

export function isListIdentityIcon(icon: string): icon is ListIdentityIcon {
  return LIST_IDENTITY_ICONS.some(candidate => candidate.name === icon);
}

/** Render legacy but already-registered choices faithfully, with a workflow-aware safe fallback. */
export function listGlyph(icon: string, workflow: ListDto['workflow_kind']): string {
  // Early list data used Lucide's older `briefcase` name. Keep its stored
  // value intact while rendering the registered modern business glyph.
  if (icon === 'briefcase') return 'briefcase-business';
  return REGISTERED_SAVED_LIST_ICONS.has(icon)
    ? icon
    : defaultListIcon(workflow === 'board' ? 'board' : 'checklist');
}
