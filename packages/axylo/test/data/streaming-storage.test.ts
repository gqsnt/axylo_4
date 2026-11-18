import fc from 'fast-check';
import { expect, it } from 'vitest';
import { SLOT_VALUE, type Frame } from '../../src/core/contracts';
import { AlignedStore, DonutStore, PointStore, normalize, resolveOptions } from '../../src/data';
import { utc, version } from './helpers';

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

async function expectCollected(...refs: WeakRef<object>[]) {
  const collect = globalThis.gc;
  if (!collect) return;
  for (let attempt = 0; attempt < 5; attempt++) {
    // WeakRef keeps a dereferenced value alive only until the end of the job.
    await new Promise<void>(resolve => setImmediate(resolve));
    collect();
    if (refs.every(ref => ref.deref() === undefined)) return;
  }
  expect(refs.map(ref => ref.deref() === undefined)).toEqual(refs.map(() => true));
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

type Entry = { index: number; row: ReturnType<typeof row> };
type Snapshot = { frame: Frame; rows: readonly Entry[]; field: 'y' | 'z'; next: number };

function checkFrame({ frame, rows, field, next }: Snapshot, live: boolean) {
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
    expect([...frame.series[0]!.x]).toEqual(xs);
    expect([...frame.series[0]!.y]).toEqual(values);
    expect([...frame.series[0]!.row!]).toEqual(indexes);
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
  fc.record({ operation: fc.constant('reencode' as const), field: fc.constantFrom('y' as const, 'z' as const) }),
  fc.record({ operation: fc.constant('retire' as const), back: count }),
), { minLength: 1, maxLength: 35 });

for (const kind of types) {
  it(`${kind} matches a row model across live revisions and bounds append allocations`, () => {
    fc.assert(fc.property(operations, ops => {
      const s = store(kind, []);
      let field: Snapshot['field'] = 'y';
      let rows: Entry[] = [];
      let next = 0;
      let x = 0;
      let retired = s.frame.revision - 1;
      let appendBytes = 0;
      let rowsAdded = 0;
      let seededRows = 0;
      let appends = 0;
      const snapshots: Snapshot[] = [{ frame: s.frame, rows, field, next }];
      for (const op of ops) {
        const before = s.frame;
        const revised = { revision: before.revision + 1, epoch: before.epoch + 1 };
        if (op.operation === 'append') {
          const incoming = Array.from({ length: op.count }, () => row(x++));
          rows = [...rows, ...incoming.map(item => ({ index: next++, row: item }))];
          if (op.keep !== undefined) rows = rows.slice(Math.max(0, rows.length - op.keep));
          const { result: prepared, bytes } = allocated(() => s.prepareAppend(incoming, { keep: op.keep }));
          appendBytes += bytes;
          rowsAdded += incoming.length;
          appends++;
          expect(s.frame).toBe(before);
          checkFrame({ frame: prepared.frame, rows, field, next }, true);
          prepared.commit();
        } else if (op.operation === 'replace') {
          x = op.start;
          next = 0;
          const data = Array.from({ length: op.count }, () => row(x++));
          rows = data.map(item => ({ index: next++, row: item }));
          seededRows += rows.length;
          s.prepareReplace(data, options(kind, data, field), revised).commit();
        } else if (op.operation === 'reencode') {
          field = op.field;
          seededRows += rows.length;
          s.prepareReencode(options(kind, rows.map(entry => entry.row), field), revised).commit();
        } else {
          retired = Math.max(retired, before.revision - op.back);
          s.retire(retired);
        }
        if (s.frame !== before) snapshots.push({ frame: s.frame, rows, field, next });
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

for (const kind of types) {
  it(`${kind} keeps competing previews and captured views independent`, () => {
    const data = [row(0), row(1)];
    const s = store(kind, data);
    const before = s.frame;
    const accepted = s.prepareAppend([row(2)], { keep: 2 });
    const rejected = s.prepareAppend([row(3)], { keep: 1 });
    expect(rejected.frame.source.rowAt(2)).toEqual(row(3));
    checkFrame({ frame: before, rows: data.map((row, index) => ({ row, index })), field: 'y', next: 2 }, true);
    accepted.commit();
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
