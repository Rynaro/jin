export type ClockNormalizationResult =
  | { ok: true; time: string | null }
  | { ok: false };

/**
 * Normalizes a deliberately small set of keyboard-friendly clock forms.
 * Empty input is represented separately so callers can choose whether it is
 * valid (for example, a date-only task) without weakening event validation.
 */
export function normalizeClockInput(input: string): ClockNormalizationResult {
  const value = input.trim();
  if (!value) return { ok: true, time: null };

  let hourText = '';
  let minuteText = '';
  if (/^\d{1,2}$/.test(value)) {
    hourText = value;
    minuteText = '0';
  } else if (/^\d{3,4}$/.test(value)) {
    hourText = value.slice(0, -2);
    minuteText = value.slice(-2);
  } else {
    const colon = /^(\d{1,2}):(\d{2})$/.exec(value);
    if (!colon) return { ok: false };
    hourText = colon[1];
    minuteText = colon[2];
  }

  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (hour > 23 || minute > 59) return { ok: false };
  return {
    ok: true,
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}
