import { describe, expect, it } from 'vitest';
import {
  defaultRecurrenceDraft,
  normalizeRecurrenceDraft,
  recurrenceFromRepeatValue,
  recurrenceUiCopy,
} from '../lib/events/recurrence';

describe('shared recurrence form state', () => {
  it('keeps Calendar and Capture presets on the same canonical draft shape', () => {
    expect(recurrenceFromRepeatValue('weekly')).toEqual(defaultRecurrenceDraft('weekly'));
    expect(recurrenceFromRepeatValue('none')).toBeUndefined();
  });

  it('normalizes unsafe interval, duplicate weekdays, and occurrence count', () => {
    expect(normalizeRecurrenceDraft({
      frequency: 'weekly', interval: 0, weekly_days: ['mo', 'mo', 'fr'],
      end: { kind: 'count', count: 0 },
    })).toEqual({
      frequency: 'weekly', interval: 1, weekly_days: ['mo', 'fr'],
      monthly: undefined, end: { kind: 'count', count: 1 },
    });
  });

  it('ships complete English and Brazilian Portuguese creation copy', () => {
    expect(recurrenceUiCopy('en').custom).toBe('Custom…');
    expect(recurrenceUiCopy('pt-BR')).toMatchObject({
      repeat: 'Repetir', custom: 'Personalizado…', preview: 'Próximas 3',
    });
  });
});
