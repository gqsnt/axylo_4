/**
 * "View as table" (spec A4): built lazily when opened, destroyed when closed. Text only, never HTML.
 */
import { Listeners } from './mapping';
import type { TableModel, XValue } from '../core/contracts';
import { activeElementOf, announceText, focusQuiet, make, setAttr, setLanguageText } from './attributes';

export interface TableTexts {
  readonly previousPage: string;
  readonly nextPage: string;
  pageOf(page: number, count: number): string;
  readonly jump: string;
  readonly notFound?: (text: string) => string;
  readonly notFoundLang?: string | null;
  readonly lang: (key: 'previousPage' | 'nextPage' | 'pageOf' | 'jumpToX') => string | null;
  readonly cell?: (text: string) => readonly { readonly text: string; readonly lang: string | null }[];
}

export interface TableView {
  readonly element: HTMLElement;
  update(model: TableModel, texts: TableTexts, maxHeight: number): void;
  focus(): void;
  destroy(): void;
}

export function createTableView(doc: Document, id: string, toValue: (text: string) => XValue | null): TableView {
  const listening = new Listeners();
  const element = make(doc, 'div', 'axylo-table');
  element.id = `${id}-table`;
  const scroll = make(doc, 'div', 'axylo-table-scroll');
  scroll.tabIndex = 0;
  const table = doc.createElement('table'), caption = doc.createElement('caption');
  const head = doc.createElement('thead'), body = doc.createElement('tbody');
  caption.id = `${id}-table-caption`;
  setAttr(scroll, 'role', 'region');
  setAttr(scroll, 'aria-labelledby', caption.id);
  table.append(caption, head, body);
  scroll.appendChild(table);

  const pager = make(doc, 'div', 'axylo-pager');
  const previous = make(doc, 'button', 'axylo-control'), next = make(doc, 'button', 'axylo-control');
  previous.type = next.type = 'button';
  const status = make(doc, 'span', 'axylo-page'), announcement = make(doc, 'span', 'axylo-visually-hidden');
  setAttr(status, 'aria-live', 'off');
  setAttr(announcement, 'aria-live', 'polite');
  const form = make(doc, 'form', 'axylo-jump'), label = doc.createElement('label'), labelText = doc.createElement('span');
  const field = make(doc, 'input', 'axylo-jump-field');
  field.type = 'text';
  field.id = `${id}-table-jump`;
  field.autocomplete = 'off';
  label.htmlFor = field.id;
  label.appendChild(labelText);
  const error = make(doc, 'p', 'axylo-jump-error');
  setAttr(error, 'role', 'status');
  error.id = `${id}-table-jump-error`;
  form.append(label, field, error);
  pager.append(previous, status, next, form, announcement);
  element.append(scroll, pager);

  let model: TableModel | null = null, texts: TableTexts | null = null, page = 0, shownHeight: number | undefined;
  // The rows shown, each with the cells and language runs it was made from.
  const rows: { r: HTMLTableRowElement; s: string }[] = [];
  const pages = () => model ? Math.max(1, Math.ceil(model.rowCount / model.pageSize)) : 1;
  const go = (p: number) => { page = p; render(true); scroll.scrollTop = 0; };

  function render(reader = false): void {
    if (!model || !texts) return;
    const t = texts, count = pages();
    page = Math.max(0, Math.min(page, count - 1));
    const headers = model.headers.join('\0');
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
    const first = page * model.pageSize, last = Math.min(model.rowCount, first + model.pageSize);
    let n = 0;
    for (let i = first; i < last; i++) {
      const cells = model.row(i);
      if (!cells) continue;
      const runs = cells.map(text => t.cell?.(text)), sig = JSON.stringify([cells, runs]), kept = rows[n];
      // A row that reads the same is kept: replacing it would move an assistive technology's reading cursor (A4).
      if (kept?.s === sig) { n++; continue; }
      const tr = doc.createElement('tr');
      cells.forEach((text, k) => {
        const cell = doc.createElement(k ? 'td' : 'th');
        if (!k) (cell as HTMLTableCellElement).scope = 'row';
        const cellRuns = runs[k];
        if (!cellRuns || cellRuns.length === 1) {
          cell.textContent = cellRuns ? cellRuns[0]!.text : text;
          if (cellRuns?.[0]!.lang) setAttr(cell, 'lang', cellRuns[0]!.lang);
        } else {
          for (const r of cellRuns) {
            if (!r.lang) { cell.append(r.text); continue; }
            const s = doc.createElement('span');
            s.lang = r.lang; s.textContent = r.text;
            cell.append(s);
          }
        }
        tr.appendChild(cell);
      });
      if (kept) { body.insertBefore(tr, kept.r); kept.r.remove(); } else body.appendChild(tr);
      rows[n++] = { r: tr, s: sig };
    }
    for (const { r } of rows.splice(n)) r.remove();
    if (count <= 1 && pager.contains(activeElementOf(doc, pager))) focusQuiet(scroll);
    pager.hidden = count <= 1;
    const pageLang = t.lang('pageOf');
    setLanguageText(previous, t.previousPage, t.lang('previousPage'));
    setLanguageText(next, t.nextPage, t.lang('nextPage'));
    labelText.textContent = t.jump;
    setAttr(status, 'lang', pageLang);
    setAttr(label, 'lang', t.lang('jumpToX'));
    setAttr(previous, 'aria-disabled', page === 0 ? 'true' : null);
    setAttr(next, 'aria-disabled', page >= count - 1 ? 'true' : null);
    const pageText = t.pageOf(page + 1, count);
    if (status.textContent !== pageText) {
      status.textContent = pageText;
      if (reader) announceText(announcement, pageText, pageLang);
    }
  }

  function clearError(): void {
    if (!field.hasAttribute('aria-invalid')) return;
    setAttr(field, 'aria-invalid', null);
    setAttr(field, 'aria-describedby', null);
    error.textContent = '';
  }

  listening.on(previous, 'click', () => { if (page > 0) go(page - 1); });
  listening.on(next, 'click', () => { if (page < pages() - 1) go(page + 1); });
  listening.on(field, 'input', clearError);
  listening.on(form, 'submit', e => {
    e.preventDefault();
    const val = toValue(field.value), target = val === null || !model ? null : model.pageForX(val);
    if (target === null) {
      setAttr(field, 'aria-invalid', 'true');
      if (texts?.notFound) {
        setAttr(error, 'lang', texts.notFoundLang ?? null);
        error.textContent = texts.notFound(field.value.trim());
        setAttr(field, 'aria-describedby', error.id);
      }
      return;
    }
    clearError();
    go(target);
  });

  return {
    element,
    update(nextModel, nextTexts, maxHeight) {
      model = nextModel; texts = nextTexts;
      if (maxHeight !== shownHeight) { scroll.style.maxHeight = maxHeight > 0 ? `${Math.floor(maxHeight)}px` : ''; shownHeight = maxHeight; }
      render();
    },
    focus() { focusQuiet(scroll); },
    destroy() { listening.clear(); element.remove(); model = null; },
  };
}
