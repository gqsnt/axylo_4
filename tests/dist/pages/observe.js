// Loaded first by the CSP test pages, as an external script (the policy allows no inline script). Records
// policy violations, and every element the page gains that could run script or load content from markup
// (spec DX8: label and formatter text is inserted as text, never as HTML), including the `u data-axs` elements
// the text tests' sentinels would become if parsed (pages/sentinels.ts).
window.__violations = [];
window.__created = [];
document.addEventListener('securitypolicyviolation', e => {
  window.__violations.push({ directive: e.violatedDirective, effective: e.effectiveDirective, blocked: e.blockedURI, source: e.sourceFile, line: e.lineNumber, sample: e.sample });
});
const suspicious = el =>
  ['IMG', 'IFRAME', 'OBJECT', 'EMBED', 'U'].includes(el.tagName.toUpperCase()) || el.hasAttribute('data-axs') ||
  (el.tagName.toUpperCase() === 'SCRIPT' && !el.hasAttribute('src')) ||
  Array.from(el.attributes).some(a => /^on/i.test(a.name));
new MutationObserver(records => {
  for (const r of records) for (const n of r.addedNodes) {
    if (n.nodeType !== 1) continue;
    for (const el of [n, ...n.querySelectorAll('*')]) if (suspicious(el)) window.__created.push(el.outerHTML.slice(0, 200));
  }
}).observe(document, { childList: true, subtree: true });
