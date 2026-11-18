import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SLOT_VALUE, type Frame } from '../../src/core/contracts';
import { AlignedStore, DonutStore, PointStore, normalize, resolveOptions } from '../../src/data';
import { contents, utc, version } from './helpers';

const quiet = { add() {} };
const types = ['line', 'scatter', 'donut'] as const;
type Kind = typeof types[number];
function options(kind: Kind, data: unknown, y = 'y') {
  return resolveOptions(kind, kind === 'donut' ? { data, label: 'label', value: y } :
    { data, x: { field: 'x', type: 'number' }, y }, quiet);
}
function store(kind: Kind, data: unknown) {
  const resolved = options(kind, data);
  if (kind === 'scatter') return new PointStore(resolved, utc, version);
  if (kind === 'donut') return new DonutStore(resolved, utc, version);
  return AlignedStore.fromFrame(normalize('line', resolved, utc, quiet, version), resolved, data, utc);
}
function numericBuffers(frame: Frame): readonly ArrayBufferLike[] {
  if (frame.shape === 'aligned') return [frame.x.values.buffer, frame.series[0]!.y.buffer];
  if (frame.shape === 'points') return [frame.series[0]!.x.buffer, frame.series[0]!.y.buffer];
  return [frame.values.buffer];
}
function row(x: number) {
  return { x, label: String(x), y: x + 1, z: x + 2 };
}

function allocated<T>(action: () => T): { result: T; bytes: number } {
  let bytes = 0;
  const restore: (() => void)[] = [];
  for (const name of ['Float64Array', 'Float32Array', 'Int32Array', 'Uint8Array'] as const) {
    const original = globalThis[name];
    // Species-based operations such as slice must go through the counter too.
    const counted = new Proxy(original, {
      construct(target, args, newTarget) {
        const result = Reflect.construct(target, args, newTarget) as InstanceType<typeof original>;
        if (!(args[0] instanceof ArrayBuffer) && !(args[0] instanceof SharedArrayBuffer)) bytes += result.byteLength;
        return result;
      },
    });
    Object.defineProperty(globalThis, name, { value: counted });
    Object.defineProperty(original.prototype, 'constructor', { value: counted });
    restore.push(() => {
      Object.defineProperty(original.prototype, 'constructor', { value: original });
      Object.defineProperty(globalThis, name, { value: original });
    });
  }
  try {
    const result = action();
    return { result, bytes };
  } finally {
    restore.forEach(undo => undo());
  }
}

function requireCollection() {
  const collect = globalThis.gc;
  if (!collect) throw new Error('Forced collection requires the Vitest fork execArgv option --expose-gc.');
  return collect;
}

async function expectCollected(...refs: WeakRef<object>[]) {
  const collect = requireCollection();
  for (let attempt = 0; attempt < 5; attempt++) {
    // WeakRef keeps a dereferenced value alive only until the end of the job.
    await new Promise<void>(resolve => setImmediate(resolve));
    collect();
    if (refs.every(ref => ref.deref() === undefined)) return;
  }
  expect(refs.map(ref => ref.deref() === undefined)).toEqual(refs.map(() => true));
}

it('does not copy a large series window when several fills are committed between draws', () => {
  const size = 20_000;
  const keys = ['a', 'b', 'c', 'd'];
  const data = Array.from({ length: size }, (_, x) => keys.map(group => ({ x, y: x + 1, group }))).flat();
  const s = new AlignedStore('line', resolveOptions('line', { data, x: 'x', y: 'y', series: 'group' }, quiet), utc, version);
  for (const series of s.frame.series) expect(series.y.length).toBe(size);
  const { bytes } = allocated(() => {
    for (const [i, group] of keys.entries()) s.prepareAppend([{ x: size, y: i + 1, group }], { keep: size }).commit();
  });
  console.info(`shared-x prepare + commit: ${bytes} typed-array bytes per four-row tick`);
  expect(s.frame.series.map(series => series.y.at(-1))).toEqual([1, 2, 3, 4]);
  expect(bytes).toBeLessThanOrEqual(256 * keys.length);
});

it('bounds the retained typed-array backing after opening a million typed observations and appending', async () => {
  const size = 1_000_000;
  const data = { columns: { x: Float64Array.from({ length: size }, (_, i) => i), y: Float64Array.from({ length: size }, (_, i) => i / 3) } };
  const collect = requireCollection();
  async function arrayBuffers() {
    await new Promise<void>(resolve => setImmediate(resolve));
    collect();
    collect();
    return process.memoryUsage().arrayBuffers;
  }
  const baseline = await arrayBuffers();
  const s = store('line', data);
  s.prepareAppend([{ x: size, y: size / 3 }]).commit();
  const frame = s.frame;
  if (frame.shape !== 'aligned') throw new Error('Expected an aligned streaming frame.');
  const bytes = await arrayBuffers() - baseline;
  console.info(`million-point typed handoff: ${bytes} retained bytes beyond caller columns`);
  expect(frame.x.values.at(-1)).toBe(size);
  expect(frame.series[0]!.y.at(-1)).toBe(size / 3);
  expect(frame.series[0]!.y.at(-2)).toBe((size - 1) / 3);
  expect(frame.source.rowAt(size - 1)).toEqual({ x: size - 1, y: (size - 1) / 3 });
  // P7 permits one extra copy of the caller’s two columns (2 × 8 × 1,000,000).
  // A fully materialized post-append frame already needs 17 × 1,000,001 bytes for
  // exact x, exact y and slot states before counting any spare capacity or row indexes.
  expect(bytes).toBeLessThanOrEqual(data.columns.x.byteLength + data.columns.y.byteLength);
});

it('keeps typed-column rows implicit through in-order appends and gives exact rows once the window slides', () => {
  const size = 1_000;
  const data = { columns: { x: Float64Array.from({ length: size }, (_, i) => i), y: Float64Array.from({ length: size }, (_, i) => i / 3) } };
  const s = store('line', data);
  for (let i = 0; i < 3; i++) s.prepareAppend([{ x: size + i, y: i }]).commit();
  const frame = s.frame;
  if (frame.shape !== 'aligned') throw new Error('Expected an aligned frame.');
  // The contract's null row index means "slot i came from row i" (spec P7: no dense identity index).
  expect(frame.series[0]!.row).toBeNull();
  expect(frame.source.rowAt(size + 2)).toEqual({ x: size + 2, y: 2 });
  s.prepareAppend([{ x: size + 3, y: 3 }], { keep: 4 }).commit();
  const slid = s.frame;
  if (slid.shape !== 'aligned') throw new Error('Expected an aligned frame.');
  expect([...slid.x.values]).toEqual([size, size + 1, size + 2, size + 3]);
  expect([...slid.series[0]!.row!]).toEqual([size, size + 1, size + 2, size + 3]);
  for (let i = 0; i < 4; i++) expect(slid.source.rowAt(slid.series[0]!.row![i]!)).toEqual({ x: size + i, y: i });
});

it('reports owned bytes that match the retained buffers and leave out the caller\'s columns', async () => {
  const size = 200_000;
  const x = Float64Array.from({ length: size }, (_, i) => i);
  const y = Float64Array.from({ length: size }, (_, i) => i / 3);
  const collect = requireCollection();
  async function arrayBuffers() {
    await new Promise<void>(resolve => setImmediate(resolve));
    collect();
    collect();
    return process.memoryUsage().arrayBuffers;
  }
  const baseline = await arrayBuffers();
  for (const kind of types) {
    const data = { columns: { x, y, label: Array.from(x, String) } };
    const s = store(kind, data);
    s.prepareAppend([row(size)]).commit();
    const retained = await arrayBuffers() - baseline;
    const owned = s.ownedBytes();
    expect(owned.total).toBe(owned.buffers.reduce((sum, entry) => sum + entry.bytes, 0));
    expect(owned.buffers.every(entry => entry.bytes > 0 && entry.buffers > 0 && entry.name.length > 0)).toBe(true);
    // Everything the store keeps alive beyond the caller's columns is counted, and nothing else
    // (the caller's x and y are 3.2 MB, so counting them would miss by far more than the slack).
    expect(Math.abs(retained - owned.total)).toBeLessThan(64 * 1024);
    void s.frame;
  }
});

for (const kind of types) {
  it(`${kind} releases abandoned preview rows when their source first finds them dead`, async () => {
    function setup() {
      const s = store(kind, [row(0)]);
      const rejected = row(1);
      const ref = new WeakRef(rejected);
      const { frame } = s.prepareAppend([rejected]);
      expect(frame.source.rowAt(1)).toBe(rejected);
      s.prepareAppend([row(2)]).commit();
      expect(frame.source.rowAt(1)).toBeNull();
      return { s, frame, ref };
    }
    const { s, frame, ref } = setup();
    await expectCollected(ref);
    expect(frame.source.rowAt(1)).toBeNull();
    expect(s.frame.source.rowAt(1)).toEqual(row(2));
  });
}

for (const kind of types) {
  it(`${kind} shares numeric buffers during preparation and commit when there is spare capacity`, () => {
    const size = kind === 'donut' ? 500 : 50_000;
    const s = store(kind, Array.from({ length: size }, (_, i) => row(i)));
    const initial = numericBuffers(s.frame);
    const first = s.prepareAppend([row(size)]);
    const firstBuffers = numericBuffers(first.frame);
    first.commit();
    const before = s.frame;
    const original = numericBuffers(before);
    const measured = allocated(() => {
      const candidate = s.prepareAppend([row(size + 1)]);
      const during = numericBuffers(candidate.frame);
      expect(s.frame).toBe(before);
      candidate.commit();
      return during.filter((buffer, i) => original[i] !== buffer).length;
    });
    console.info(`${kind}: ${measured.result} replaced numeric buffers, ${measured.bytes} typed-array bytes per appended row`);
    expect(measured.result).toBe(0);
    firstBuffers.forEach((buffer, index) => expect(buffer).toBe(initial[index]));
    expect(measured.bytes).toBeLessThan(256);
  });

  it.each(['keep', 'replace'] as const)(`${kind} releases caller columns after %s and retirement`, async operation => {
    function setup() {
      const x = Float64Array.from({ length: 300 }, (_, i) => i);
      const y = Float64Array.from(x, i => i + 1);
      const label = Array.from(x, String);
      const refs = [new WeakRef(x), new WeakRef(y), new WeakRef(label)];
      const s = store(kind, { columns: { x, y, label } });
      const old = s.frame;
      if (operation === 'keep') s.prepareAppend([row(300)], { keep: 2 }).commit();
      else {
        const data = [row(300)];
        s.prepareReplace(data, options(kind, data), { revision: old.revision + 1, epoch: old.epoch + 1 }).commit();
      }
      expect(old.source.rowAt(0)).toEqual({ x: 0, y: 1, label: '0' });
      s.retire(old.revision);
      return { refs, s, old };
    }
    const { refs, s, old } = setup();
    await expectCollected(...refs);
    expect(old.source.rowAt(0)).toBeNull();
    expect(s.retainedRowCount).toBe(operation === 'keep' ? 2 : 1);
  });
}

for (const kind of types) {
  it(`${kind} releases an object in a partly retained column block`, async () => {
    function setup() {
      const payload = [{ note: 'dropped' }, { note: 'retained' }];
      const ref = new WeakRef(payload[0]!);
      const data = { columns: { x: Float64Array.of(0, 1), y: Float64Array.of(1, 2), label: ['0', '1'], payload } };
      const s = store(kind, data);
      const before = s.frame;
      s.prepareAppend([row(2)], { keep: 2 }).commit();
      expect(before.source.rowAt(0)).toMatchObject({ payload: payload[0] });
      expect(s.frame.source.rowAt(1)).toMatchObject({ payload: payload[1] });
      s.retire(before.revision);
      return { ref, s, before };
    }
    const { ref, s, before } = setup();
    await expectCollected(ref);
    expect(before.source.rowAt(0)).toBeNull();
    expect(s.frame.source.rowAt(0)).toBeNull();
    expect(s.frame.source.rowAt(1)).toMatchObject({ payload: { note: 'retained' } });
  });
}

it('releases the original backing buffer of a sliced Uint8Array subclass', async () => {
  function setup() {
    const bytes = Buffer.alloc(300, 2);
    const ref = new WeakRef(bytes.buffer);
    const data = { columns: { x: Float64Array.from(bytes, (_, i) => i), y: bytes } };
    const s = store('line', data);
    const old = s.frame;
    s.prepareAppend([row(300)], { keep: 2 }).commit();
    s.retire(old.revision);
    return { ref, s };
  }
  const { ref, s } = setup();
  await expectCollected(ref);
  expect(s.frame.source.rowAt(299)).toEqual({ x: 299, y: 2 });
});

type Entry = { index: number; row: Omit<ReturnType<typeof row>, 'y' | 'z'> & { y: number | null; z: number | null } };
type Snapshot = { frame: Frame; rows: readonly Entry[]; field: 'y' | 'z'; next: number; zero?: boolean };

function checkFrame({ frame, rows, field, next, zero = false }: Snapshot, live: boolean) {
  const indexes = rows.map(entry => entry.index);
  const xs = rows.map(entry => entry.row.x);
  const values = rows.map(entry => entry.row[field]);
  if (frame.shape === 'aligned') {
    expect(frame.length).toBe(rows.length);
    expect([...frame.x.values]).toEqual(xs);
    if (rows.length) {
      expect([...frame.series[0]!.y]).toEqual(values);
      expect([...frame.series[0]!.slot]).toEqual(values.map(() => SLOT_VALUE));
      expect([...frame.series[0]!.row!]).toEqual(indexes);
    }
  } else if (frame.shape === 'points') {
    const points = rows.filter(entry => zero || entry.row[field] !== null);
    const missing = zero ? [] : rows.filter(entry => entry.row[field] === null);
    expect([...frame.series[0]!.x]).toEqual(points.map(entry => entry.row.x));
    expect([...frame.series[0]!.y]).toEqual(points.map(entry => entry.row[field] ?? 0));
    // A null row index means "point i came from row i" (contract).
    expect([...frame.series[0]!.row ?? frame.series[0]!.x.keys()]).toEqual(points.map(entry => entry.index));
    expect([...(frame.series[0]!.missingX ?? [])]).toEqual(missing.map(entry => entry.row.x));
    // The contract: present whenever missingX and row are, one source row per entry of missingX.
    expect(frame.series[0]!.missingRow === undefined).toBe(frame.series[0]!.missingX === undefined);
    expect([...(frame.series[0]!.missingRow ?? [])]).toEqual(missing.map(entry => entry.index));
  } else {
    expect([...frame.labels]).toEqual(rows.map(entry => entry.row.label));
    expect([...frame.values]).toEqual(values);
    expect([...frame.slot]).toEqual(values.map(() => SLOT_VALUE));
    expect([...frame.row!]).toEqual(indexes);
  }

  let cursor = 0;
  for (let i = 0; i <= next; i++) {
    const entry = rows[cursor];
    expect(frame.source.rowAt(i)).toBe(live && entry?.index === i ? entry.row : null);
    if (entry?.index === i) cursor++;
  }
}

const count = fc.integer({ min: 0, max: 7 });
const operations = fc.array(fc.oneof(
  fc.record({ operation: fc.constant('append' as const), count, keep: fc.option(count, { nil: undefined }) }),
  fc.record({ operation: fc.constant('replace' as const), count, start: fc.integer({ min: -50, max: 50 }) }),
  fc.record({ operation: fc.constant('reencode' as const), field: fc.constantFrom('y' as const, 'z' as const), zero: fc.boolean() }),
  fc.record({ operation: fc.constant('retire' as const), back: count }),
), { minLength: 1, maxLength: 35 });

for (const kind of types) {
  it(`${kind} matches a row model across live revisions and bounds append allocations`, () => {
    fc.assert(fc.property(operations, ops => {
      const s = store(kind, []);
      let field: Snapshot['field'] = 'y';
      let zero = false;
      let rows: Entry[] = [];
      let next = 0;
      let x = 0;
      let retired = s.frame.revision - 1;
      let appendBytes = 0;
      let rowsAdded = 0;
      let seededRows = 0;
      let appends = 0;
      const snapshots: Snapshot[] = [{ frame: s.frame, rows, field, next, zero }];
      const observation = (x: number): Entry['row'] => {
        const item = row(x);
        return kind === 'scatter' ? { ...item, y: x % 3 === 0 ? null : item.y, z: x % 5 === 0 ? null : item.z } : item;
      };
      const encoding = (data: unknown) => zero ? resolveOptions('scatter', {
        data, x: { field: 'x', type: 'number' }, y: { field, missing: 'zero' },
      }, quiet) : options(kind, data, field);
      for (const op of ops) {
        const before = s.frame;
        const revised = { revision: before.revision + 1, epoch: before.epoch + 1 };
        if (op.operation === 'append') {
          const incoming = Array.from({ length: op.count }, () => observation(x++));
          rows = [...rows, ...incoming.map(item => ({ index: next++, row: item }))];
          if (op.keep !== undefined) rows = rows.slice(Math.max(0, rows.length - op.keep));
          const { result: prepared, bytes } = allocated(() => s.prepareAppend(incoming, { keep: op.keep }));
          appendBytes += bytes;
          rowsAdded += incoming.length;
          appends++;
          expect(s.frame).toBe(before);
          checkFrame({ frame: prepared.frame, rows, field, next, zero }, true);
          prepared.commit();
        } else if (op.operation === 'replace') {
          x = op.start;
          next = 0;
          const data = Array.from({ length: op.count }, () => observation(x++));
          rows = data.map(item => ({ index: next++, row: item }));
          seededRows += rows.length;
          s.prepareReplace(data, encoding(data), revised).commit();
        } else if (op.operation === 'reencode') {
          field = op.field;
          zero = kind === 'scatter' && op.zero;
          seededRows += rows.length;
          s.prepareReencode(encoding(rows.map(entry => entry.row)), revised).commit();
        } else {
          retired = Math.max(retired, before.revision - op.back);
          s.retire(retired);
        }
        if (s.frame !== before) snapshots.push({ frame: s.frame, rows, field, next, zero });
        const retained = new Set(rows.map(entry => entry.row));
        for (const snapshot of snapshots) {
          const live = snapshot.frame.revision > retired;
          checkFrame(snapshot, live);
          if (live) for (const entry of snapshot.rows) retained.add(entry.row);
        }
        expect(s.retainedRowCount).toBe(retained.size);
      }

      // Each append has fixed scratch space and per-row scratch columns. A doubling
      // or a compaction pays for itself across the rows inserted, evicted, or seeded.
      expect(appendBytes).toBeLessThanOrEqual(2_048 * appends + 384 * (rowsAdded + seededRows));
    }), { numRuns: 1_000 });
  });

  it(`${kind} uses offset views while sliding a fixed window and bounds long-run allocations`, () => {
    const size = 600;
    const s = store(kind, Array.from({ length: size }, (_, i) => row(i)));
    const first = s.frame;
    const a = s.prepareAppend([row(size)], { keep: size });
    numericBuffers(a.frame).forEach((buffer, i) => expect(buffer).toBe(numericBuffers(first)[i]));
    a.commit();
    s.retire(first.revision);
    const updates = 2_000;
    const { bytes } = allocated(() => {
      for (let i = 1; i <= updates; i++) {
        const previous = s.frame;
        s.prepareAppend([row(size + i)], { keep: size }).commit();
        s.retire(previous.revision);
      }
    });
    expect(s.retainedRowCount).toBe(size);
    expect(bytes).toBeLessThan(256 * updates);
  });
}

function frameValues(frame: Frame): unknown {
  if (frame.shape === 'aligned') {
    const values = contents(frame);
    return { ...values, x: { ...values.x, categories: frame.x.categories && [...frame.x.categories] } };
  }
  if (frame.shape === 'donut') return {
    labels: [...frame.labels], values: [...frame.values], slot: [...frame.slot], row: [...frame.row ?? []],
  };
  return frame.series.map(({ x, y, row, missingX, missingRow, ...description }) => ({
    ...description, x: [...x], y: [...y], row: [...row ?? []], missingX: [...missingX ?? []], missingRow: [...missingRow ?? []],
  }));
}

const generatedRows = fc.array(fc.record({
  delta: fc.integer({ min: -2, max: 3 }),
  group: fc.constantFrom('a', 'b', 'c'),
  y: fc.oneof(fc.constant(null), fc.nat(100)),
}), { minLength: 1, maxLength: 4 });
const previewOps = fc.array(fc.record({
  rows: generatedRows, rival: generatedRows,
  mode: fc.constantFrom('plain', 'prepare', 'abandon', 'first-wins', 'second-wins'),
  keep: fc.option(fc.nat(12), { nil: undefined }),
  eager: fc.boolean(), retire: fc.option(fc.nat(4), { nil: undefined }),
}), { minLength: 1, maxLength: 26 });

for (const kind of ['line', 'category', 'scatter', 'donut'] as const) {
  it(`${kind} agrees with eagerly read snapshots across mixed preview and append sequences`, () => {
    fc.assert(fc.property(previewOps, ops => {
      const data = [{ ...row(0), group: 'a' }, { ...row(0), group: 'b' }, { ...row(1), group: 'a' }]
        .map(item => ({ ...item, x: kind === 'category' ? item.label : item.x }));
      function open() {
        if (kind === 'donut') return store(kind, [data[0]!, data[2]!]);
        const chartType = kind === 'category' ? 'line' : kind;
        const options = resolveOptions(chartType, {
          data, x: { field: 'x', type: kind === 'category' ? 'category' : 'number' }, y: 'y', series: 'group',
        }, quiet);
        return kind === 'scatter' ? new PointStore(options, utc, version) : new AlignedStore('line', options, utc, version);
      }
      const lazy = open();
      const eager = open();
      const frames: { frame: Frame; values: unknown; rows: unknown[]; preview: boolean }[] = [
        { frame: lazy.frame, values: frameValues(eager.frame), rows: data.map((_, i) => eager.frame.source.rowAt(i)), preview: false },
      ];
      let retired = version.revision - 1;
      let next = kind === 'donut' ? 2 : 3;
      let high = 1;
      for (const op of ops) {
        const encode = (rows: typeof op.rows) => rows.map(({ delta, group, y }) => {
          const x = high + delta;
          return { x: kind === 'category' ? String(x) : x, label: String(x), group, y };
        });
        let accepted = encode(op.rows);
        const rival = encode(op.rival);
        const remember = (frame: Frame, oracle: Frame, end: number, preview: boolean) => {
          const values = frameValues(oracle);
          const rows = Array.from({ length: end }, (_, i) => oracle.source.rowAt(i));
          if (op.eager) expect(frameValues(frame)).toEqual(values);
          frames.push({ frame, values, rows, preview });
        };
        const prepare = (rows: typeof accepted, preview: boolean) => {
          const a = lazy.prepareAppend(rows, { keep: op.keep });
          const b = eager.prepareAppend(rows, { keep: op.keep });
          remember(a.frame, b.frame, next + rows.length, preview);
          expect(a.diagnostics).toEqual(b.diagnostics);
          return [a, b] as const;
        };
        if (op.mode === 'plain') {
          const a = lazy.append(accepted);
          const b = eager.append(accepted);
          remember(a, b, next + accepted.length, false);
        } else if (op.mode === 'abandon') {
          prepare(rival, true);
          const a = lazy.append(accepted);
          const b = eager.append(accepted);
          remember(a, b, next + accepted.length, false);
        } else {
          const a = prepare(accepted, op.mode === 'second-wins');
          const b = op.mode === 'prepare' ? null : prepare(rival, op.mode === 'first-wins');
          const winner = op.mode === 'second-wins' ? b! : a;
          if (winner === b) accepted = rival;
          for (const draft of winner) draft.commit();
        }
        next += accepted.length;
        for (const item of accepted) high = Math.max(high, Number(item.x));
        if (op.retire !== undefined) {
          retired = Math.max(retired, lazy.frame.revision - op.retire - 1);
          lazy.retire(retired);
          eager.retire(retired);
        }
        expect(lazy.diagnostics).toEqual(eager.diagnostics);
        expect(lazy.retainedRowCount).toBe(eager.retainedRowCount);
      }
      for (const { frame, values, rows, preview } of frames) {
        expect(frameValues(frame)).toEqual(values);
        for (const [i, source] of rows.entries()) {
          expect(frame.source.rowAt(i)).toBe(preview || frame.revision <= retired ? null : source);
        }
      }
    }), { numRuns: 400 });
  });
}

it('keeps a competing extension independent of a draft that claimed an unread shared-x slot', () => {
  const data = [{ x: 0, y: 1, group: 'a' }, { x: 0, y: 2, group: 'b' }, { x: 1, y: 3, group: 'a' }];
  const s = new AlignedStore('line', resolveOptions('line', { data, x: 'x', y: 'y', series: 'group' }, quiet), utc, version);
  const base = s.frame;
  const fill = s.prepareAppend([{ x: 1, y: 4, group: 'b' }]);
  const extend = s.prepareAppend([{ x: 2, y: 5, group: 'a' }]);
  extend.commit();
  expect([...base.series[1]!.y]).toEqual([2, NaN]);
  expect([...s.frame.series[1]!.y]).toEqual([2, NaN, NaN]);
  expect([...fill.frame.series[1]!.y]).toEqual([2, 4]);
  expect([...s.frame.series[1]!.row!]).toEqual([1, -1, -1]);
});

for (const kind of types) {
  it(`${kind} compacts a large window after dropping almost all its rows`, () => {
    const size = 10_000;
    const keep = 37;
    const s = store(kind, Array.from({ length: size }, (_, i) => row(i)));
    const old = s.frame;
    s.prepareAppend([row(size)], { keep }).commit();
    s.retire(old.revision);
    expect(s.retainedRowCount).toBe(keep);
    for (const buffer of numericBuffers(s.frame)) {
      expect(buffer.byteLength).toBeLessThanOrEqual(2 * keep * Float64Array.BYTES_PER_ELEMENT);
    }
  });
}

it('shares scatter missing positions through append and offset keep, then retires the evicted rows', async () => {
  function setup() {
    const dropped = { x: 1, y: null };
    const ref = new WeakRef(dropped);
    const data = [dropped, { x: 2, y: 4 }, { x: 3, y: null }];
    const s = new PointStore(options('scatter', data), utc, version);
    const old = s.frame;
    const missing = old.series[0]!.missingX!;
    expect(missing).toEqual(Float64Array.of(1, 3));
    const accepted = s.prepareAppend([{ x: 3, y: null }, { x: 4, y: null }], { keep: 3 });
    const current = accepted.frame.series[0]!.missingX!;
    expect(current).toEqual(Float64Array.of(3, 3, 4));
    expect(current.buffer).toBe(missing.buffer);
    expect(current.byteOffset).toBe(missing.byteOffset + Float64Array.BYTES_PER_ELEMENT);
    expect(old.series[0]!.missingRow).toEqual(Int32Array.of(0, 2));
    expect(accepted.frame.series[0]!.missingRow).toEqual(Int32Array.of(2, 3, 4));
    expect(accepted.frame.series[0]!.missingRow!.buffer).toBe(old.series[0]!.missingRow!.buffer);
    const competing = s.prepareAppend([{ x: 5, y: null }], { keep: 3 });
    expect(competing.frame.series[0]!.missingX).toEqual(Float64Array.of(3, 5));
    expect(competing.frame.series[0]!.missingRow).toEqual(Int32Array.of(2, 3));
    accepted.commit();
    expect(() => competing.commit()).toThrow('Cannot commit a superseded data revision.');
    expect(current).toEqual(Float64Array.of(3, 3, 4));
    expect(accepted.frame.series[0]!.missingRow).toEqual(Int32Array.of(2, 3, 4));
    expect(old.source.rowAt(0)).toBe(dropped);
    s.retire(old.revision);
    expect(old.source.rowAt(0)).toBeNull();
    expect(missing).toEqual(Float64Array.of(1, 3));
    expect(s.retainedRowCount).toBe(4);
    return { s, ref };
  }
  const { s, ref } = setup();
  await expectCollected(ref);
  expect(s.frame.series[0]!.missingX).toEqual(Float64Array.of(3, 3, 4));
});

it('rebuilds scatter missing positions for absent fields, re-encoding, and replacement', () => {
  const s = new PointStore(options('scatter', [{ x: 1, y: 2 }, { x: 3, y: null }]), utc, version);
  const missing = { x: 2 };
  const next = s.append([missing, { x: 4, y: 5 }], { keep: 3 });
  expect(next.series[0]!.missingX).toEqual(Float64Array.of(2, 3));
  expect(s.diagnostics).toMatchObject([
    { code: 'AX102', effect: 'omitted', rows: [2], count: 1 }, { code: 'AX151', rows: [2], count: 1 },
  ]);
  const encoding = s.resolveEncoding({ x: 'x', y: { field: 'y', missing: 'zero' } }, quiet);
  const zeros = s.reencode(encoding, { epoch: version.epoch + 1, revision: next.revision + 1 });
  expect(zeros.series[0]!.x).toEqual(Float64Array.of(2, 3, 4));
  expect(zeros.series[0]!.y).toEqual(Float64Array.of(0, 0, 5));
  expect(zeros.series[0]!.row).toEqual(Int32Array.of(2, 1, 3));
  expect(zeros.source.rowAt(zeros.series[0]!.row![0]!)).toBe(missing);
  expect(zeros.series[0]!.missingX?.length ?? 0).toBe(0);
  expect(s.diagnostics).toMatchObject([{ code: 'AX102', effect: 'changed', rows: [2], count: 1 }]);
  const replacement = [{ x: 10, y: null }, { x: 9, y: 1 }, { x: 11 }];
  const final = s.replace(replacement, options('scatter', replacement), { epoch: zeros.epoch + 1, revision: zeros.revision + 1 });
  expect(final.series[0]!.missingX).toEqual(Float64Array.of(10, 11));
  s.retire(zeros.revision);
  expect(zeros.source.rowAt(2)).toBeNull();
  expect(next.series[0]!.missingX).toEqual(Float64Array.of(2, 3));
  expect(s.retainedRowCount).toBe(3);
});

for (const kind of types) {
  it(`${kind} keeps competing previews and captured views independent`, () => {
    const data = [row(0), row(1)];
    const s = store(kind, data);
    const before = s.frame;
    const appended = row(2);
    const accepted = s.prepareAppend([appended], { keep: 2 });
    const rejected = s.prepareAppend([row(3)], { keep: 1 });
    expect(rejected.frame.source.rowAt(2)).toEqual(row(3));
    checkFrame({ frame: before, rows: data.map((row, index) => ({ row, index })), field: 'y', next: 2 }, true);
    accepted.commit();
    checkFrame({ frame: s.frame, rows: [{ row: data[1]!, index: 1 }, { row: appended, index: 2 }], field: 'y', next: 3 }, true);
    expect(() => rejected.commit()).toThrow('Cannot commit a superseded data revision.');
    expect(rejected.frame.source.rowAt(2)).toBeNull();
    const values = rejected.frame.shape === 'aligned' ? rejected.frame.series[0]!.y :
      rejected.frame.shape === 'points' ? rejected.frame.series[0]!.y : rejected.frame.values;
    expect([...values]).toEqual([4]);
    expect(s.frame.source.rowAt(2)).toEqual(row(2));
  });
}

it('preserves a captured series view when a later row fills its shared-x slot', () => {
  const data = [{ x: 0, y: 2, group: 'a' }, { x: 0, y: 3, group: 'b' }, { x: 1, y: 4, group: 'a' }];
  const encoded = resolveOptions('line', { data, x: 'x', y: 'y', series: 'group' }, quiet);
  const s = new AlignedStore('line', encoded, utc, version);
  const before = s.frame;
  const values = before.series[1]!.y;
  const observation = { x: 1, y: 5, group: 'b' };
  const candidate = s.prepareAppend([observation]);
  expect([...candidate.frame.series[1]!.y]).toEqual([3, 5]);
  expect([...values]).toEqual([3, NaN]);
  candidate.commit();
  expect([...values]).toEqual([3, NaN]);
  expect(before.source.rowAt(3)).toBeNull();
  expect(s.frame.source.rowAt(3)).toBe(observation);
});

it('shares ordered time-point storage and revalidates a daily cadence exposed by keep', () => {
  const day = 86_400_000;
  const firstDay = Date.UTC(2026, 0, 1);
  const data = [row(firstDay - 3_600_000), row(firstDay), row(firstDay + day)];
  const resolved = resolveOptions('scatter', { data, x: { field: 'x', type: 'time' }, y: 'y' }, quiet);
  const s = new PointStore(resolved, utc, version);
  const first = s.frame;
  const prepared = s.prepareAppend([row(firstDay + 2 * day)]);
  numericBuffers(prepared.frame).forEach((buffer, i) => expect(buffer).toBe(numericBuffers(first)[i]));
  expect(prepared.diagnostics).toEqual([]);
  prepared.commit();
  const daily = s.prepareAppend([row(firstDay + 3 * day)], { keep: 3 });
  expect(daily.diagnostics).toMatchObject([{ code: 'AX111', count: 3, rows: [2, 3, 4] }]);
  daily.commit();
  expect([...s.frame.series[0]!.x]).toEqual([firstDay + day, firstDay + 2 * day, firstDay + 3 * day]);
  expect([...first.series[0]!.x]).toEqual(data.map(item => item.x));
});

it('keeps AX103 and AX106 positions in the scatter table column through append and eviction', () => {
  const s = new PointStore(options('scatter', [{ x: 1, y: 4 }, { x: 2, y: null }]), utc, version);
  const first = s.append([{ x: 3, y: Infinity }, { x: 4, y: 'bad' }, { x: 5, y: 5 }]);
  expect(first.series[0]!.x).toEqual(Float64Array.of(1, 5));
  expect(first.series[0]!.missingX).toEqual(Float64Array.of(2, 3, 4));
  expect(s.diagnostics).toMatchObject([
    { code: 'AX103', effect: 'omitted', rows: [2], count: 1 },
    { code: 'AX106', effect: 'omitted', rows: [3], count: 1 },
  ]);
  const last = s.append([{ x: 6, y: 6 }], { keep: 3 });
  expect(last.series[0]!.missingX).toEqual(Float64Array.of(4));
  expect(last.series[0]!.x).toEqual(Float64Array.of(5, 6));
  expect(s.diagnostics).toMatchObject([{ code: 'AX106', effect: 'omitted', rows: [3], count: 1 }]);
  expect(first.series[0]!.missingX).toEqual(Float64Array.of(2, 3, 4));
});

it('re-encodes a scatter row whose y was missing from the retained rows, as a point when the new field has a value', () => {
  // Final controller review, finding 6: { x: 1, y: null, z: 11 } must survive a change of y to z.
  const data = [{ x: 0, y: 5, z: 10 }, { x: 1, y: null, z: 11 }, { x: 2, y: 7, z: null }];
  const s = new PointStore(options('scatter', data), utc, version);
  s.prepareAppend([{ x: 3, y: null, z: 13 }], { keep: 3 }).commit();
  const before = s.frame.series[0]!;
  expect([...before.x]).toEqual([2]);
  expect([...before.missingX!]).toEqual([1, 3]);
  expect([...before.missingRow!]).toEqual([1, 3]);
  // What the rows behind the missing observations are, through the frame's own source.
  expect([...before.missingRow!].map(row => s.frame.source.rowAt(row))).toEqual([data[1], { x: 3, y: null, z: 13 }]);

  const encoding = s.resolveEncoding({ x: { field: 'x', type: 'number' }, y: 'z' }, quiet);
  const reencoded = s.prepareReencode(encoding, { revision: s.frame.revision + 1, epoch: s.frame.epoch + 1 });
  reencoded.commit();
  const after = s.frame.series[0]!;
  expect([...after.x]).toEqual([1, 3]);
  expect([...after.y]).toEqual([11, 13]);
  expect([...after.row!]).toEqual([1, 3]);
  expect([...after.missingX!]).toEqual([2]);
  expect([...after.missingRow!]).toEqual([2]);
  expect(s.frame.source.rowAt(1)).toBe(data[1]);
});

describe('owned bytes stay near what the contract needs for each retained window', () => {
  const size = 200_000;
  // A retained slot or point the frame hands out needs, under the contract: exact x and y (8 + 8 bytes); an
  // aligned slot state (1); a row index (4) once the window has slid, since slot i no longer came from row i.
  // The caller's row behind it is kept for events and the table once the caller's columns are released: its
  // x and y (8 + 8). Buffers may keep one eighth spare (plus 16 slots), as the stores allocate.
  const spare = (n: number) => n + Math.max(16, Math.ceil(n / 8));
  const columns = () => ({ columns: { x: Float64Array.from({ length: size }, (_, i) => i), y: Float64Array.from({ length: size }, (_, i) => i / 3) } });
  const xCopies = (owned: ReturnType<AlignedStore['ownedBytes']>) =>
    owned.buffers.filter(entry => /x history|x positions/.test(entry.name)).reduce((sum, entry) => sum + entry.bytes, 0);

  it.each([80_000, 150_000])('a line that keeps %i of its first rows holds one copy of x and lets the caller\'s columns go', async keep => {
    function setup() {
      const data = columns();
      const refs = [new WeakRef(data.columns.x), new WeakRef(data.columns.y)];
      const s = store('line', data) as AlignedStore;
      const old = s.frame.revision;
      s.prepareAppend([row(size)], { keep }).commit();
      s.retire(old);
      return { s, refs };
    }
    const { s, refs } = setup();
    await expectCollected(...refs);
    const owned = s.ownedBytes();
    const frame = s.frame;
    if (frame.shape !== 'aligned') throw new Error('Expected an aligned frame.');
    expect(frame.length).toBe(keep);
    expect(frame.source.rowAt(size)).toEqual(row(size));
    // History and the eviction seed read x from the window's own buffer.
    expect(xCopies(owned)).toBeLessThanOrEqual(1_024);
    expect(owned.total).toBeLessThanOrEqual(spare(keep) * (8 + 8 + 1 + 4) + keep * (8 + 8) + 64 * 1_024);
  });

  it('a scatter store over typed columns keeps no position or row index that repeats its points', () => {
    const s = store('scatter', columns()) as PointStore;
    s.prepareAppend([{ x: size, y: 1 }]).commit();
    const owned = s.ownedBytes();
    expect(owned.buffers.map(entry => entry.name).filter(name => /^(x positions|row)$/.test(name))).toEqual([]);
    expect(s.frame.shape === 'points' && s.frame.series[0]!.row).toBeNull();
    // Exact x and y of every point, with the stores' opening tail (at most 4,096 slots).
    expect(owned.total).toBeLessThanOrEqual((size + 1 + 4_096 + 16) * (8 + 8) + 1_024);
  });

  it('a scatter store that keeps part of its points holds x and y, the row index, and the kept rows', () => {
    const keep = 80_000;
    const s = store('scatter', columns()) as PointStore;
    const old = s.frame.revision;
    s.prepareAppend([{ x: size, y: 1 }], { keep }).commit();
    // Rows evicted while an earlier frame still showed them are kept for it until it retires.
    expect(s.ownedBytes().buffers.some(entry => entry.name === 'rows kept for earlier frames')).toBe(true);
    s.retire(old);
    const frame = s.frame;
    if (frame.shape !== 'points') throw new Error('Expected a point frame.');
    expect(frame.series[0]!.x.length).toBe(keep);
    expect(frame.series[0]!.row![0]).toBe(size + 1 - keep);
    expect(frame.source.rowAt(frame.series[0]!.row![0]!)).toEqual({ x: size + 1 - keep, y: (size + 1 - keep) / 3 });
    expect(s.ownedBytes().total).toBeLessThanOrEqual(spare(keep) * (8 + 8 + 4) + keep * (8 + 8) + 64 * 1_024);
  });
});
