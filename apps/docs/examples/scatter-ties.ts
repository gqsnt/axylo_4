import { scatter } from 'axylo';

// Ratings are whole numbers, so many reviews share both coordinates. On a scatter chart that is
// ordinary data: the tooltip lists coincident points (up to eight), and the keyboard visits each.
const rows = [
  [4, 5], [4, 5], [4, 5], [5, 5], [3, 4], [4, 4], [4, 4], [2, 3],
  [5, 4], [5, 4], [1, 2], [3, 3], [3, 3], [3, 3], [2, 2], [5, 5],
].map(([ease, overall]) => ({ ease: ease!, overall: overall! }));

scatter('#chart', {
  title: 'Ease of use against overall rating',
  data: rows,
  x: { field: 'ease', label: 'Ease of use' },
  y: { field: 'overall', label: 'Overall rating' },
});
