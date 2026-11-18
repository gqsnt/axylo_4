import { bar } from 'axylo';

// Stacked bars with both signs: positive parts stack up from zero, negative parts down from it,
// and the value axis covers both totals.
const rows = [
  { quarter: '2025 Q1', new: 120, expansion: 45, churn: -60 },
  { quarter: '2025 Q2', new: 135, expansion: 52, churn: -48 },
  { quarter: '2025 Q3', new: 110, expansion: 61, churn: -75 },
  { quarter: '2025 Q4', new: 150, expansion: 58, churn: -52 },
];

bar('#chart', {
  title: 'Net revenue change by quarter',
  data: rows,
  x: { field: 'quarter', ordered: true },
  y: [
    { field: 'new', label: 'New', unit: 'k USD' },
    { field: 'expansion', label: 'Expansion', unit: 'k USD' },
    { field: 'churn', label: 'Churn', unit: 'k USD' },
  ],
  layout: 'stacked',
});
