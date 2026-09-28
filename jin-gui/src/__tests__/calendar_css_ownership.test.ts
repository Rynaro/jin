// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = (name: string) => readFileSync(resolve(process.cwd(), `src/styles/${name}`), 'utf8');

/** Remove comments and any @media/@supports/@container blocks (nested-brace aware). */
function unscopedRules(css: string): string {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let out = '';
  let i = 0;
  while (i < withoutComments.length) {
    const at = withoutComments.slice(i).match(/^@(?:media|supports|container)\b/);
    if (at) {
      const start = i + at[0].length;
      const brace = withoutComments.indexOf('{', start);
      if (brace < 0) break;
      let depth = 0;
      let j = brace;
      for (; j < withoutComments.length; j++) {
        if (withoutComments[j] === '{') depth++;
        else if (withoutComments[j] === '}') {
          depth--;
          if (depth === 0) {
            j++;
            break;
          }
        }
      }
      i = j;
      continue;
    }
    out += withoutComments[i];
    i++;
  }
  return out;
}

function countUnscopedSelector(css: string, selector: string): number {
  const body = unscopedRules(css);
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Count only rules whose selector list begins with the geometry selector
  // (ignore descendant forms like `.scroller > .calendar-day-grid`).
  const re = new RegExp(`(?:^|[},])\\s*${escaped}(?=\\s*[,{])`, 'gm');
  return [...body.matchAll(re)].length;
}

describe('calendar CSS ownership (AC-CALX-061)', () => {
  it('keeps calendar geometry out of browse/events content owners', () => {
    const browse = styles('browse.css');
    const events = styles('events.css');
    const geometry = [
      '.calendar-day-grid',
      '.calendar-week-row',
      '.calendar-day-cell',
      '.calendar-timegrid',
      '.calendar-month-header',
    ];
    for (const selector of geometry) {
      expect(browse.includes(selector), `${selector} leaked into browse.css`).toBe(false);
      expect(countUnscopedSelector(events, selector), `${selector} rule in events.css`).toBe(0);
    }
  });

  it('keeps Event Companion / composer content out of calendar.css', () => {
    const calendar = styles('calendar.css');
    for (const needle of ['.event-companion', '.event-preview', '.event-composer']) {
      expect(calendar.includes(needle), `${needle} leaked into calendar.css`).toBe(false);
    }
  });

  it('rejects a third unscoped late-override stack for core month geometry', () => {
    const calendar = styles('calendar.css');
    expect(countUnscopedSelector(calendar, '.calendar-day-grid')).toBeLessThanOrEqual(2);
    expect(countUnscopedSelector(calendar, '.calendar-month-header')).toBeLessThanOrEqual(2);
    expect(countUnscopedSelector(calendar, '.calendar-day-cell')).toBeLessThanOrEqual(2);
    expect(calendar.includes('Events: paper field and editorial controls')).toBe(false);
  });

  it('requires the Calendar extension checklist headings', () => {
    const checklist = readFileSync(
      resolve(process.cwd(), '../.spectra/plans/calendar-experience/extension-checklist.md'),
      'utf8',
    );
    for (const phrase of [
      'Shared section placement',
      'Summary copy',
      'Mode / capability / state matrix',
      'Owner',
      'Duplicate-removal list',
      'Cross-entry regression coverage',
    ]) {
      expect(checklist).toContain(phrase);
    }
  });
});
