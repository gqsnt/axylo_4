import { describe, expect, it } from 'vitest';
import { SLOT_ABSENT_FIELD, SLOT_GAP, SLOT_INVALID, SLOT_NO_ROW, SLOT_NULL, SLOT_VALUE } from '../../src/core/contracts';
import { createFormatters, type FormatSpec } from '../../src/format/index';

const norm = (s: string): string => s.replace(/[  ]/g, ' ');
const messages = { noData: 'No data', noObservation: 'No observation' };

function spec(x: Partial<FormatSpec['x']>, extra: Partial<FormatSpec> = {}): FormatSpec {
  return {
    series: [
      { field: 'sessions', unit: 'sessions', scale: null },
      { field: 'share', unit: null, scale: 'ratio' },
    ],
    x: { field: 'day', kind: 'date', unit: null, timeZone: null, dateUnit: 'day', categories: null, ...x },
    messages,
    ...extra,
  };
}

describe('createFormatters', () => {
  it('formats values per series with unit and scale', () => {
    const f = createFormatters(spec({}), { locale: 'en-US', timeZone: 'UTC' });
    expect(f.value(0, 36207.5)).toBe('36,207.5 sessions');
    expect(f.value(1, 0.125)).toBe('12.5%');
  });

  it('uses the chart locale over the environment locale', () => {
    const f = createFormatters(spec({}, { locale: 'de-DE' }), { locale: 'en-US', timeZone: 'UTC' });
    expect(f.value(0, 1234567)).toBe('1.234.567 sessions');
  });

  it('reads calendar dates the same in every viewer zone (spec F4a)', () => {
    const texts = ['UTC', 'America/Los_Angeles', 'Asia/Kolkata'].map(timeZone => norm(createFormatters(spec({}), { locale: 'en-US', timeZone }).x(Date.UTC(2026, 1, 24))));
    expect(texts).toEqual(['Feb 24, 2026', 'Feb 24, 2026', 'Feb 24, 2026']);
  });

  it('reads instants in the field zone, the viewer zone for "local" (spec F4b–d)', () => {
    const t = Date.UTC(2026, 1, 24);
    const local = createFormatters(spec({ kind: 'time', timeZone: 'local', dateUnit: null }), { locale: 'en-US', timeZone: 'Asia/Kolkata' });
    expect(norm(local.x(t))).toBe('Feb 24, 2026, 5:30 AM GMT+5:30');
    const la = createFormatters(spec({ kind: 'time', timeZone: 'America/Los_Angeles', dateUnit: null }), { locale: 'en-US', timeZone: 'Asia/Kolkata' });
    expect(norm(la.x(t))).toBe('Feb 23, 2026, 4:00 PM PST');
  });

  it('reads numbers and categories on x', () => {
    const n = createFormatters(spec({ kind: 'number', unit: 'km', dateUnit: null }), { locale: 'en-US', timeZone: 'UTC' });
    expect(n.x(1234.5)).toBe('1,234.5 km');
    const c = createFormatters(spec({ kind: 'category', categories: ['Direct', 'Search'], dateUnit: null }), { locale: 'en-US', timeZone: 'UTC' });
    expect(c.x(1)).toBe('Search');
  });

  it('says "No observation" only where the series has no row, "No data" for every other missing state', () => {
    const f = createFormatters(spec({}), { locale: 'en-US', timeZone: 'UTC' });
    expect(f.missing(SLOT_NO_ROW)).toBe('No observation');
    for (const s of [SLOT_NULL, SLOT_INVALID, SLOT_GAP, SLOT_ABSENT_FIELD] as const) expect(f.missing(s)).toBe('No data');
    expect(f.missing(SLOT_VALUE)).toBe('');
  });

  it('reports a throwing author formatter once per field and keeps the chart readable (AX160)', () => {
    const reports: string[] = [];
    const f = createFormatters(
      {
        ...spec({ format: () => { throw new Error('x'); } }),
        series: [{ field: 'sessions', unit: null, scale: null, format: () => { throw new Error('v'); } }],
        onFormatterError: field => reports.push(field),
      },
      { locale: 'en-US', timeZone: 'UTC' },
    );
    expect(f.value(0, 5)).toBe('5');
    expect(f.value(0, 6)).toBe('6');
    expect(norm(f.x(Date.UTC(2026, 1, 24)))).toBe('Feb 24, 2026');
    expect(reports).toEqual(['sessions', 'day']);
  });
});

describe('shares (spec F8: at most one fraction digit), unlike percent-scaled values (F6)', () => {
  it('a share of 5/29 reads 17.2%, in each locale', () => {
    const en = createFormatters(spec({}), { locale: 'en-US', timeZone: 'UTC' });
    expect(norm(en.percent(5 / 29))).toBe('17.2%');
    expect(norm(en.percent(0.25))).toBe('25%');
    expect(norm(en.percent(1))).toBe('100%');
    expect(norm(en.percent(0))).toBe('0%');
    const de = createFormatters(spec({}), { locale: 'de-DE', timeZone: 'UTC' });
    expect(norm(de.percent(5 / 29))).toBe('17,2 %');
  });

  it('rounds the share as the decimal it is: 0.1235 is 12.4%, 1/3 is 33.3%', () => {
    const f = createFormatters(spec({}), { locale: 'en-US', timeZone: 'UTC' });
    expect(norm(f.percent(0.1235))).toBe('12.4%');
    expect(norm(f.percent(1 / 3))).toBe('33.3%');
  });

  it('a ratio-scaled value keeps the readout digits of F6', () => {
    const f = createFormatters(spec({}), { locale: 'en-US', timeZone: 'UTC' });
    expect(norm(f.value(1, 5 / 29))).toBe('17.241379%');
  });
});
