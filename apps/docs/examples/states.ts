import { line } from 'axylo';

// Draws no marks on purpose: each chart shows one of the built-in states.
const fields = { x: 'day', y: 'orders' } as const;
type Order = { day: string; orders: number };
const none: Order[] = [];

// While the query runs.
line('#loading', { title: 'Orders', data: none, ...fields, state: 'loading' });

// The query returned no rows: no option needed.
line('#empty', { title: 'Orders this week', data: none, ...fields });

// Your own wording for an empty result or a failure.
line('#custom', { title: 'Refunds', data: none, ...fields, state: { empty: 'No refunds yet.' } });
line('#failed', { title: 'Orders', data: none, ...fields, state: { error: 'The query timed out.' } });
