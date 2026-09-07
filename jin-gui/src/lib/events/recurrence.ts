import type {
  MonthlyRecurrence,
  RecurrenceDraft,
  RecurrenceEnd,
  RecurrenceFrequency,
  RecurrenceWeekday,
} from '../../invoke';

export const WEEKDAYS: readonly RecurrenceWeekday[] = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'];

export function defaultRecurrenceDraft(
  frequency: RecurrenceFrequency = 'weekly',
): RecurrenceDraft {
  return {
    frequency,
    interval: 1,
    weekly_days: [],
    end: { kind: 'never' },
  };
}

export function recurrenceFromRepeatValue(value: string): RecurrenceDraft | undefined {
  return value === 'daily' || value === 'weekly' || value === 'monthly' || value === 'yearly'
    ? defaultRecurrenceDraft(value)
    : undefined;
}

export function normalizeRecurrenceDraft(draft: RecurrenceDraft): RecurrenceDraft {
  const weeklyDays = draft.frequency === 'weekly'
    ? [...new Set(draft.weekly_days)].filter(day => WEEKDAYS.includes(day))
    : [];
  const monthly: MonthlyRecurrence | undefined = draft.frequency === 'monthly'
    ? draft.monthly
    : undefined;
  const end: RecurrenceEnd = draft.end.kind === 'count'
    ? { kind: 'count', count: Math.max(1, Math.trunc(draft.end.count)) }
    : draft.end;
  return {
    frequency: draft.frequency,
    interval: Math.max(1, Math.trunc(draft.interval)),
    weekly_days: weeklyDays,
    monthly,
    end,
  };
}

export function recurrenceLabel(draft: RecurrenceDraft, locale: 'en' | 'pt-BR'): string {
  const every = locale === 'pt-BR' ? 'A cada' : 'Every';
  const labels: Record<RecurrenceFrequency, [string, string]> = {
    daily: ['day', 'dia'], weekly: ['week', 'semana'], monthly: ['month', 'mês'], yearly: ['year', 'ano'],
  };
  const unit = labels[draft.frequency][locale === 'pt-BR' ? 1 : 0];
  return draft.interval === 1 ? `${every} ${unit}` : `${every} ${draft.interval} ${unit}s`;
}

const recurrenceCatalog = {
  en: {
    repeat: 'Repeat', none: 'Does not repeat', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly', custom: 'Custom…',
    every: 'Every', onDays: 'On days', monthlyOn: 'Monthly on', dayOfMonth: 'Day', ends: 'Ends', never: 'Never', onDate: 'On date', after: 'After', occurrences: 'occurrences', preview: 'Next 3',
    units: ['day', 'week', 'month', 'year'], weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    weekdayNames: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    ordinals: ['First', 'Second', 'Third', 'Fourth', 'Last'],
    intervalLabel: 'Repeat interval', unitLabel: 'Repeat unit', weekdaysLabel: 'Repeat on weekdays',
    monthDayLabel: 'Day of month', weekOfMonthLabel: 'Week of month', weekdayLabel: 'Weekday', countLabel: 'Number of occurrences',
    googleRequired: 'Choose a writable Google Calendar to create a recurring event.',
  },
  'pt-BR': {
    repeat: 'Repetir', none: 'Não se repete', daily: 'Diariamente', weekly: 'Semanalmente', monthly: 'Mensalmente', yearly: 'Anualmente', custom: 'Personalizado…',
    every: 'A cada', onDays: 'Nos dias', monthlyOn: 'Mensalmente em', dayOfMonth: 'Dia', ends: 'Termina', never: 'Nunca', onDate: 'Em uma data', after: 'Após', occurrences: 'ocorrências', preview: 'Próximas 3',
    units: ['dia', 'semana', 'mês', 'ano'], weekdays: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'],
    weekdayNames: ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado', 'Domingo'],
    ordinals: ['Primeiro', 'Segundo', 'Terceiro', 'Quarto', 'Último'],
    intervalLabel: 'Intervalo de repetição', unitLabel: 'Unidade de repetição', weekdaysLabel: 'Repetir nos dias da semana',
    monthDayLabel: 'Dia do mês', weekOfMonthLabel: 'Semana do mês', weekdayLabel: 'Dia da semana', countLabel: 'Número de ocorrências',
    googleRequired: 'Escolha um Google Calendar com permissão de escrita para criar um evento recorrente.',
  },
} as const;

export function recurrenceUiCopy(locale: 'en' | 'pt-BR') {
  return recurrenceCatalog[locale];
}
