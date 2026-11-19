import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatEventDate, formatEventTime } from '../lib/events/transform';

afterEach(() => vi.unstubAllEnvs());

describe('canonical event wall time display', () => {
  it('keeps explicitly UTC wall times in a Sao Paulo host', () => {
    vi.stubEnv('TZ', 'America/Sao_Paulo');
    const range = formatEventTime('2026-11-20T14:15:00', '2026-11-20T15:00:00', false, false, 'UTC', 'en');
    expect(range).toContain('02:15');
    expect(range).toContain('03:00');
    expect(formatEventDate('2026-11-20T00:15:00', false, 'UTC', 'en')).toContain('November 20');
  });

  it('keeps Sao Paulo wall times and dates in a UTC host', () => {
    vi.stubEnv('TZ', 'UTC');
    const range = formatEventTime('2026-11-20T00:15:00', '2026-11-20T01:00:00', false, false, 'America/Sao_Paulo', 'en');
    expect(range).toContain('12:15');
    expect(range).toContain('01:00');
    expect(formatEventDate('2026-11-20T00:15:00', false, 'America/Sao_Paulo', 'en')).toContain('November 20');
  });

  it('converts real offset timestamps and their date around midnight', () => {
    vi.stubEnv('TZ', 'UTC');
    expect(formatEventTime('2026-11-20T00:15:00Z', '2026-11-20T01:00:00Z', false, false, 'America/Sao_Paulo', 'en')).toContain('09:15');
    expect(formatEventDate('2026-11-20T00:15:00Z', false, 'America/Sao_Paulo', 'en')).toContain('November 19');
    expect(formatEventDate('2026-11-20', true, 'America/Sao_Paulo', 'en')).toContain('November 20');
  });
});
