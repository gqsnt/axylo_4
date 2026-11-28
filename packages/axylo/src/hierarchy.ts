/**
 * Opt-in hierarchy charts (`axylo/hierarchy`, N9b): `treemap` (squarified) and `sunburst` (radial partition),
 * with drill-down, an ancestor breadcrumb, hierarchical keyboard movement and a five-column accessible table.
 *
 * - Nested trees or flat parent-id rows, rolled up bottom-up into typed arrays (hierarchy/tree.ts).
 * - AX190 (leaf values that cannot be drawn), AX191 (orphans, duplicate ids, cycles), AX192 (nothing positive to
 *   draw); `strict: true` rejects the call and keeps the committed state.
 * - Importing this module touches no DOM and runs no code at top level, so it is safe in Node and SSR.
 */
import type { Diagnostic, Target } from './public.js';
import { openHierarchyChart, type HierarchyChart } from './hierarchy/chart';
import { validateHierarchy, type SunburstOptions, type TreemapOptions } from './hierarchy/core';
import { SUNBURST_DRIVER } from './hierarchy/sunburst/render';
import { TREEMAP_DRIVER } from './hierarchy/treemap/render';

export type TreemapChart = HierarchyChart<TreemapOptions>;
export type SunburstChart = HierarchyChart<SunburstOptions>;

/** Creates a squarified treemap. */
export function treemap(target: Target, options: TreemapOptions): TreemapChart {
  return openHierarchyChart(TREEMAP_DRIVER, target, options);
}

/** Creates a sunburst: the root at the center, rings by depth, clockwise from 12 o'clock. */
export function sunburst(target: Target, options: SunburstOptions): SunburstChart {
  return openHierarchyChart(SUNBURST_DRIVER, target, options);
}

/** Validates treemap options and data without a DOM (Node and SSR safe): what a created chart would report. */
export function validateTreemap(options: TreemapOptions): readonly Diagnostic[] {
  return validateHierarchy('treemap', options);
}

/** Validates sunburst options and data without a DOM (Node and SSR safe). */
export function validateSunburst(options: SunburstOptions): readonly Diagnostic[] {
  return validateHierarchy('sunburst', options);
}

export type { HierarchyOptions, HierarchyTitle, SunburstOptions, TreemapOptions } from './hierarchy/core';
export type { HierarchyChart, HierarchyCrumb, HierarchyEvents, HierarchyPoint } from './hierarchy/chart';
export type { HierarchyData, HierarchyNode, HierarchyRow } from './hierarchy/tree';
export type { HierarchyMessages, NodeText } from './hierarchy/reader';
export type { TableModel } from './core/contracts';
export type { Diagnostic, Target } from './public.js';
