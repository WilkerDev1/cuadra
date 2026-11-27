// Rejilla editable de la Captura (DESIGN §10.8). Tab pasa de celda en celda (orden natural del DOM), Enter baja a
// la misma columna de la fila siguiente, las flechas mueven entre celdas, Alt+↓ copia la de arriba y Ctrl+D la
// fila de arriba. Pegar texto tabulado de Excel rellena desde la celda activa. Los errores se ven al salir de la fila.
import { CircleAlert, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ClipboardEvent, type FocusEvent, type KeyboardEvent } from 'react';
import { normalizeSearch } from '../../../core';
import { useT } from '../../../i18n';
import { IconButton, cx } from '../../../ui';
import {
  applyPaste,
  completeOption,
  copyFromAbove,
  duplicateAbove,
  ensureTrailingRow,
  isRowBlank,
  isTabular,
  moveFocus,
  normalizeCell,
  parseTsv,
  setCell,
  type CellIssue,
  type EvalContext,
  type GridColumn,
  type GridRow,
  type Move,
  type RowResult,
} from '../logic/grid';

export interface CaptureGridProps {
  caption: string;
  columns: readonly GridColumn[];
  rows: readonly GridRow[];
  onRowsChange: (rows: GridRow[]) => void;
  results: readonly RowResult[];
  /** Errores que devolvió el núcleo (vista previa) por índice de fila, ya traducidos. */
  serverErrors: ReadonlyMap<number, string>;
  /** Tras intentar guardar: todos los errores a la vista, también los de filas no visitadas. */
  showAll: boolean;
  ctx: EvalContext;
  /** Texto de la fecha por defecto del lote (placeholder de la columna Fecha). */
  defaultDate: string;
  makeId: () => string;
  onSave: () => void;
  /** Pide enfocar la primera celda con error (tras un guardado fallido). */
  focusErrorSignal: number;
}

const cellKey = (rowId: string, col: string) => `${rowId}|${col}`;

export function CaptureGrid({ caption, columns, rows, onRowsChange, results, serverErrors, showAll, ctx, defaultDate, makeId, onSave, focusErrorSignal }: CaptureGridProps) {
  const t = useT('capture');
  const captionId = useId();
  const cells = useRef(new Map<string, HTMLInputElement>());
  const pending = useRef<{ row: number; col: number } | null>(null);
  // Autocompletado en línea: la parte sugerida queda seleccionada justo tras pintar (antes de la tecla siguiente).
  const selection = useRef<{ key: string; from: number; to: number } | null>(null);
  const [visited, setVisited] = useState<ReadonlySet<string>>(new Set());
  const [announce, setAnnounce] = useState('');
  // ¿Hay columnas pasando por debajo de Monto (fijo a la derecha)? Entonces su borde lleva sombra: la columna cortada
  // («MÉTODO I…») se lee como «sigue debajo», no como una etiqueta rota.
  const scroller = useRef<HTMLDivElement>(null);
  const [under, setUnder] = useState(false);
  useEffect(() => {
    const el = scroller.current;
    if (el === null) return;
    const check = () => setUnder(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    check();
    el.addEventListener('scroll', check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild !== null) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', check);
      ro.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    const sel = selection.current;
    if (sel !== null) {
      selection.current = null;
      cells.current.get(sel.key)?.setSelectionRange(sel.from, sel.to);
    }
    const p = pending.current;
    if (p === null) return;
    pending.current = null;
    const row = rows[p.row];
    const col = columns[p.col];
    if (row === undefined || col === undefined) return;
    const el = cells.current.get(cellKey(row.id, col.key));
    el?.focus();
    if (el !== undefined && el.type !== 'checkbox') el.select();
  });

  useEffect(() => {
    if (focusErrorSignal === 0) return;
    for (const r of results) {
      const issue = r.issues[0];
      const row = rows[r.index];
      if (issue === undefined || row === undefined) continue;
      cells.current.get(cellKey(row.id, issue.col))?.focus();
      return;
    }
  }, [focusErrorSignal]);

  const commit = (next: GridRow[]) => onRowsChange(ensureTrailingRow(next, makeId));
  const go = (row: number, col: number) => {
    pending.current = { row, col };
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>, row: number, col: number) => {
    const el = e.currentTarget;
    const colDef = columns[col]!;
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      onSave();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      commit(duplicateAbove(rows, row));
      go(row, col);
      return;
    }
    if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault();
      commit(copyFromAbove(rows, row, colDef.key));
      go(row, col);
      return;
    }
    let move: Move | null = null;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.nativeEvent.isComposing || e.keyCode === 229) return; // ime-safe-enter-submit
      move = 'enter';
    } else if (e.key === 'ArrowUp') move = 'up';
    else if (e.key === 'ArrowDown') move = 'down';
    else if (e.key === 'ArrowLeft' && (el.type === 'checkbox' || (el.selectionStart === 0 && el.selectionEnd === 0))) move = 'left';
    else if (e.key === 'ArrowRight' && (el.type === 'checkbox' || (el.selectionStart === el.value.length && el.selectionEnd === el.value.length))) move = 'right';
    if (move === null) return;
    e.preventDefault();
    const next = moveFocus({ row, col }, move, rows.length, columns.length);
    const target = rows[next.row];
    const colTarget = columns[next.col];
    if (target === undefined || colTarget === undefined) return;
    const dest = cells.current.get(cellKey(target.id, colTarget.key));
    dest?.focus();
    if (dest !== undefined && dest.type !== 'checkbox') dest.select();
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>, row: number, col: number) => {
    const text = e.clipboardData.getData('text/plain');
    if (!isTabular(text)) return;
    e.preventDefault();
    const r = applyPaste(rows, { row, col }, parseTsv(text), columns, makeId);
    // Lo pegado se muestra ya interpretado (fechas a dd/mm/aaaa, listas con su nombre completo).
    const touched = new Set(r.rows.slice(row, row + r.filledRows).map((x) => x.id));
    const normalized = r.rows.map((x) =>
      touched.has(x.id)
        ? { ...x, cells: Object.fromEntries(columns.map((c) => [c.key, normalizeCell(c, x.cells[c.key] ?? '', ctx)]).filter(([, v]) => v !== '')) }
        : x,
    );
    onRowsChange(normalized);
    setAnnounce(t(r.headerUsed ? 'grid.pastedHeader' : 'grid.pasted', { n: r.filledRows }));
  };

  const onBlurCell = (e: FocusEvent<HTMLInputElement>, row: GridRow, index: number, col: GridColumn) => {
    const next = e.relatedTarget as HTMLElement | null;
    const leftRow = next === null || next.closest('tr') !== e.currentTarget.closest('tr');
    if (leftRow && !isRowBlank(row) && !visited.has(row.id)) setVisited((v) => new Set(v).add(row.id));
    const raw = row.cells[col.key] ?? '';
    const normalized = normalizeCell(col, raw, ctx);
    if (normalized !== raw) commit(setCell(rows, index, col.key, normalized));
  };

  const issueText = (issue: CellIssue) => t(`grid.issue.${issue}`);

  return (
    <div ref={scroller} className="cap-grid" role="region" aria-labelledby={captionId} tabIndex={0} data-under={under || undefined}>
      <table className="cap-grid__table">
        <caption id={captionId} className="visually-hidden">
          {caption}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="cap-grid__n">
              <span className="visually-hidden">{t('grid.rowNumber')}</span>
            </th>
            {columns.map((c) => (
              <th key={c.key} scope="col" title={c.label} className={cx(`cap-grid__h--${c.kind}`, c.field !== undefined && `cap-grid__h--${c.field.type}`)}>
                {c.label}
              </th>
            ))}
            <th scope="col" className="cap-grid__x">
              <span className="visually-hidden">{t('grid.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            const res = results[ri];
            const show = showAll || visited.has(row.id);
            const issues = show ? (res?.issues ?? []) : [];
            const server = show && issues.length === 0 ? serverErrors.get(ri) : undefined;
            const hasError = issues.length > 0 || server !== undefined;
            const blank = isRowBlank(row);
            const rowLabel = t('grid.row', { n: ri + 1 });
            return (
              <tr key={row.id} className={cx(hasError && 'is-error', blank && 'is-blank')}>
                <th scope="row" className="cap-grid__n">
                  <span className="num">{ri + 1}</span>
                  {hasError ? (
                    <span className="cap-grid__flag" title={[...issues.map((i) => issueText(i.issue)), server].filter(Boolean).join(' · ')}>
                      <CircleAlert aria-hidden="true" />
                      <span className="visually-hidden">{t('grid.rowHasErrors')}</span>
                    </span>
                  ) : null}
                </th>
                {columns.map((col, ci) => {
                  const issue = issues.find((i) => i.col === col.key);
                  const errId = `${captionId}-${row.id}-${col.key}-e`;
                  const value = row.cells[col.key] ?? '';
                  const register = (el: HTMLInputElement | null) => {
                    const k = cellKey(row.id, col.key);
                    if (el === null) cells.current.delete(k);
                    else cells.current.set(k, el);
                  };
                  const common = {
                    ref: register,
                    'aria-label': `${col.label}, ${rowLabel}`,
                    'aria-invalid': issue !== undefined,
                    ...(issue === undefined ? {} : { 'aria-describedby': errId, title: issueText(issue.issue) }),
                    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => onKey(e, ri, ci),
                    onPaste: (e: ClipboardEvent<HTMLInputElement>) => onPaste(e, ri, ci),
                    onBlur: (e: FocusEvent<HTMLInputElement>) => onBlurCell(e, row, ri, col),
                  };
                  const isBool = col.kind === 'field' && col.field?.type === 'bool';
                  const isList = col.kind === 'field' && col.field?.type === 'list';
                  const numeric = col.kind === 'amount' || (col.kind === 'field' && col.field?.type === 'number');
                  return (
                    <td key={col.key} className={cx('cap-cell', `cap-cell--${col.kind}`, isList && 'cap-cell--list', isBool && 'cap-cell--bool', numeric && 'cap-cell--num', issue !== undefined && 'cap-cell--warn')}>
                      {isBool ? (
                        <input
                          {...common}
                          type="checkbox"
                          className="cap-cell__check"
                          checked={normalizeSearch(value) === 'si' || value === '1' || normalizeSearch(value) === 'x'}
                          onChange={(e) => commit(setCell(rows, ri, col.key, e.currentTarget.checked ? 'sí' : ''))}
                        />
                      ) : (
                        <input
                          {...common}
                          type="text"
                          className={cx('cap-cell__input', numeric && 'num')}
                          value={value}
                          autoComplete="off"
                          spellCheck={col.kind === 'description' || (col.kind === 'field' && col.field?.type === 'text')}
                          inputMode={numeric ? 'decimal' : undefined}
                          enterKeyHint="next"
                          placeholder={col.kind === 'date' ? defaultDate : undefined}
                          onChange={(e) => {
                            let v = e.currentTarget.value;
                            const typing = !(e.nativeEvent as InputEvent).inputType?.startsWith('delete');
                            let completed: { from: number; to: number } | null = null;
                            if (isList && typing && col.field !== undefined) {
                              const label = completeOption(v, col.field.options);
                              if (label !== null && label.length > v.length) {
                                completed = { from: v.length, to: label.length };
                                v = v + label.slice(v.length);
                              }
                            }
                            if (completed !== null) selection.current = { key: cellKey(row.id, col.key), ...completed };
                            commit(setCell(rows, ri, col.key, v));
                          }}
                        />
                      )}
                      {issue === undefined ? null : (
                        <span id={errId} className="visually-hidden">
                          {issueText(issue.issue)}
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="cap-grid__x">
                  {blank ? null : (
                    <IconButton
                      label={t('grid.removeRow', { n: ri + 1 })}
                      icon={X}
                      onClick={() => {
                        commit(rows.filter((_, i) => i !== ri));
                        go(Math.min(ri, rows.length - 2), 1);
                      }}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="visually-hidden" role="status" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}
