import { describe, expect, it } from 'vitest';
import { SLOT_NULL, SLOT_VALUE, type AlignedFrame } from '../../src/core/contracts';
import { AlignedStore, normalize, resolveOptions } from '../../src/data';
import { ByteCount, CallerBuffers } from '../../src/data/store-bytes';
import { seriesSlots } from '../../src/data/store-statistics';
import { utc, version } from './helpers';

const quiet = { add() {} };
const N = 100_000;

function continuous(length: number) {
  const x = new Float64Array(length), y = new Float64Array(length);
  for (let i = 0; i < length; i++) { x[i] = i; y[i] = Math.sin(i / 100); }
  return { columns: { x, y } };
}

function lineFrame(data: ReturnType<typeof continuous>) {
  const resolved = resolveOptions('line', { data, x: { field: 'x', type: 'number' }, y: 'y' }, quiet);
  return { resolved, frame: normalize('line', resolved, utc, quiet, version) as AlignedFrame };
}

function lineStore(data: ReturnType<typeof continuous>) {
  const { resolved, frame } = lineFrame(data);
  return AlignedStore.fromFrame(frame, resolved, data, utc);
}

// Spec P7: an opened store owns exact x and exact y at its capacity (the length and spare slots up to 4,096),
// 16 bytes a slot; the state byte is the one it can do without while every slot is SLOT_VALUE.
const exactColumns = (length: number) => 16 * (length + Math.max(16, Math.min(Math.ceil(length / 8), 4096)));

const slotBytes = (store: AlignedStore) => store.ownedBytes().buffers
  .filter(entry => entry.name.includes('slot')).reduce((sum, entry) => sum + entry.bytes, 0);

describe('dense slot columns (every slot SLOT_VALUE)', () => {
  it('a 1,000,000-point typed-column line frame owns nothing beyond the caller\'s columns', () => {
    const { frame } = lineFrame(continuous(1_000_000));
    expect(seriesSlots(frame.series[0]!)).toBeNull();
    const count = new ByteCount(new CallerBuffers());
    count.frame(frame);
    expect(count.result().total).toBe(0);
  });

  it('a 100,000-point typed-column line store owns no state column', () => {
    const store = lineStore(continuous(N));
    const frame = store.frame as AlignedFrame;
    expect(seriesSlots(frame.series[0]!)).toBeNull();
    expect(slotBytes(store)).toBe(0);
    expect(store.ownedBytes().total).toBe(exactColumns(N));
  });

  it('continuous appends keep no state column; a null row materializes one with exact gap states', () => {
    const store = lineStore(continuous(N));
    store.prepareAppend([{ x: N, y: 1 }]).commit();
    expect(slotBytes(store)).toBe(0);
    expect(seriesSlots((store.frame as AlignedFrame).series[0]!)).toBeNull();
    store.prepareAppend([{ x: N + 1, y: null }, { x: N + 2, y: 2 }]).commit();
    const frame = store.frame as AlignedFrame;
    const slot = frame.series[0]!.slot;
    expect(slot.length).toBe(N + 3);
    expect(slot[N]).toBe(SLOT_VALUE);
    expect(slot[N + 1]).toBe(SLOT_NULL);
    expect(slot[N + 2]).toBe(SLOT_VALUE);
    expect(Number.isNaN(frame.series[0]!.y[N + 1])).toBe(true);
    expect(frame.series[0]!.y[N + 2]).toBe(2);
    for (let i = 0; i < N; i++) if (slot[i] !== SLOT_VALUE) throw new Error(`slot ${i} is ${slot[i]}`);
  });

  it('reading series.slot directly still gives an all-SLOT_VALUE column of the series length', () => {
    const store = lineStore(continuous(10_000));
    const series = (store.frame as AlignedFrame).series[0]!;
    const slot = series.slot;
    expect(slot).toBeInstanceOf(Uint8Array);
    expect(slot.length).toBe(10_000);
    expect(slot.every(state => state === SLOT_VALUE)).toBe(true);
    expect(series.slot).toBe(slot);
    expect(seriesSlots(series)).toBe(slot);
  });

  it('keeps counting a materialized shared state column after a subsequent dense append', () => {
    const store = lineStore(continuous(4_096));
    // Open storage with one dense append, read .slot to materialize the shared state column, then append again.
    store.prepareAppend([{ x: 4_096, y: 4_096 }]).commit();
    const before = store.ownedBytes().total;
    const firstSlot = (store.frame as AlignedFrame).series[0]!.slot;
    expect(firstSlot.length).toBe(4_097);
    const afterRead = store.ownedBytes().total;
    expect(afterRead).toBeGreaterThan(before);
    store.prepareAppend([{ x: 4_097, y: 4_097 }]).commit();
    const afterSecondAppend = store.ownedBytes().total;
    expect(afterSecondAppend).toBeGreaterThanOrEqual(afterRead);
  });
});

describe('drawing a dense line (spec P7, 1,000,000 points)', () => {
  it('renders without making a state column', async () => {
    const { record } = await import('../core/host');
    const { columns } = continuous(1_000_000);
    const r = record('line', { title: 'T', data: { columns }, x: { field: 'x', type: 'number' }, y: 'y' });
    r.frames();
    expect(r.draws.length).toBeGreaterThan(0);
    const bench = (r.controller.handle as unknown as { __bench: { memory(): { bytes: number } } }).__bench;
    // A state column would be one byte per point; the caller's x and y are borrowed.
    expect(bench.memory().bytes).toBeLessThan(1_000_000);
  });
});
