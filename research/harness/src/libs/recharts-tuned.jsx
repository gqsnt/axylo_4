// Recharts with the options its performance guide recommends: no dots, no animation.
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { mount } from './_react.jsx';
export const meta = { name: 'Recharts (tuned)', pkg: 'recharts' };
const day = t => new Date(t).toLocaleDateString();
const C = ({ rows, name }) => (
  <ResponsiveContainer width="100%" height="100%">
    <LineChart data={rows}>
      <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={day} />
      <YAxis domain={['auto', 'auto']} />
      <Tooltip labelFormatter={day} isAnimationActive={false} />
      <Line dataKey={name} stroke="#8884d8" dot={false} isAnimationActive={false} strokeWidth={1} />
    </LineChart>
  </ResponsiveContainer>
);
export function scale(el, d) {
  const r = mount(el, p => <C {...p} />);
  r.rows = d.t.map((t, i) => ({ t, [d.name]: d.y[i] })); r.name = d.name;
  r.draw({ rows: r.rows, name: d.name });
  return r;
}
export function stream(el, d) {
  const r = scale(el, d);
  r.push = (x, y) => { r.rows = [...r.rows.slice(1), { t: x, [d.name]: y }]; r.draw({ rows: r.rows, name: r.name }); };
  return r;
}
