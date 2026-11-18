import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

// Mounts synchronously so that create/update timings include React's render and commit.
export function mount(el, render) {
  const root = createRoot(el);
  const draw = props => flushSync(() => root.render(render(props)));
  return { draw, destroy: () => root.unmount() };
}
