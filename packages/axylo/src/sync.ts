/**
 * Opt-in linked hover and zoom (`axylo/sync`, C5.3) and the multi-panel dashboard (N6).
 *
 * `createSyncGroup` and `syncCharts` link charts made by any entry point; `createDashboard` lays out charts the
 * caller's factories make and links them. Each is its own module, so a page that imports only the group
 * carries no dashboard code, and nothing runs at import time (0 raw bytes on bare import).
 */
export {
  createSyncGroup, syncCharts,
  type SyncXKind, type UnmatchedHoverPolicy, type SyncableChart, type SyncOrigin, type SyncMismatch,
  type SyncMemberOptions, type SyncGroupOptions, type SyncGroup,
} from './sync/group';
export { createDashboard, type Dashboard, type DashboardOptions, type DashboardPanel } from './sync/dashboard';
export type { ChartEvents, Point, XValue } from './public.js';
