Implemented all six additions in the [data module](/home/canarit/projects/axylo/packages/axylo/src/data). No changes to the shared contracts are required.

1. **Transactional append** stages the candidate frame, rows, and diagnostics. Abandoning it leaves the store and earlier frame buffers intact.
2. **Re-encoding and replacement** advance the epoch. Re-encoding preserves the source indexes of retained rows. Explicit replacement starts a new source index sequence, even when given the original data object.
3. **Revision retirement** keeps evicted rows readable through older frames until their revisions retire. Typed-column rows stay in column blocks and materialize only on `rowAt`.
4. **Static handoff** keeps ascending typed columns borrowed through `normalize`. `AlignedStore.fromFrame` takes ownership on the first append and reuses compatible ascending wide normalization, including after domain-only updates.
5. **Scatter and donut stores** preserve source indexes and silent typed `NaN` values. Scatter counts distinct x positions and reports `AX151` even when the incoming row is evicted. Donut counts distinct labels in first-seen order and reports duplicates through `AX108`.
6. **The standalone x parser** is exported from the data index and reports invalid inputs without source row indexes.

### Integration

All three stores expose these signatures, where `F` is their frame type.

```ts
prepareAppend(rows: readonly unknown[], options?: StoreAppendOptions): PreparedFrame<F>
resolveEncoding(input: unknown, sink: DiagnosticSink): ResolvedOptions
prepareReencode(options: ResolvedOptions, version: FrameVersion): PreparedFrame<F>
reencode(options: ResolvedOptions, version: FrameVersion): F
prepareReplace(data: unknown, options: ResolvedOptions, version: FrameVersion): PreparedFrame<F>
replace(data: unknown, options: ResolvedOptions, version: FrameVersion): F
retire(revision: number): void
readonly retainedRowCount: number
```

```ts
AlignedStore.fromFrame(
  frame: AlignedFrame, options: ResolvedOptions, data?: unknown,
  environment?: DataEnvironment, type?: AlignedChartType, sink?: DiagnosticSink,
): AlignedStore

new PointStore(options: ResolvedOptions, environment: DataEnvironment, version: FrameVersion, sink?: DiagnosticSink)
new DonutStore(options: ResolvedOptions, environment: DataEnvironment, version: FrameVersion, sink?: DiagnosticSink)

createXParser(axis: XAxisMeta, environment: DataEnvironment): XPositionParser
```

Core should normalize static charts and open the store on the first append. Build and validate the candidate view using `PreparedFrame.frame` and `callDiagnostics`, then call `commit()` after strict validation succeeds. Publish `diagnostics` as the resulting frame’s findings. Use `resolveEncoding` for encoding updates and `prepareReplace` whenever an update explicitly supplies data. Retire superseded revisions after the display switches. The store keeps its current logical rows available for future writes even if their frame retires.

### Verification

Added the regression and property tests first in [transactions.test.ts](/home/canarit/projects/axylo/packages/axylo/test/data/transactions.test.ts). Both requested root commands passed. Verification covered TypeScript and Node. Browser integration remains unverified.

```text
Test Files  34 passed (34)
     Tests  515 passed (515)
```