import { ResponsiveLine } from '@nivo/line';
import { ResponsiveBar } from '@nivo/bar';
import { ResponsivePie } from '@nivo/pie';
import { mount } from './_react.jsx';

export const meta = { name: 'Nivo', pkg: '@nivo/core' };
// Nivo has no title component; margins must be set by hand or axes and legends are clipped.

const Lines = ({ data, yTitle, legend }) => (
  <ResponsiveLine
    data={data}
    margin={{ top: 20, right: legend ? 130 : 20, bottom: 40, left: 70 }}
    xScale={{ type: 'time' }}
    axisBottom={{ format: '%b %d' }}
    axisLeft={{ legend: yTitle, legendOffset: -55, legendPosition: 'middle' }}
    useMesh
    legends={legend ? [{ anchor: 'bottom-right', direction: 'column', translateX: 120, itemWidth: 100, itemHeight: 20 }] : []}
  />
);

export function trend(el, d) {
  const data = d.series.map(s => ({ id: s.name, data: s.values.map((y, i) => ({ x: new Date(d.t[i]), y })) }));
  const r = mount(el, p => <Lines {...p} />);
  r.draw({ data, yTitle: d.yTitle, legend: true });
  return r;
}

export function bars(el, d) {
  const data = d.categories.map((team, i) => ({ team, [d.name]: d.values[i] }));
  const r = mount(el, () => (
    <ResponsiveBar data={data} keys={[d.name]} indexBy="team" margin={{ top: 20, right: 20, bottom: 40, left: 70 }}
      axisLeft={{ legend: d.yTitle, legendOffset: -55, legendPosition: 'middle' }} />
  ));
  r.draw();
  return r;
}

export function parts(el, d) {
  const data = d.labels.map((id, i) => ({ id, value: d.values[i] }));
  const r = mount(el, () => <ResponsivePie data={data} innerRadius={0.5} margin={{ top: 40, right: 80, bottom: 40, left: 80 }} />);
  r.draw();
  return r;
}

export function dirty(el, d) {
  const data = [{ id: d.name, data: d.categories.map((x, i) => ({ x, y: d.values[i] })) }];
  const r = mount(el, () => <ResponsiveLine data={data} margin={{ top: 20, right: 20, bottom: 40, left: 70 }} useMesh />);
  r.draw();
  return r;
}

export function scale(el, d) {
  const r = mount(el, p => <Lines {...p} />);
  r.pts = d.t.map((t, i) => ({ x: new Date(t), y: d.y[i] }));
  r.draw({ data: [{ id: d.name, data: r.pts }] });
  return r;
}

export function stream(el, d) {
  const r = scale(el, d);
  r.push = (x, y) => { r.pts = [...r.pts.slice(1), { x: new Date(x), y }]; r.draw({ data: [{ id: d.name, data: r.pts }] }); };
  return r;
}

export function dates(el, d) {
  const data = d.series.map(s => ({ id: s.name, data: s.values.map((y, i) => ({ x: d.days[i], y })) }));
  const r = mount(el, () => (
    <ResponsiveLine data={data} margin={{ top: 20, right: 130, bottom: 40, left: 70 }} xScale={{ type: 'time', format: '%Y-%m-%d' }}
      axisBottom={{ format: '%b %d' }} useMesh />
  ));
  r.draw();
  return r;
}
