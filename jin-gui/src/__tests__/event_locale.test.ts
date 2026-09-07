// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  eventMessage,
  loadEventLocalePreference,
  normalizeEventLocalePreference,
  resolveEventLocale,
  saveEventLocalePreference,
} from '../lib/events/locale';
import { formatEventDate, formatEventTime } from '../lib/events/transform';

describe('Calendar and Event locale registry (AC-030/AC-031)', () => {
  beforeEach(() => localStorage.clear());

  it('uses the supported system locale and falls back to English', () => {
    expect(resolveEventLocale('system', 'pt-PT')).toBe('pt-BR');
    expect(resolveEventLocale('system', 'en-US')).toBe('en');
    expect(resolveEventLocale('system', 'fr-FR')).toBe('en');
  });

  it('validates persisted overrides and fails closed to System Default', () => {
    localStorage.setItem('jin:event-locale', 'made-up');
    expect(loadEventLocalePreference()).toBe('system');
    expect(normalizeEventLocalePreference('pt-BR')).toBe('pt-BR');
    expect(normalizeEventLocalePreference('pt')).toBe('system');
  });

  it('persists a supported override and announces a rerender', () => {
    const changed = vi.fn();
    window.addEventListener('jin:event-locale-changed', changed, { once: true });
    expect(saveEventLocalePreference('pt-BR')).toBe('pt-BR');
    expect(localStorage.getItem('jin:event-locale')).toBe('pt-BR');
    expect(changed).toHaveBeenCalledOnce();
  });

  it('localizes visible and accessibility copy while preserving approved product tokens', () => {
    expect(eventMessage('calendar', 'pt-BR')).toBe('Calendário');
    expect(eventMessage('edit', 'pt-BR')).toBe('Editar');
    expect(eventMessage('sourceJin', 'pt-BR')).toBe('Source: Jin');
    expect(eventMessage('sourceGoogle', 'pt-BR')).toBe('Source: Google');
    expect(eventMessage('timeBlock', 'pt-BR')).toBe('Time block');
  });

  it('provides keyed English and pt-BR Calendar/Event error copy', () => {
    expect(eventMessage('failedAttachNote', 'en')).toBe('Failed to attach note');
    expect(eventMessage('failedAddRelated', 'pt-BR')).toBe('Não foi possível adicionar a nota relacionada');
    expect(eventMessage('failedLoadEvents', 'en')).toBe('Failed to load events');
    expect(eventMessage('failedRemoveEvent', 'pt-BR')).toBe('Não foi possível remover o evento');
  });

  it('passes the effective locale explicitly to date and time formatters', () => {
    expect(formatEventTime('2026-08-24', '2026-08-25', true, false, null, 'pt-BR')).toBe('Dia inteiro');
    expect(formatEventDate('2026-08-24T18:00:00Z', false, 'UTC', 'pt-BR')).toMatch(/24/);
    expect(formatEventTime('2026-08-24T18:00:00', '2026-08-24T19:30:00', false, true, null, 'pt-BR')).toBe('18:00 – 19:30');
  });
});
