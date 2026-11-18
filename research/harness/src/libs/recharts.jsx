import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { mount } from './_react.jsx';

export const meta = { name: 'Recharts', pkg: 'recharts' };
// Recharts has no default palette (every Line is #3182bd, every Pie sector #808080) and no title component.
// Colors below are the ones used throughout the official examples.
const colors = ['#8884d8', '#82ca9d', '#ffc658'];
const pieColors = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042'];
const day = t => new Date(t).toLocaleDateString(); // without a tickFormatter a time axis prints raw epoch numbers

const TimeLines = ({ rows, names, yTitle }) => (
  <ResponsiveContainer width="100%" height="100%">
    <LineChart data={rows}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={day} />
      <YAxis label={yTitle && { value: yTitle, angle: -90, position: 'insideLeft' }} />
      <Tooltip labelFormatter={day} />
      <Legend />
      {names.map((n, i) => <Line key={n} dataKey={n} stroke={colors[i]} />)}
    </LineChart>
  </ResponsiveContainer>
);

export function trend(el, d) {
  const rows = d.t.map((t, i) => Object.fromEntries([['t', t], ...d.series.map(s => [s.name, s.values[i]])]));
  const r = mount(el, p => <TimeLines {...p} />);
  r.draw({ rows, names: d.series.map(s => s.name), yTitle: d.yTitle });
  return r;
}

export function bars(el, d) {
  const rows = d.categories.map((name, i) => ({ name, [d.name]: d.values[i] }));
  const r = mount(el, () => (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" />
        <YAxis label={{ value: d.yTitle, angle: -90, position: 'insideLeft' }} />
        <Tooltip />
        <Bar dataKey={d.name} fill={colors[0]} />
      </BarChart>
    </ResponsiveContainer>
  ));
  r.draw();
  return r;
}

export function parts(el, d) {
  const rows = d.labels.map((name, i) => ({ name, value: d.values[i] }));
  const r = mount(el, () => (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={rows} dataKey="value" nameKey="name" innerRadius="50%" label>
          {rows.map((row, i) => <Cell key={row.name} fill={pieColors[i % pieColors.length]} />)}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  ));
  r.draw();
  return r;
}

export function dirty(el, d) {
  const rows = d.categories.map((name, i) => ({ name, [d.name]: d.values[i] }));
  const r = mount(el, () => (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows}>
        <XAxis dataKey="name" />
        <YAxis />
        <Tooltip />
        <Line dataKey={d.name} stroke={colors[0]} />
      </LineChart>
    </ResponsiveContainer>
  ));
  r.draw();
  return r;
}

export function scale(el, d) {
  const rows = d.t.map((t, i) => ({ t, [d.name]: d.y[i] }));
  const r = mount(el, p => <TimeLines {...p} />);
  r.rows = rows; r.names = [d.name];
  r.draw({ rows, names: r.names });
  return r;
}

export function stream(el, d) {
  const r = scale(el, d);
  r.push = (x, y) => { r.rows = [...r.rows.slice(1), { t: x, [d.name]: y }]; r.draw({ rows: r.rows, names: r.names }); };
  return r;
}

// Recharts has no date parsing: date strings go on a category axis and are printed as written.
export function dates(el, d) {
  const rows = d.days.map((day, i) => Object.fromEntries([['day', day], ...d.series.map(s => [s.name, s.values[i]])]));
  const r = mount(el, () => (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows}>
        <XAxis dataKey="day" />
        <YAxis />
        <Tooltip />
        <Legend />
        {d.series.map((s, i) => <Line key={s.name} dataKey={s.name} stroke={colors[i]} />)}
      </LineChart>
    </ResponsiveContainer>
  ));
  r.draw();
  return r;
}
