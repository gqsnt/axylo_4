/**
 * The options reference (apps/docs/pages/options.md) documents exactly the keys of the public types: every
 * key of every option type, field type, handle and event in packages/axylo/src/public.ts (and the React
 * props in packages/react/src/index.ts) appears in the reference, and nothing in the reference is missing
 * from the types. The keys are read with the TypeScript compiler API (typescript/unstable/sync, TypeScript 7)
 * from the source declarations, so the test needs no build.
 *
 * Each table in the reference is marked `<!-- options: Group -->`; its first column lists the keys in
 * backticks. GROUPS says which keys of the types each group stands for.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { API } from 'typescript/unstable/sync';
import { cacheDir, docsRoot, repoRoot } from '../lib/examples.mjs';
import { defaultMessages } from '../../../packages/axylo/src/messages/index';

const Keys = 'type Keys<T> = T extends unknown ? { [K in keyof T]-?: [Exclude<T[K], undefined>] extends [never] ? never : K }[keyof T] : never;';
const L = 'LineOptions<Row>';
const GROUPS: Record<string, string> = {
  CommonOptions: 'Keys<CommonOptions<Row>>',
  Title: 'Keys<Title>',
  Encoding: 'Keys<Encoding<Row>>',
  CartesianOptions: 'Keys<CartesianOptions>',
  Reference: 'Keys<Reference>',
  CompactOption: 'Keys<CompactOption>',
  AreaOptions: `Exclude<Keys<AreaOptions<Row>>, Keys<${L}>>`,
  BarOptions: `Exclude<Keys<BarOptions<Row>>, Keys<${L}>>`,
  ScatterOptions: 'Exclude<Keys<ScatterOptions<Row>>, Keys<CommonOptions<Row>> | Keys<CartesianOptions>>',
  DonutOptions: 'Exclude<Keys<DonutOptions<Row>>, Keys<CommonOptions<Row>>>',
  ValueField: 'Keys<Exclude<ValueField<Row>, string>>',
  XField: 'Keys<Exclude<XField<Row>, string>>',
  ScatterXField: 'Keys<Exclude<ScatterXField<Row>, string>>',
  Chart: `Keys<Chart<Row, ${L}>>`,
  AppendOptions: `Keys<NonNullable<Parameters<Chart<Row, ${L}>['append']>[1]>>`,
  ChartEvents: 'Keys<ChartEvents<Row>>',
  Point: 'Keys<Point<Row>>',
  Diagnostic: 'Keys<Diagnostic>',
  ReactProps: `Exclude<Keys<LineProps<Row>>, Keys<${L}>>`,
  ChartRef: `Keys<ChartRef<Row, ${L}>>`,
};
// Checks on the types themselves, so a key added to a composite type directly is not missed.
const EXTRA: Record<string, string> = {
  LineOptions: `Keys<${L}>`,
  Messages: 'Keys<Messages>',
  DonutReactProps: 'Exclude<Keys<DonutProps<Row>>, Keys<DonutOptions<Row>>>',
  AreaReactProps: 'Exclude<Keys<AreaProps<Row>>, Keys<AreaOptions<Row>>>',
  BarReactProps: 'Exclude<Keys<BarProps<Row>>, Keys<BarOptions<Row>>>',
  ScatterReactProps: 'Exclude<Keys<ScatterProps<Row>>, Keys<ScatterOptions<Row>>>',
};

const dir = path.join(cacheDir, 'types');
const probe = path.join(dir, 'probe.ts');
let api: API;
const keys: Record<string, string[]> = {};

/** `"a" | "b" | \`data-${string}\`` → ['a', 'b', 'data-*']. */
function parseUnion(text: string): string[] {
  if (text === 'never') return [];
  return text.split(' | ').map(part => part.startsWith('"') ? JSON.parse(part) as string : part.replace(/^`(.*)\$\{string\}`$/, '$1*'));
}

beforeAll(() => {
  fs.mkdirSync(dir, { recursive: true });
  const rel = (p: string) => path.relative(dir, path.join(repoRoot, p)).split(path.sep).join('/');
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
    extends: rel('tsconfig.base.json'),
    compilerOptions: {
      noEmit: true, types: [], jsx: 'react-jsx',
      paths: { axylo: [rel('packages/axylo/src/index.ts')], '@axylo/react': [rel('packages/react/src/index.ts')] },
    },
    files: ['probe.ts', rel('packages/axylo/src/core/globals.d.ts')],
  }, null, 2));
  const all = { ...GROUPS, ...EXTRA };
  fs.writeFileSync(probe, [
    "import type { AreaOptions, BarOptions, CartesianOptions, Chart, ChartEvents, CommonOptions, CompactOption, Diagnostic, DonutOptions, Encoding, LineOptions, Messages, Point, Reference, ScatterOptions, ScatterXField, Title, ValueField, XField } from 'axylo';",
    "import type { AreaProps, BarProps, ChartRef, DonutProps, LineProps, ScatterProps } from '@axylo/react';",
    'interface Row { day: string; v: number; s: string }',
    Keys,
    ...Object.entries(all).map(([name, type]) => `export declare const k_${name}: ${type};`),
  ].join('\n'));
  api = new API({ cwd: dir });
  const snapshot = api.updateSnapshot({ openProjects: [path.join(dir, 'tsconfig.json')] });
  const project = snapshot.getProjects()[0]!;
  const text = project.program.getSourceFile(probe)!.text;
  for (const name of Object.keys(all)) {
    const type = project.checker.getTypeAtPosition(probe, text.indexOf(`k_${name}:`));
    // 1 = TypeFormatFlags.NoTruncation: the whole union, however long.
    keys[name] = parseUnion(project.checker.typeToString(type!, undefined, 1)).sort();
  }
}, 60_000);

afterAll(() => api?.close());

/** Keys per marked table of options.md. */
function documented(): Record<string, string[]> {
  const source = fs.readFileSync(path.join(docsRoot, 'pages/options.md'), 'utf8').split('\n');
  const out: Record<string, string[]> = {};
  for (let i = 0; i < source.length; i++) {
    const marker = /^<!-- options: (\w+) -->$/.exec(source[i]!.trim());
    if (!marker) continue;
    const names: string[] = [];
    // Skip the header and rule; read rows until the table ends.
    for (let j = i + 3; j < source.length && source[j]!.startsWith('|'); j++) {
      const first = source[j]!.split(/(?<!\\)\|/)[1] ?? '';
      names.push(...[...first.matchAll(/`([^`]+)`/g)].map(m => m[1]!));
    }
    out[marker[1]!] = names.sort();
  }
  return out;
}

describe('options reference against the public types', () => {
  const docs = documented();

  it('every marked table is a known group, and every group has a table', () => {
    expect(Object.keys(docs).sort()).toEqual(Object.keys(GROUPS).sort());
  });

  it.each(Object.keys(GROUPS))('%s: documented keys equal the type\'s keys', group => {
    const types = keys[group]!;
    expect(types.length, `${group} has keys`).toBeGreaterThan(0);
    expect({ missingFromReference: types.filter(k => !docs[group]?.includes(k)), notInTypes: (docs[group] ?? []).filter(k => !types.includes(k)) })
      .toEqual({ missingFromReference: [], notInTypes: [] });
  });

  it('LineOptions is exactly the common, encoding, cartesian and compact groups', () => {
    const groups = [...keys.CommonOptions!, ...keys.Encoding!, ...keys.CartesianOptions!, ...keys.CompactOption!];
    expect(keys.LineOptions).toEqual([...new Set(groups)].sort());
  });

  it('the React components take the same extra props, except onZoom on Donut', () => {
    expect(keys.AreaReactProps).toEqual(keys.ReactProps);
    expect(keys.BarReactProps).toEqual(keys.ReactProps);
    expect(keys.ScatterReactProps).toEqual(keys.ReactProps);
    expect(keys.DonutReactProps).toEqual(keys.ReactProps!.filter(k => k !== 'onZoom'));
  });

  it('the generated Messages table lists every key of Messages', () => {
    // The table is generated from defaultMessages; this checks that defaultMessages has exactly the type's keys.
    expect(Object.keys(defaultMessages).sort()).toEqual(keys.Messages);
  });
});
