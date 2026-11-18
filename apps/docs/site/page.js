// Sizes each example frame to the height its page reports (site/frame.js). The message carries a number
// only; it is checked to come from one of this page's frames and is never inserted into the document.
addEventListener('message', event => {
  const height = event.data && event.data.axyloDocsHeight;
  if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) return;
  for (const frame of document.querySelectorAll('.example iframe')) {
    if (frame.contentWindow === event.source) frame.style.height = Math.min(Math.ceil(height), 4000) + 'px';
  }
});
