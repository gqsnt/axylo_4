import { line } from 'axylo';

// Instants: epoch milliseconds, one per 10 minutes over a day, declared `type: 'time'`.
const start = Date.UTC(2026, 2, 10, 0, 0);
const services = ['checkout', 'search'];
const rows = Array.from({ length: 144 }, (_, i) => services.map((service, s) => ({
  at: start + i * 600_000,
  service,
  p95: Math.round((s ? 180 : 320) + 60 * Math.sin(i / 12 + s) + (i >= 84 && i < 96 ? 400 : 0)),
}))).flat();

line('#chart', {
  title: 'Response time, 10 March',
  subtitle: 'p95 per 10 minutes',
  data: rows,
  // Shown in UTC for every viewer; the tooltip heading and the summary name the zone.
  x: { field: 'at', type: 'time', timeZone: 'UTC' },
  y: { field: 'p95', label: 'Response time', unit: 'ms' },
  series: 'service',
  reference: [
    { y: 500, label: 'Objective' },
    { x: [start + 84 * 600_000, start + 96 * 600_000], label: 'Incident' },
  ],
});
