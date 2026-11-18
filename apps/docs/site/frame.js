// Runs in each example page: tells the documentation page around it how tall the example is, so the frame
// shows the whole example without a scroll bar of its own. Only a number crosses the frame boundary.
(() => {
  if (window.parent === window) return;
  let last = 0;
  const report = () => {
    const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
    if (height === last) return;
    last = height;
    window.parent.postMessage({ axyloDocsHeight: height }, '*');
  };
  new ResizeObserver(report).observe(document.documentElement);
  report();
})();
