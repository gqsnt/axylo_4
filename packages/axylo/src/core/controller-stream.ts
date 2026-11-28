import type { Frame } from './contracts';
import type { Composition, Store } from './composition';
import type { Accepted, StreamSessionHandle } from './controller-types';
import type { DataEnvironment } from '../data';
import { withoutTable, type ChartType, type ResolvedOptions } from '../data/options';
import { rowsTable, type Table } from '../data/table';
import { isTable } from './controller-helpers';

/** Rows a store may hold beyond twice what was on screen before the frames that pin it copy their rows. */
const RETENTION_SLACK = 8;

export type StreamFactory = (composition: Composition, a: Accepted, env: DataEnvironment, kind: ChartType) => StreamSession;

/** Only the streaming compositions reach here (the static entry passes no factory), so `openStore` is present. */
export function openStreamSession(composition: Composition, a: Accepted, env: DataEnvironment, kind: ChartType): StreamSession {
  return new StreamSession(composition.openStore!(a.frame, a.source, a.options.data, env, kind), a.source.table);
}

/** Retention bookkeeping belongs to the store whose revisions it tracks. */
export class StreamSession implements StreamSessionHandle {
  /** Frames the store produced, whose rows live in its revisions until retirement. */
  #storeFrames: WeakSet<Frame> | null = null;
  /**
   * Rows copied out of the store for a frame that still needs them after the store moved on: the displayed
   * frame, the pending (accepted, not yet drawn) one and the one being published each own theirs, so none of
   * them pins the store's history (final review, finding 2).
   */
  #frozenRows: WeakMap<Frame, Map<number, unknown>> | null = null;
  /**
   * One past the last source index each store frame can address: a store numbers rows in arrival order (the
   * opening data first), so a frame's raw window can be read back without the store (re-encoding while paused).
   */
  #rowEnds: WeakMap<Frame, number> | null = null;
  /** Rows below this source index came from the caller's typed columns (the opening data). */
  readonly #columnRows: number;
  /** What the store held right after the last release with a frame on screen: the bound's baseline. */
  #retainedBaseline: number = 0;
  /** The revision on screen when the baseline was taken (a number: a hidden chart keeps no frame alive). */
  #baselineRevision: number = -1;
  /** Resolutions this chart already let go of the caller's table: a later append keeps them as they are. */
  #tableless: WeakSet<ResolvedOptions> | null = null;

  constructor(readonly store: Store, table: Table | undefined) {
    if (table) {
      this.#rowEnds = new WeakMap();
      this.#rowEnds.set(store.frame, table.length);
    }
    this.#columnRows = table?.columns ? table.length : 0;
  }

  track(frame: Frame): void {
    (this.#storeFrames ??= new WeakSet()).add(frame);
  }

  /** `frame` addresses the rows `from` did, and `added` more. */
  ends(frame: Frame, from: Frame, added = 0): void {
    const end = this.#rowEnds?.get(from);
    if (end !== undefined) this.#rowEnds!.set(frame, end + added);
  }

  /**
   * `resolved` without the caller's opening table. One that has none already is kept, so a stream does not make
   * two resolutions and two empty tables per append (they would be equal to the ones they replace).
   */
  drop(resolved: ResolvedOptions): ResolvedOptions {
    if (this.#tableless?.has(resolved)) return resolved;
    const own = withoutTable(resolved);
    (this.#tableless ??= new WeakSet()).add(own);
    return own;
  }

  /** The rows of `frame` by source index: its copy when it has one, else its source. */
  row(frame: Frame, row: number): unknown {
    const own = this.#frozenRows?.get(frame);
    return own ? own.get(row) ?? null : frame.source.rowAt(row);
  }

  /**
   * The caller's rows of a displayed frame as a table, in source order and with their own source indexes, so
   * they can be normalized again on their own (re-encoding what is on screen while paused). A frame over the
   * caller's own table is read from it; a store frame from its raw window, with the rows that came from typed
   * columns marked as such (a NaN there is "no data", not an unplottable value; verification, defect 4).
   */
  table(frame: Frame): Table {
    const own = this.#frozenRows?.get(frame);
    if (!own && !this.#storeFrames?.has(frame) && isTable(frame.source)) return frame.source;
    const rows = own ?? this.#freeze(frame);
    const indexes = [...rows.keys()].sort((p, q) => p - q);
    const columns = this.#columnRows;
    // Positions read the rows in order; provenance and events read them by their own source index.
    return {
      ...rowsTable(indexes.map(i => rows.get(i))), isColumnRow: i => indexes[i]! < columns,
      rowIndex: i => indexes[i]!, rowAt: index => rows.get(index) ?? null,
    };
  }
  /**
   * The caller's rows of `frame`'s revision, read once, so the frame stays addressable on its own: every row
   * a slot refers to, and the raw window around them (rows with no usable x, which re-encoding to another
   * field can make points; verification, defect 4). The window is the retained rows from the lowest one a
   * slot refers to up to the end of the revision, and the retained rows just below it.
   */
  #freeze(frame: Frame): Map<number, unknown> {
    const rows = new Map<number, unknown>();
    // The store knows which source rows a revision still addresses: read exactly those (re-check, C4 and R7).
    const retained = this.#storeFrames?.has(frame) ? this.store.retainedRows(frame) : null;
    if (retained) {
      for (let i = 0; i < retained.length; i++) rows.set(retained[i]!, frame.source.rowAt(retained[i]!));
      return rows;
    }
    let lowest = Infinity;
    const keep = (row: number) => {
      if (row < 0 || rows.has(row)) return;
      rows.set(row, frame.source.rowAt(row));
      if (row < lowest) lowest = row;
    };
    const each = (index: Int32Array | null, length: number) => {
      for (let i = 0; i < length; i++) keep(index ? index[i]! : i);
    };
    if (frame.shape === 'aligned') for (const s of frame.series) each(s.row, frame.length);
    else if (frame.shape === 'points') {
      for (const s of frame.series) {
        each(s.row, s.x.length);
        // Observations with no plottable y are rows too: re-encoding to another field can make them points
        // (final review, finding 6).
        if (s.missingRow) for (const row of s.missingRow) keep(row);
      }
    }
    else each(frame.row, frame.labels.length);
    const end = this.#rowEnds?.get(frame);
    if (end !== undefined) {
      const from = Math.min(lowest, end);
      for (let i = from; i < end; i++) {
        if (rows.has(i)) continue;
        const row = frame.source.rowAt(i);
        if (row !== null) rows.set(i, row);
      }
      for (let i = from - 1; i >= 0; i--) {
        const row = frame.source.rowAt(i);
        if (row === null) break;
        rows.set(i, row);
      }
    }
    return rows;
  }


  /**
   * Lets the store release every revision no frame needs: the displayed snapshot keeps its own (a store can
   * only retire "everything up to a revision", so a displayed frame older than revisions that were accepted
   * since takes a copy of its rows once the store has grown past twice its last size), and a pending frame
   * that has not been drawn yet keeps its own. Runs after every accepted call and every published frame,
   * whether or not frames run (review 3, controller blockers 2 and 4).
   */
  release(screen: Frame | null, pending: Frame, running: Frame | null, pausedFrame: Frame | undefined): void {
    const store = this.store;
    const head = store.frame;
    let floor = Math.min(this.#pin(screen, head), this.#pin(pending, head), this.#pin(running, head),
      this.#pin(pausedFrame, head));
    // Copy only once the store has grown beyond the retention bound, so copying is amortized over arrivals.
    const bound = 2 * this.#retainedBaseline + RETENTION_SLACK;
    if (floor !== Infinity && (head.revision - floor > bound || store.retainedRowCount > bound)) {
      // In this order, each after the copies before it: a frame copied once is not pinned the second time.
      this.#pin(screen, head, true);
      this.#pin(pending, head, true);
      this.#pin(running, head, true);
      this.#pin(pausedFrame, head, true);
      floor = head.revision;
    }
    floor = Math.min(floor, head.revision);
    if (floor > 0) store.retire(floor - 1);
  }

  /** A frame of the store other than its head whose rows still live only in the store's revisions. */
  #pin(frame: Frame | null | undefined, head: Frame, freeze = false): number {
    if (!frame || frame === head || !this.#storeFrames?.has(frame) || this.#frozenRows?.has(frame)) return Infinity;
    if (freeze) (this.#frozenRows ??= new WeakMap()).set(frame, this.#freeze(frame));
    return frame.revision;
  }

  shown(frame: Frame): void {
    // The baseline moves only when other data comes on screen: redrawing the same paused frame, a frame that
    // could not be measured, or showing again the frame shown before the chart was hidden does not let the
    // store grow further (final review, finding 2; re-check, C2).
    if (frame.revision !== this.#baselineRevision) {
      this.#baselineRevision = frame.revision;
      this.#retainedBaseline = this.store.retainedRowCount;
    }
  }

  /** Drop references held by the session when its controller is destroyed. */
  clear(): void {
    this.#storeFrames = null;
    this.#frozenRows = null;
    this.#rowEnds = null;
    this.#tableless = null;
  }
}
