// Negative control for csp.browser.test.ts: what a library that inserted label text as HTML would do.
document.body.insertAdjacentHTML('beforeend', '<img src=x onerror="window.__xss=1"><div style="color: red">inline style</div>');
