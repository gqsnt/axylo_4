/**
 * "View as table" (spec A4): built only when opened, from the reader model's lazy table, and destroyed when
 * closed. A real table (caption, column headers with units, x values as row headers) inside a focusable,
 * labelled scroll region no taller than the plot, 100 rows per page, with a pager and a "go to" field that
 * jumps to the page holding an x value. Text only, never HTML.
 */
import type { TableModel, XValue } from '../core/contracts';

export interface TableTexts {
  readonly previousPage: string;
  readonly nextPage: string;
  /** "Page {page} of {count}" filled. */
  pageOf(page: number, count: number): string;
  /** Label of the "go to" field. */
  readonly jump: string;
  /** `lang` for each built-in string, or null. */
  readonly lang: (key: 'previousPage' | 'nextPage' | 'pageOf' | 'jumpToX') => string | null;
}

export interface TableView {
  readonly element: HTMLElement;
  /** A new model (the data or the view changed): the current page is shown again from it. */
  update(model: TableModel, texts: TableTexts, maxHeight: number): void;
  /** Shows the page holding row `ordinal`. */
  showRow(ordinal: number): void;
  readonly page: number;
  destroy(): void;
}

function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) el.removeAttribute(name);
  else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

/**
 * `toValue` turns what the reader typed into an x value the model understands (a number on a number axis,
 * the text otherwise).
 */
export function createTableView(doc: Document, id: string, toValue: (text: string) => XValue | null): TableView {
  const element = doc.createElement('div');
  element.className = 'axylo-table';
  element.id = `${id}-table`;
  const scroll = doc.createElement('div');
  scroll.className = 'axylo-table-scroll';
  scroll.setAttribute('role', 'region');
  scroll.tabIndex = 0;
  const table = doc.createElement('table');
  const caption = doc.createElement('caption');
  caption.id = `${id}-table-caption`;
  scroll.setAttribute('aria-labelledby', caption.id);
  const head = doc.createElement('thead');
  const body = doc.createElement('tbody');
  table.append(caption, head, body);
  scroll.appendChild(table);

  const pager = doc.createElement('div');
  pager.className = 'axylo-pager';
  const previous = doc.createElement('button');
  previous.type = 'button';
  previous.className = 'axylo-control';
  const status = doc.createElement('span');
  status.className = 'axylo-page';
  // The reader moved: saying the new page is an answer to their own action (spec A7).
  status.setAttribute('aria-live', 'polite');
  const next = doc.createElement('button');
  next.type = 'button';
  next.className = 'axylo-control';
  const form = doc.createElement('form');
  form.className = 'axylo-jump';
  const label = doc.createElement('label');
  const labelText = doc.createElement('span');
  const field = doc.createElement('input');
  field.type = 'text';
  field.id = `${id}-table-jump`;
  field.className = 'axylo-jump-field';
  field.autocomplete = 'off';
  label.htmlFor = field.id;
  label.appendChild(labelText);
  form.append(label, field);
  pager.append(previous, status, next, form);
  element.append(scroll, pager);

  let model: TableModel | null = null;
  let texts: TableTexts | null = null;
  let page = 0;
  let shownSignature = '';

  const pages = () => model ? Math.max(1, Math.ceil(model.rowCount / model.pageSize)) : 1;

  function render(): void {
    if (!model || !texts) return;
    const count = pages();
    page = Math.max(0, Math.min(page, count - 1));
    const headers = model.headers.join('\u0000');
    if (caption.textContent !== model.caption) caption.textContent = model.caption;
    if (head.dataset.headers !== headers) {
      const row = doc.createElement('tr');
      for (const text of model.headers) {
        const th = doc.createElement('th');
        th.scope = 'col';
        th.textContent = text;
        row.appendChild(th);
      }
      head.replaceChildren(row);
      head.dataset.headers = headers;
    }
    const first = page * model.pageSize;
    const last = Math.min(model.rowCount, first + model.pageSize);
    const rows: HTMLTableRowElement[] = [];
    for (let i = first; i < last; i++) {
      const cells = model.row(i);
      if (!cells) continue;
      const tr = doc.createElement('tr');
      cells.forEach((text, k) => {
        const cell = doc.createElement(k === 0 ? 'th' : 'td');
        if (k === 0) (cell as HTMLTableCellElement).scope = 'row';
        cell.textContent = text;
        tr.appendChild(cell);
      });
      rows.push(tr);
    }
    body.replaceChildren(...rows);
    pager.hidden = count <= 1;
    previous.textContent = texts.previousPage;
    next.textContent = texts.nextPage;
    setAttr(previous, 'lang', texts.lang('previousPage'));
    setAttr(next, 'lang', texts.lang('nextPage'));
    setAttr(status, 'lang', texts.lang('pageOf'));
    setAttr(label, 'lang', texts.lang('jumpToX'));
    setAttr(previous, 'aria-disabled', page === 0 ? 'true' : null);
    setAttr(next, 'aria-disabled', page >= count - 1 ? 'true' : null);
    const pageText = texts.pageOf(page + 1, count);
    // Only a change of page is spoken; a refreshed page (streaming data) keeps its text.
    if (status.textContent !== pageText) status.textContent = pageText;
    labelText.textContent = texts.jump;
  }

  previous.addEventListener('click', () => {
    if (page > 0) { page--; render(); scroll.scrollTop = 0; }
  });
  next.addEventListener('click', () => {
    if (page < pages() - 1) { page++; render(); scroll.scrollTop = 0; }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const value = toValue(field.value.trim());
    const target = value === null || !model ? null : model.pageForX(value);
    if (target === null) {
      field.setAttribute('aria-invalid', 'true');
      return;
    }
    field.removeAttribute('aria-invalid');
    page = target;
    render();
    scroll.scrollTop = 0;
  });

  return {
    element,
    get page() {
      return page;
    },
    update(nextModel, nextTexts, maxHeight) {
      const signature = `${maxHeight}`;
      model = nextModel;
      texts = nextTexts;
      if (signature !== shownSignature) {
        scroll.style.maxHeight = `${Math.floor(maxHeight)}px`;
        shownSignature = signature;
      }
      render();
    },
    showRow(ordinal) {
      if (!model) return;
      page = Math.floor(ordinal / model.pageSize);
      render();
    },
    destroy() {
      element.remove();
      model = null;
    },
  };
}
