import { calendarDate, normalizedText } from './table.mjs';

// Text can keep its accessible name even when a visually clipped ancestor hides the glyphs.
async function textFits(locator, figure, { allowHidden = false } = {}) {
  const bounds = await figure.boundingBox();
  if (!bounds) return false;
  return locator.evaluate((element, { bounds, allowHidden }) => {
    const style = getComputedStyle(element);
    if (allowHidden && (element.hidden || element.classList.contains('axylo-visually-hidden') ||
        style.display === 'none' || style.visibility === 'hidden')) return true;
    if (style.display === 'none' || style.visibility !== 'visible') return false;
    const clip = { left: Math.max(bounds.x, 0), top: Math.max(bounds.y, 0),
      right: Math.min(bounds.x + bounds.width, innerWidth),
      bottom: Math.min(bounds.y + bounds.height, innerHeight) };
    for (let node = element; node instanceof HTMLElement; node = node.parentElement) {
      const css = getComputedStyle(node);
      if (css.opacity === '0' || css.clipPath !== 'none') return false;
      const box = node.getBoundingClientRect();
      if (css.overflowX !== 'visible') {
        clip.left = Math.max(clip.left, box.left + node.clientLeft);
        clip.right = Math.min(clip.right, box.left + node.clientLeft + node.clientWidth);
      }
      if (css.overflowY !== 'visible') {
        clip.top = Math.max(clip.top, box.top + node.clientTop);
        clip.bottom = Math.min(clip.bottom, box.top + node.clientTop + node.clientHeight);
      }
    }
    const range = document.createRange();
    range.selectNodeContents(element);
    const glyphs = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
    return glyphs.length > 0 && glyphs.every(rect => rect.left >= clip.left - 1 && rect.right <= clip.right + 1 &&
      rect.top >= clip.top - 1 && rect.bottom <= clip.bottom + 1);
  }, { bounds, allowHidden });
}

export async function titleCheck(figure) {
  const title = figure.locator('.axylo-title');
  const drawn = await title.count();
  const pass = drawn === 0 || (drawn === 1 && await textFits(title, figure, { allowHidden: true }));
  return { pass, detail: pass ? 'Visible title fits inside the figure.' : 'Title text is clipped.' };
}

function omissionCount(text) {
  const counts = [];
  for (const pattern of [
    /\bvalues? (?:not shown|left out|omitted)\s*:\s*([\d,]+)\b/gi,
    /\b([\d,]+) values? (?:were )?(?:not shown|left out|omitted)\b/gi,
    /\b(?:omitted|left out)\s+([\d,]+) values?\b/gi,
  ]) {
    for (const match of text.matchAll(pattern)) counts.push(Number(match[1].replaceAll(',', '')));
  }
  return counts;
}

async function accessibleNote(page) {
  const session = await page.context().newCDPSession(page);
  try {
    const { root } = await session.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#chart figure .axylo-note' });
    if (!nodeId) return '';
    const { node } = await session.send('DOM.describeNode', { nodeId });
    const { nodes } = await session.send('Accessibility.getFullAXTree');
    const indexed = new Map(nodes.map(item => [item.nodeId, item]));
    const note = nodes.find(item => item.backendDOMNodeId === node.backendNodeId);
    if (!note || note.ignored) return '';
    function text(item) {
      const children = (item.childIds ?? []).map(id => indexed.get(id)).filter(Boolean);
      return [
        ...(!item.ignored && ['status', 'StaticText'].includes(item.role?.value) ? [item.name?.value ?? ''] : []),
        ...children.flatMap(text),
      ];
    }
    return text(note).join(' ');
  } finally {
    await session.detach();
  }
}

export async function noteCheck(page, figure, count = 0) {
  const note = figure.locator('.axylo-note');
  const visible = await note.count() === 1 && await note.isVisible();
  const text = visible ? normalizedText(await note.innerText()) : '';
  const onScreen = omissionCount(text);
  const inTree = omissionCount(visible ? await accessibleNote(page) : '');
  const matches = counts => count ? counts.length > 0 && counts.every(n => n === count) : counts.length === 0;
  const pass = matches(onScreen) && matches(inTree) && (!count || await textFits(note, figure));
  return { pass, detail: `Expected ${count} omission(s). Visible note: ${text || 'none'}. Accessible counts: ${inTree.join(', ') || 'none'}.` };
}

export async function dateCheck(figure, expected) {
  if (expected.x !== 'date') return { pass: true, detail: 'Category axis.' };
  const slider = figure.locator('.axylo-proxy');
  if (await slider.count() !== 1) return { pass: false, detail: 'No keyboard plot control.' };
  await slider.press('Home');
  const tooltip = figure.locator('.axylo-tooltip-title:visible');
  const reading = await slider.getAttribute('aria-valuetext') ?? '';
  // The default keyboard text starts with the date, then reads the series and point number.
  const firstPart = reading.match(/^(.+)\. .+\. Point \d/)?.[1] ?? '';
  const sample = await tooltip.count() === 1 ? await tooltip.innerText() : firstPart;
  const [wanted] = expected.rows.find(([, ...values]) => values.some(value => value !== null));
  return { pass: calendarDate(sample) === wanted, detail: `Expected ${wanted}, read ${JSON.stringify(sample)}.` };
}

export async function plotCheck(figure, expected) {
  if (expected.type === 'bar') {
    const ticks = await figure.locator('.axylo-text [data-role="tick-x"]:visible').evaluateAll(labels => labels.map(label => {
      const box = label.getBoundingClientRect();
      return { label: label.textContent.trim(), x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }));
    const spread = key => Math.max(...ticks.map(tick => tick[key])) - Math.min(...ticks.map(tick => tick[key]));
    const axis = spread('x') >= spread('y') ? 'x' : 'y';
    ticks.sort((a, b) => a[axis] - b[axis]);
    const bars = await figure.locator('svg.axylo-svg .axylo-scene g > rect:visible').evaluateAll((rects, axis) =>
      rects.flatMap(rect => {
        if (!/--axylo-series-color-\d+\b/.test(rect.parentElement.style.getPropertyValue('color'))) return [];
        const box = rect.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0) return [];
        return [axis === 'x' ? box.x + box.width / 2 : box.y + box.height / 2];
      }), axis);
    const groups = ticks.map(() => 0);
    for (const center of bars) {
      const distances = ticks.map(tick => Math.abs(tick[axis] - center));
      const nearest = distances.indexOf(Math.min(...distances));
      if (nearest >= 0) groups[nearest]++;
    }
    const quarters = expected.rows.map(([quarter]) => quarter);
    return {
      order: { pass: ticks.length === quarters.length &&
        ticks.every(({ label }, i) => label === quarters[i] && groups[i] === expected.series.length),
      detail: `Plotted quarters: ${ticks.map(({ label }, i) => `${label} (${groups[i]} bars)`).join(', ') || 'none'}.` },
      gaps: { pass: true, detail: 'Bar chart.' },
    };
  }

  // Like the painted-gap acceptance check, read the actual stroked SVG marks in screen coordinates.
  // Keep M/L commands and their order so a bridge cannot pass with only its endpoints in the right places.
  const vertices = await figure.locator('svg.axylo-svg .axylo-scene path[stroke-width]').evaluateAll(paths =>
    paths.flatMap(path => {
      if (!/--axylo-series-color-1\b/.test(path.style.getPropertyValue('color'))) return [];
      const style = getComputedStyle(path);
      const matrix = path.getScreenCTM();
      if (!matrix || !path.checkVisibility({ opacityProperty: true, visibilityProperty: true }) || style.stroke === 'none' ||
          style.stroke === 'transparent' || Number(style.strokeOpacity) === 0 || parseFloat(style.strokeWidth) <= 0) return [];
      return [...(path.getAttribute('d') ?? '').matchAll(/([ML])\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/g)]
        .map(([, command, x, y]) => ({ command, x: new DOMPoint(+x, +y).matrixTransform(matrix).x }));
    }));
  const present = expected.rows.flatMap(([day, value], index) => value === null ? [] : [{ day, index }]);
  const step = (vertices.at(-1)?.x - vertices[0]?.x) / (present.at(-1).index - present[0].index);
  const ordered = step > 0 && vertices.length === present.length &&
    vertices.every(({ x }, i) => Math.abs(x - (vertices[0].x + (present[i].index - present[0].index) * step)) <= 1);
  const gaps = expected.rows.flatMap(([day, value]) => value === null ? [day] : []);
  const broken = ordered && present.every(({ index }, i) => {
    const startsRun = i === 0 || index - present[i - 1].index > 1;
    return vertices[i].command === (startsRun ? 'M' : 'L');
  });
  return {
    order: { pass: ordered, detail: `Expected ${present.length} left-to-right calendar slots, saw ${vertices.length} stroke vertices.` },
    gaps: { pass: broken, detail: gaps.length ? `Expected stroke breaks at ${gaps.join(', ')}.` : 'Expected one continuous stroke.' },
  };
}
