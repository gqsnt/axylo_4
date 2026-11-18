import { LineChart } from '@mui/x-charts/LineChart';
import { BarChart } from '@mui/x-charts/BarChart';
import { PieChart } from '@mui/x-charts/PieChart';
import { mount } from './_react.jsx';

export const meta = { name: 'MUI X Charts', pkg: '@mui/x-charts' };
// No visible title component; `title` sets the accessible name only. Without width/height props the chart fills its container.

const Lines = ({ t, series, yTitle, title }) => (
  <LineChart title={title} xAxis={[{ data: t, scaleType: 'time' }]} yAxis={[{ label: yTitle }]} series={series} />
);

export function trend(el, d) {
  const r = mount(el, p => <Lines {...p} />);
  r.draw({ title: d.title, t: d.t.map(v => new Date(v)), yTitle: d.yTitle, series: d.series.map(s => ({ label: s.name, data: s.values })) });
  return r;
}

export function bars(el, d) {
  const r = mount(el, () => (
    <BarChart title={d.title} xAxis={[{ data: d.categories }]} yAxis={[{ label: d.yTitle }]} series={[{ label: d.name, data: d.values }]} />
  ));
  r.draw();
  return r;
}

export function parts(el, d) {
  const data = d.labels.map((label, id) => ({ id, label, value: d.values[id] }));
  const r = mount(el, () => <PieChart title={d.title} series={[{ data, innerRadius: 70 }]} />);
  r.draw();
  return r;
}

export function dirty(el, d) {
  const r = mount(el, () => (
    <LineChart xAxis={[{ data: d.categories, scaleType: 'point' }]} series={[{ label: d.name, data: d.values }]} />
  ));
  r.draw();
  return r;
}

export function scale(el, d) {
  const r = mount(el, p => <Lines {...p} />);
  r.t = d.t.map(v => new Date(v)); r.y = d.y.slice();
  r.draw({ t: r.t, series: [{ label: d.name, data: r.y }] });
  return r;
}

export function stream(el, d) {
  const r = scale(el, d);
  r.push = (x, y) => { r.t = [...r.t.slice(1), new Date(x)]; r.y = [...r.y.slice(1), y]; r.draw({ t: r.t, series: [{ label: d.name, data: r.y }] }); };
  return r;
}

// A time axis needs Date objects, so the strings go through new Date() (UTC midnight for date-only strings).
export function dates(el, d) {
  const r = mount(el, p => <Lines {...p} />);
  r.draw({ title: d.title, t: d.days.map(s => new Date(s)), series: d.series.map(s => ({ label: s.name, data: s.values })) });
  return r;
}
