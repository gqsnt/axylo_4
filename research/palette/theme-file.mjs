// Reads the shipped colors from packages/axylo/src/theme/palette.ts, so the research scripts score what ships.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const THEME_FILE = path.resolve(here, '../../packages/axylo/src/theme/palette.ts');

export function readThemeFile(file = THEME_FILE) {
  const src = fs.readFileSync(file, 'utf8');
  const block = name => {
    const m = src.match(new RegExp(`export const ${name}: SchemeColors = \\{([\\s\\S]*?)\\n\\};`));
    if (!m) throw new Error(`no ${name} block in ${file}`);
    const get = k => m[1].match(new RegExp(`${k}: '(#[0-9a-f]{6})'`))[1];
    return { background: get('background'), axis: get('axis'), grid: get('grid'), muted: get('muted'), reference: get('reference'), focus: get('focus'),
      series: [...m[1].match(/series: \[([^\]]*)\]/)[1].matchAll(/'(#[0-9a-f]{6})'/g)].map(x => x[1]) };
  };
  return { light: block('LIGHT'), dark: block('DARK') };
}
