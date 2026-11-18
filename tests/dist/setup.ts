// Packs packages/*/dist once per run and installs the tarballs into the fixtures (scripts/pack.mjs). Set
// AXYLO_DIST_BUILD=1 to run the root build first; by default the dist already on disk is packed.
// @ts-expect-error scripts/pack.mjs is plain JavaScript without declarations
import { pack } from '../../scripts/pack.mjs';

export default function setup(): void {
  (pack as (options: { build: boolean; log: (line: string) => void }) => unknown)({
    build: process.env.AXYLO_DIST_BUILD === '1',
    log: line => console.log(`[pack] ${line}`),
  });
}
