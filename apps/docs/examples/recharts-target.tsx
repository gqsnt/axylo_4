import { createRoot } from 'react-dom/client';
import { Bar } from '@axylo/react';
import { bars as d } from './_phase1-data';

const rows = d.categories.map((team, i) => ({ team, satisfied: d.values[i]! }));

function Satisfaction() {
  return (
    <Bar
      title={d.title}
      data={rows}
      x="team"
      y={{ field: 'satisfied', label: 'Satisfied', scale: 'percent' }}
      reference={[{ y: 90, label: 'Target' }]}
    />
  );
}

createRoot(document.getElementById('root')!).render(<Satisfaction />);
