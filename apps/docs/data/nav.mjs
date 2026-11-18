// The site's pages in the order a reader needs them. Each `page` is a file in apps/docs/pages without `.md`.
// The diagnostics pages per code are generated from data/diagnostics.mjs and are not listed here.
export const nav = [
  { section: 'Start', pages: [
    { page: 'index', label: 'Overview' },
    { page: 'getting-started', label: 'Getting started' },
    { page: 'data', label: 'Your data' },
  ] },
  { section: 'Chart types', pages: [
    { page: 'line', label: 'Line' },
    { page: 'area', label: 'Area' },
    { page: 'bar', label: 'Bar' },
    { page: 'scatter', label: 'Scatter' },
    { page: 'donut', label: 'Donut' },
    { page: 'compact', label: 'Compact' },
  ] },
  { section: 'Guides', pages: [
    { page: 'updating', label: 'Updating, streaming, zoom' },
    { page: 'diagnostics', label: 'Diagnostics' },
    { page: 'theming', label: 'Theming' },
    { page: 'accessibility', label: 'Accessibility' },
    { page: 'conformance', label: 'Conformance table' },
  ] },
  { section: 'Reference', pages: [
    { page: 'options', label: 'Options' },
    { page: 'migrate-chartjs', label: 'From Chart.js' },
    { page: 'migrate-recharts', label: 'From Recharts' },
    { page: 'stability', label: 'Stability and releases' },
  ] },
];

export const pages = nav.flatMap(group => group.pages);
