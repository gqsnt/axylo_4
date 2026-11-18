// Text cost ablations (class c bounds): the registry's prose, the default messages. Not shippable as such.
import fs from 'node:fs';
import path from 'node:path';
import { variant } from './lib.mjs';
const blank = (text, from, to, keep) => {
  const a = text.indexOf(from), b = text.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('block not found');
  let n = 0;
  const body = text.slice(a, b).replace(/'(?:[^'\\\n]|\\.)*'/g, s => (keep(s) ? s : (n++, "''")));
  console.log(`blanked ${n} literals`);
  return text.slice(0, a) + body + text.slice(b);
};
{
  const d = variant('no-registry-text');
  const p = path.join(d, 'diagnostics/registry.ts');
  let t = fs.readFileSync(p, 'utf8');
  t = blank(t, 'export const diagnosticRegistry = {', '} as const satisfies', s => ["'error'", "'warning'", "'hint'", "'bar'", "'category'"].includes(s));
  // the shared fragments above the table too
  t = blank(t, 'const quote = ', 'type Entry', () => false);
  fs.writeFileSync(p, t);
}
{
  const d = variant('no-message-text');
  const p = path.join(d, 'messages/index.ts');
  let t = fs.readFileSync(p, 'utf8');
  t = blank(t, "const chartSummary = '", 'export function fill', () => false);
  fs.writeFileSync(p, t);
}
