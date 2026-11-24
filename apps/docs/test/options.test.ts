/**
 * The options reference (apps/docs/pages/options.md) against the public types, read with the TypeScript
 * compiler API (typescript/unstable/sync, TypeScript 7) from the source declarations, so it needs no build:
 *
 * - keys: every key of every option type, field type, handle and event in packages/axylo/src/public.ts (and
 *   in the reference, and nothing else is;
 * - types: each documented type is the declared type of that key, both ways assignable (`Options` in the
 *   reference stands for the chart's options type, checked as LineOptions<Row>);
 * - required: a key documented with default "required" is required in the type, and every other key is
 *   optional. Defaults written in `code` are checked against the running chart by defaults.browser.test.ts.
 *
 * Each table in the reference is marked `<!-- options: Group -->`; its first column holds the key, its second
 * the type, and for option tables the third the default. GROUPS says which type each group documents.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { API } from 'typescript/unstable/sync';
import { cacheDir, docsRoot, repoRoot } from '../lib/examples.mjs';
import { defaultMessages } from '../../../packages/axylo/src/messages/index';
import { messageUses } from '../data/messages.mjs';

const L = 'LineOptions<Row>';
/** The type a group documents, and the keys of that type the group stands for. */
const GROUPS: Record<string, { type: string; keys: string }> = {
  CommonOptions: { type: 'CommonOptions<Row>', keys: 'Keys<CommonOptions<Row>>' },
  Title: { type: 'Title', keys: 'Keys<Title>' },
  Encoding: { type: 'Encoding<Row>', keys: 'Keys<Encoding<Row>>' },
  CartesianOptions: { type: 'CartesianOptions', keys: 'Keys<CartesianOptions>' },
  Reference: { type: 'Reference', keys: 'Keys<Reference>' },
  CompactOption: { type: 'CompactOption', keys: 'Keys<CompactOption>' },
  AreaOptions: { type: 'AreaOptions<Row>', keys: `Exclude<Keys<AreaOptions<Row>>, Keys<${L}>>` },
  BarOptions: { type: 'BarOptions<Row>', keys: `Exclude<Keys<BarOptions<Row>>, Keys<${L}>>` },
  HistogramOptions: { type: 'HistogramOptions<Row>', keys: 'Exclude<Keys<HistogramOptions<Row>>, Keys<CommonOptions<Row>> | Keys<CartesianOptions> | Keys<CompactOption>>' },
  ScatterOptions: { type: 'ScatterOptions<Row>', keys: 'Exclude<Keys<ScatterOptions<Row>>, Keys<CommonOptions<Row>> | Keys<CartesianOptions>>' },
  DonutOptions: { type: 'DonutOptions<Row>', keys: 'Exclude<Keys<DonutOptions<Row>>, Keys<CommonOptions<Row>>>' },
  ValueField: { type: 'Exclude<ValueField<Row>, string>', keys: 'Keys<Exclude<ValueField<Row>, string>>' },
  XField: { type: 'Exclude<XField<Row>, string>', keys: 'Keys<Exclude<XField<Row>, string>>' },
  ScatterXField: { type: 'Exclude<ScatterXField<Row>, string>', keys: 'Keys<Exclude<ScatterXField<Row>, string>>' },
  Chart: { type: `Chart<Row, ${L}>`, keys: `Keys<Chart<Row, ${L}>>` },
  AppendOptions: { type: `NonNullable<Parameters<Chart<Row, ${L}>['append']>[1]>`, keys: `Keys<NonNullable<Parameters<Chart<Row, ${L}>['append']>[1]>>` },
  ChartEvents: { type: 'ChartEvents<Row>', keys: 'Keys<ChartEvents<Row>>' },
  Point: { type: 'Point<Row>', keys: 'Keys<Point<Row>>' },
  Diagnostic: { type: 'Diagnostic', keys: 'Keys<Diagnostic>' },
};
// Checks on the types themselves, so a key added to a composite type directly is not missed.
const EXTRA: Record<string, string> = {
  LineOptions: `Keys<${L}>`,
  Messages: 'Keys<Messages>',
};

interface Row { key: string; type: string; def: string | null }

/** Rows per marked table of options.md: the key(s) in the first cell, the type, the default if there is one. */
function documented(): Record<string, Row[]> {
  const source = fs.readFileSync(path.join(docsRoot, 'pages/options.md'), 'utf8').split('\n');
  const out: Record<string, Row[]> = {};
  const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
  const code = (cell: string) => /^``\s(.+)\s``$/.exec(cell)?.[1] ?? /^`([^`]+)`$/.exec(cell)?.[1] ?? null;
  for (let i = 0; i < source.length; i++) {
    const marker = /^<!-- options: (\w+) -->$/.exec(source[i]!.trim());
    if (!marker) continue;
    const header = cells(source[i + 1]!);
    const hasDefault = header[2] === 'Default';
    const rows: Row[] = [];
    for (let j = i + 3; j < source.length && source[j]!.startsWith('|'); j++) {
      const [key, type, def] = cells(source[j]!);
      const name = code(key!);
      const typeText = code(type!);
      if (name === null || typeText === null) throw new Error(`options.md, ${marker[1]}: row ${j + 1} needs a key and a type in code: ${source[j]}`);
      rows.push({ key: name.replace(/^data-\*$/, 'data-*'), type: typeText, def: hasDefault ? def! : null });
    }
    out[marker[1]!] = rows;
  }
  return out;
}

const docs = documented();
const dir = path.join(cacheDir, 'types');
const probe = path.join(dir, 'probe.ts');
let api: API;
const results: Record<string, string> = {};

/** `"a" | "b" | \`data-${string}\`` → ['a', 'b', 'data-*']. */
function parseUnion(text: string): string[] {
  if (text === 'never') return [];
  return text.split(' | ').map(part => part.startsWith('"') ? JSON.parse(part) as string : part.replace(/^`(.*)\$\{string\}`$/, '$1*')).sort();
}

const keyType = (key: string) => key === 'data-*' ? '`data-${string}`' : JSON.stringify(key);
const documentedType = (text: string) => text.replace(/\bOptions\b/g, L);

beforeAll(() => {
  fs.mkdirSync(dir, { recursive: true });
  const rel = (p: string) => path.relative(dir, path.join(repoRoot, p)).split(path.sep).join('/');
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
    extends: rel('tsconfig.base.json'),
    compilerOptions: {
      noEmit: true, types: [],
      paths: { axylo: [rel('packages/axylo/src/index.ts')] },
    },
    files: ['probe.ts', rel('packages/axylo/src/core/globals.d.ts')],
  }, null, 2));
  const lines = [
    "import type { AreaOptions, BarOptions, CartesianOptions, Chart, ChartEvents, CommonOptions, CompactOption, Data, Diagnostic, DonutOptions, Encoding, HistogramOptions, LineOptions, Messages, NumberKey, Point, Reference, ScatterOptions, ScatterXField, SeriesKey, StringKey, Title, ValueField, XField, XKey, XValue } from 'axylo';",
    'interface Row { day: string; v: number; s: string }',
    'type Keys<T> = T extends unknown ? { [K in keyof T]-?: [Exclude<T[K], undefined>] extends [never] ? never : K }[keyof T] : never;',
    'type Prop<T, K extends PropertyKey> = T extends unknown ? (K extends keyof T ? Exclude<T[K], undefined> : never) : never;',
    "type Need<T, K extends PropertyKey> = T extends unknown ? (K extends keyof T ? ({} extends Pick<T, K> ? 'optional' : 'required') : never) : never;",
    "type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? 'same' : 'documented is wider') : ([B] extends [A] ? 'documented is narrower' : 'different');",
  ];
  const probes: string[] = [];
  for (const [group, { keys }] of Object.entries(GROUPS)) probes.push(`keys_${group}`) && lines.push(`export declare const keys_${group}: ${keys};`);
  for (const [name, keys] of Object.entries(EXTRA)) probes.push(`keys_${name}`) && lines.push(`export declare const keys_${name}: ${keys};`);
  for (const [group, rows] of Object.entries(docs)) {
    const target = GROUPS[group]?.type;
    if (!target) continue;
    rows.forEach((row, i) => {
      lines.push(`export declare const type_${group}_${i}: Same<Prop<${target}, ${keyType(row.key)}>, ${documentedType(row.type)}>;`);
      lines.push(`export declare const need_${group}_${i}: Need<${target}, ${keyType(row.key)}>;`);
      probes.push(`type_${group}_${i}`, `need_${group}_${i}`);
    });
  }
  fs.writeFileSync(probe, lines.join('\n') + '\n');
  api = new API({ cwd: dir });
  const snapshot = api.updateSnapshot({ openProjects: [path.join(dir, 'tsconfig.json')] });
  const project = snapshot.getProjects()[0]!;
  const errors = project.program.getSemanticDiagnostics(probe).concat(project.program.getSyntacticDiagnostics(probe));
  if (errors.length) throw new Error('The probe of documented types does not compile; a documented type is not valid TypeScript:\n' + errors.map(e => JSON.stringify((e as { messageText?: unknown }).messageText ?? e)).join('\n'));
  const text = project.program.getSourceFile(probe)!.text;
  for (const name of probes) {
    const type = project.checker.getTypeAtPosition(probe, text.indexOf(`${name}:`));
    // 1 = TypeFormatFlags.NoTruncation: the whole union, however long.
    results[name] = project.checker.typeToString(type!, undefined, 1);
  }
}, 120_000);

afterAll(() => api?.close());

describe('options reference against the public types', () => {
  it('every marked table is a known group, and every group has a table', () => {
    expect(Object.keys(docs).sort()).toEqual(Object.keys(GROUPS).sort());
  });

  it.each(Object.keys(GROUPS))('%s: documented keys equal the type\'s keys', group => {
    const types = parseUnion(results[`keys_${group}`]!);
    const listed = (docs[group] ?? []).map(r => r.key).sort();
    expect(types.length, `${group} has keys`).toBeGreaterThan(0);
    expect({ missingFromReference: types.filter(k => !listed.includes(k)), notInTypes: listed.filter(k => !types.includes(k)) })
      .toEqual({ missingFromReference: [], notInTypes: [] });
  });

  it.each(Object.keys(GROUPS))('%s: each documented type is the declared type', group => {
    const wrong = (docs[group] ?? []).map((row, i) => ({ key: row.key, documented: row.type, result: results[`type_${group}_${i}`] }))
      .filter(r => r.result !== '"same"');
    expect(wrong).toEqual([]);
  });

  it.each(Object.keys(GROUPS).filter(g => docs[g]?.some(r => r.def !== null)))('%s: "required" exactly where the type requires the key', group => {
    const wrong = (docs[group] ?? []).map((row, i) => ({ key: row.key, documented: row.def, type: results[`need_${group}_${i}`] }))
      .filter(r => (r.documented === 'required') !== (r.type === '"required"'));
    expect(wrong).toEqual([]);
  });

  it('LineOptions is exactly the common, encoding, cartesian and compact groups', () => {
    const groups = ['CommonOptions', 'Encoding', 'CartesianOptions', 'CompactOption'].flatMap(g => parseUnion(results[`keys_${g}`]!));
    expect(parseUnion(results.keys_LineOptions!)).toEqual([...new Set(groups)].sort());
  });

  it('the generated Messages table lists every key of Messages', () => {
    // The table is generated from defaultMessages; this checks that defaultMessages has exactly the type's keys.
    expect(Object.keys(defaultMessages).sort()).toEqual(parseUnion(results.keys_Messages!));
  });

  it('the table says where each message is shown, for exactly those keys', () => {
    expect(Object.keys(messageUses).sort()).toEqual(parseUnion(results.keys_Messages!));
    expect(Object.entries(messageUses).filter(([, where]) => typeof where !== 'string' || where.trim() === '')).toEqual([]);
  });
});
