import type { TaskDto, TaskRecurrence, TaskRecurrenceMutationScope } from '../../types/dto';

/** User input is kept as entered until Apply validates it. */
export interface TaskRepeatDraft {
  preset: 'never' | NonNullable<TaskRecurrence['editor_preset']>;
  interval: string;
  weekdays: number[];
  mode: TaskRecurrence['mode'];
  end: TaskRecurrence['end']['kind'];
  count: string;
  until: string;
  scope: TaskRecurrenceMutationScope;
  upcomingCount: string;
}

export function savedRepeatDraft(task: TaskDto, owner: TaskDto = task): TaskRepeatDraft {
  const series = owner.recurrence_series;
  const rule = series?.enabled ? series.rule : task.recurrence;
  const preset = series && !series.enabled ? 'never' : rule?.editor_preset
    ?? (rule?.frequency === 'weekly' && rule.interval === 1 && rule.weekdays.join(',') === '1,2,3,4,5'
      ? 'weekdays' : rule?.frequency ?? 'never');
  return {
    preset, interval: String(rule?.interval ?? 1), weekdays: [...(rule?.weekdays ?? [])],
    mode: rule?.mode ?? 'scheduled', end: rule?.end.kind ?? 'never',
    count: String(rule?.end.kind === 'count' ? rule.end.count : 1),
    until: rule?.end.kind === 'until' ? rule.end.date : '',
    scope: task.recurrence_instance || task.recurrence ? 'this_occurrence' : 'this_and_following',
    upcomingCount: String(series?.upcoming_count ?? 10),
  };
}

function inferredPreset(rule: TaskRecurrence): NonNullable<TaskRecurrence['editor_preset']> {
  return rule.editor_preset ?? (rule.frequency === 'weekly' && rule.interval === 1 && rule.weekdays.join(',') === '1,2,3,4,5' ? 'weekdays' : rule.frequency);
}

export function repeatAuthority(task: TaskDto, owner: TaskDto = task): string {
  const series = owner.recurrence_series;
  if (series) return `${series.series_id}:${series.revision}:${series.enabled}`;
  const instance = task.recurrence_instance;
  return instance ? `${instance.series_id}:${instance.revision}:true` : '';
}

export function sameRepeatRule(a: TaskRecurrence, b: TaskRecurrence): boolean {
  return a.frequency === b.frequency && a.interval === b.interval && a.mode === b.mode
    && a.weekdays.join(',') === b.weekdays.join(',')
    && JSON.stringify(a.end) === JSON.stringify(b.end)
    && inferredPreset(a) === inferredPreset(b);
}

/** Saved state for the inspector's quiet, read-first Repeat row. */
export function repeatSummary(task: TaskDto, owner: TaskDto = task): { title: string; detail: string } {
  const series = owner.recurrence_series;
  const rule = series ? (series.enabled ? series.rule : null) : task.recurrence;
  if (!rule) return { title: 'Does not repeat', detail: '' };
  const units = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };
  const title = inferredPreset(rule) === 'weekdays' ? 'Every weekday'
    : `Every ${rule.interval === 1 ? '' : `${rule.interval} `}${units[rule.frequency]}${rule.interval === 1 ? '' : 's'}`;
  const days = rule.frequency === 'weekly' && inferredPreset(rule) !== 'weekdays' && rule.weekdays.length
    ? rule.weekdays.map(day => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][day - 1]).join(', ') : '';
  const end = rule.end.kind === 'count' ? `Ends after ${rule.end.count} occurrences`
    : rule.end.kind === 'until' ? `Until ${rule.end.date}` : 'No end date';
  return {
    title: rule.mode === 'completion' ? `${title} after completion` : title,
    detail: [days, rule.mode === 'scheduled' ? `${series?.upcoming_count ?? 10} upcoming entries` : 'Next entry after completion', end].filter(Boolean).join(' · '),
  };
}
