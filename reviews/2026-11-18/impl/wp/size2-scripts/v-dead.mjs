// Members that only tests and the instrumentation (dev, bench) reach, removed from the build: the P7 byte
// counting (count, ownedBytes, the caller-buffer bookkeeping), the stores' test conveniences, Delivery.deliver.
import { edit, regex, remove, variant } from './lib.mjs';
const d = variant(process.argv[2] ?? 'dead', process.argv[3] ?? 'base');
for (const f of ['store-buffers.ts', 'store-window.ts', 'store-unaligned.ts', 'store-rows.ts', 'store.ts']) remove(d, `data/${f}`, '  count(bytes: ByteCount', { all: true });
for (const f of ['store.ts', 'store-unaligned.ts']) {
  remove(d, `data/${f}`, '  ownedBytes(');
  remove(d, `data/${f}`, '  reencode(');
  remove(d, `data/${f}`, '  replace(');
  remove(d, `data/${f}`, '  append(');
  remove(d, `data/${f}`, '  prepareReplace(');
  regex(d, `data/${f}`, /\n  private readonly caller = new CallerBuffers\(\);/, '');
  regex(d, `data/${f}`, /\n\s*this\.caller\.add\([^)]*\);/g, '');
}
remove(d, 'data/store.ts', '  get diagnostics(');
remove(d, 'data/store-unaligned.ts', '  get diagnostics(');
regex(d, 'data/store-buffers.ts', /\n\s*lazyColumns\.set\([^;]*;/, '');
remove(d, 'core/delivery.ts', '  deliver(');
