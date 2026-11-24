/**
 * "View as table" (spec A4): built only when opened, from the reader model's lazy table, and destroyed when
 * closed. A real table (caption, column headers with units, x values as row headers) inside a focusable,
 * labelled scroll region no taller than the plot, 100 rows per page, with a pager and a "go to" field that
 * jumps to the page holding an x value. Text only, never HTML.
 */
import { Listeners } from './mapping';
import type { TableModel, XValue } from '../core/contracts';
import { activeElementOf, setAttr, make } from './attributes';

export interface TableTexts {
  readonly previousPage: string;
  readonly nextPage: string;
  /** "Page {page} of {count}" filled. */
  pageOf(page: number, count: number): string;
  /** Label of the "go to" field. */
  readonly jump: string;
  /** The error shown when nothing matches what was typed, with an example (the jumpNotFound message). */
  readonly notFound?: (text: string) => string;
  /** `lang` of that error's template ('en' where it is the built-in one on a page in another language). */
  readonly notFoundLang?: string | null;
  /** `lang` for each built-in string, or null. */
  readonly lang: (key: 'previousPage' | 'nextPage' | 'pageOf' | 'jumpToX') => string | null;
  /**
   * A cell's text as runs with their own `lang` (built-in "No data" or "incomplete" marked English on a page
   * in another language, spec A10); absent, a cell is one run in the page's language.
   */
  readonly cell?: (text: string) => readonly { readonly text: string; readonly lang: string | null }[];
}

export interface TableView {
  readonly element: HTMLElement;
  /** A new model (the data or the view changed): the current page is shown again from it. */
  update(model: TableModel, texts: TableTexts, maxHeight: number): void;
  /** Moves focus to the table's scroll region. */
  focus(): void;
  destroy(): void;
}

/**
 * `toValue` turns what the reader typed into an x value the model understands (a number on a number axis,
 * the text otherwise).
 */
export function createTableView(doc: Document, id: string, toValue: (text: string) => XValue | null): TableView {
  const element = make(doc, 'div', 'axylo-table');
  const listening = new Listeners();

  element.id = `${id}-table`;
  const scroll = make(doc, 'div', 'axylo-table-scroll');
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

  const pager = make(doc, 'div', 'axylo-pager');
  const previous = make(doc, 'button', 'axylo-control');
  previous.type = 'button';
  const status = make(doc, 'span', 'axylo-page');
  // The reader moved: saying the new page is an answer to their own action (spec A7).
  status.setAttribute('aria-live', 'off');
  const announcement = make(doc, 'span', 'axylo-visually-hidden');
  announcement.setAttribute('aria-live', 'polite');
  const next = make(doc, 'button', 'axylo-control');
  next.type = 'button';
  const form = make(doc, 'form', 'axylo-jump');
  const label = doc.createElement('label');
  const labelText = doc.createElement('span');
  const field = make(doc, 'input', 'axylo-jump-field');
  field.type = 'text';
  field.id = `${id}-table-jump`;
  field.autocomplete = 'off';
  label.htmlFor = field.id;
  label.appendChild(labelText);
  const error = make(doc, 'p', 'axylo-jump-error');
  error.setAttribute('role', 'status');
  error.id = `${id}-table-jump-error`;
  form.append(label, field, error);
  pager.append(previous, status, next, form, announcement);
  element.append(scroll, pager);

  let model: TableModel | null = null;
  let texts: TableTexts | null = null;
  let page = 0;
  let shownHeight: number | undefined;

  const pages = () => model ? Math.max(1, Math.ceil(model.rowCount / model.pageSize)) : 1;

  /**
   * `reader`: the reader paged or jumped, so the new page is spoken. A render for new data keeps the status
   * region quiet while its count changes (spec A7; review 2, finding 16).
   */
  function render(reader = false): void {
    if (!model || !texts) return;
    const own = texts;
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
        const runs = own.cell?.(text) ?? [{ text, lang: null }];
        if (runs.length === 1) {
          cell.textContent = runs[0]!.text;
          if (runs[0]!.lang) cell.setAttribute('lang', runs[0]!.lang);
        } else {
          for (const run of runs) {
            if (!run.lang) { cell.append(run.text); continue; }
            const span = doc.createElement('span');
            span.lang = run.lang;
            span.textContent = run.text;
            cell.append(span);
          }
        }
        tr.appendChild(cell);
      });
      rows.push(tr);
    }
    body.replaceChildren(...rows);
    // A pager the reader is on does not vanish under them: focus goes to the table first (finding 17).
    if (count <= 1 && pager.contains(activeElementOf(doc, pager))) scroll.focus({ preventScroll: true });
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
    if (status.textContent !== pageText) {
      status.textContent = pageText;
      if (reader) {
        setAttr(announcement, 'lang', texts.lang('pageOf'));
        announcement.textContent = pageText;
      }
    }
    labelText.textContent = texts.jump;
  }

  listening.on(previous, 'click', () => {
    if (page > 0) { page--; render(true); scroll.scrollTop = 0; }
  });
  listening.on(next, 'click', () => {
    if (page < pages() - 1) { page++; render(true); scroll.scrollTop = 0; }
  });
  function clearError(): void {
    if (!field.hasAttribute('aria-invalid')) return;
    field.removeAttribute('aria-invalid');
    field.removeAttribute('aria-describedby');
    error.textContent = '';
  }
  listening.on(field, 'input', clearError);
  listening.on(form, 'submit', event => {
    event.preventDefault();
    // As typed: a category is matched exactly; numbers and dates are trimmed by the parser (finding 18).
    const value = toValue(field.value);
    const target = value === null || !model ? null : model.pageForX(value);
    if (target === null) {
      field.setAttribute('aria-invalid', 'true');
      if (texts?.notFound) {
        setAttr(error, 'lang', texts.notFoundLang ?? null);
        error.textContent = texts.notFound(field.value.trim());
        field.setAttribute('aria-describedby', error.id);
      }
      return;
    }
    clearError();
    page = target;
    render(true);
    scroll.scrollTop = 0;
  });

  return {
    element,
    update(nextModel, nextTexts, maxHeight) {
      model = nextModel;
      texts = nextTexts;
      // The table fills the plot's place (its stylesheet); the height is only a ceiling for the scroll region.
      if (maxHeight !== shownHeight) {
        scroll.style.maxHeight = maxHeight > 0 ? `${Math.floor(maxHeight)}px` : '';
        shownHeight = maxHeight;
      }
      render();
    },
    focus() {
      scroll.focus({ preventScroll: true });
    },
    destroy() {
      listening.clear();
      element.remove();
      model = null;
    },
  };
}
