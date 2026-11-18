import { bar } from 'axylo';

// The Phase 1 "bars" task: values between 82 and 97, one long label, and a target line.
const rows = [
  { team: 'Billing', satisfied: 94 },
  { team: 'Customer Success & Onboarding', satisfied: 88 },
  { team: 'Platform', satisfied: 97 },
  { team: 'Mobile', satisfied: 82 },
  { team: 'Data', satisfied: 91 },
  { team: 'Security', satisfied: 85 },
  { team: 'Sales Eng.', satisfied: 90 },
];

// The value axis starts at zero, as bars must. Declared `percent`, it ends at 100.
bar('#chart', {
  title: 'Customer satisfaction by team',
  data: rows,
  x: 'team',
  y: { field: 'satisfied', label: 'Satisfied', scale: 'percent' },
  reference: [{ y: 90, label: 'Target' }],
});
