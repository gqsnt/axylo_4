// Line row only: the option-name lists, registry entries and default message texts a line chart never reaches
// (they would move into the other kinds' compositions). Other rows of this variant are wrong.
import fs from 'node:fs';
import path from 'node:path';
import { edit, regex, variant } from './lib.mjs';
const d = variant(process.argv[2] ?? 'line-tables', process.argv[3] ?? 'base');
// option names: every kind gets line's list
regex(d, 'data/options.ts', /\n  (area|bar|scatter|donut): \[[^\]]*\],/g, (m, k) => `\n  ${k}: aligned,`, { min: 4 });
// registry: codes only donut (AX120, AX121), scatter (AX133) and bar (AX132) raise
regex(d, 'diagnostics/registry.ts', /\n  AX(120|121|132|133): \{ level:[\s\S]*?\n  outcome: [^\n]*\},/g, '', { min: 4 });
// default messages only other kinds show
regex(d, 'messages/index.ts', /\n  (otherSlices|typeArea|typeBar|typeScatter|typeDonut|donutSummary|incompleteStack|incompleteAt|incompleteCount|totalMixed|percentage|category): '[^']*',/g, (m, k) => `\n  ${k}: '',`, { min: 12 });
