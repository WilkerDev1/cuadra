import { useId, type ReactNode } from 'react';
import { cx } from '../lib';

export interface TableColumn<R> {
  key: string;
  /** Cabecera (en mayúsculas pequeñas por CSS) y etiqueta en el modo apilado. */
  header: string;
  /** Números a la derecha; nunca centrados. */
  align?: 'start' | 'end';
  /** Cifra tabular. */
  numeric?: boolean;
  /** Celda que ocupa el espacio sobrante (concepto) con elipsis. */
  grow?: boolean;
  /** Ancho fijo (`8rem`). */
  width?: string;
  render: (row: R, index: number) => ReactNode;
  /** Pie (totales). */
  footer?: ReactNode;
  /** Ocultar en el modo apilado (< 640px). */
  hideStacked?: boolean;
}

export interface TableProps<R> {
  /** `ledger` movimientos, `summary` resúmenes, `grid` captura editable (celdas con inputs). */
  variant?: 'ledger' | 'summary' | 'grid';
  /** Título accesible de la tabla (visible o no). */
  caption: string;
  hideCaption?: boolean;
  columns: readonly TableColumn<R>[];
  rows: readonly R[];
  rowKey: (row: R) => string;
  /** Fila seleccionada (fondo --surface-2 y borde izquierdo de tinta). */
  selectedKey?: string | null;
  /** Activa la fila con clic, Enter o Espacio (la fila es enfocable). */
  onRowClick?: (row: R) => void;
  /** Filas anuladas: tachadas y sin sumar. */
  isVoided?: (row: R) => boolean;
  /** Pie con doble raya (totales del grupo). */
  footer?: boolean;
  /** Densidad compacta (`--fila-densa`). */
  dense?: boolean;
  empty?: ReactNode;
  /** `false`: la tabla no impone `overflow` ni foco al contenedor; el padre decide el desplazamiento. Por defecto `true`. */
  scroll?: boolean;
  className?: string;
}

/** Tabla densa con cabecera sticky; bajo 640px de contenedor se apila con etiquetas de `data-label`. */
export function Table<R>({ variant = 'ledger', caption, hideCaption = true, columns, rows, rowKey, selectedKey, onRowClick, isVoided, footer, dense, empty, scroll = true, className }: TableProps<R>) {
  const captionId = useId();
  return (
    <div className={cx('ui-table-wrap', scroll === false && 'ui-table-wrap--static', className)} {...(scroll ? { role: 'region', 'aria-labelledby': captionId, tabIndex: 0 } : {})}>
      <table className={cx('ui-table', `ui-table--${variant}`, dense === true && 'ui-table--dense')}>
        <caption id={captionId} className={hideCaption ? 'visually-hidden' : 'ui-table__caption'}>
          {caption}
        </caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cx(c.align === 'end' && 'is-end', c.grow === true && 'is-grow')} style={c.width === undefined ? undefined : { inlineSize: c.width }}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && empty !== undefined ? (
            <tr className="ui-table__empty">
              <td colSpan={columns.length}>{empty}</td>
            </tr>
          ) : null}
          {rows.map((row, i) => {
            const key = rowKey(row);
            return (
              <tr
                key={key}
                aria-selected={selectedKey === undefined ? undefined : selectedKey === key}
                data-voided={isVoided?.(row) === true || undefined}
                className={cx(onRowClick !== undefined && 'is-clickable')}
                tabIndex={onRowClick === undefined ? undefined : 0}
                onClick={onRowClick === undefined ? undefined : () => onRowClick(row)}
                onKeyDown={
                  onRowClick === undefined
                    ? undefined
                    : (e) => {
                        // Solo si la tecla llega a la fila misma: los botones y campos de las celdas conservan la suya.
                        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          onRowClick(row);
                        }
                      }
                }
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    data-label={c.header}
                    className={cx(c.align === 'end' && 'is-end', c.numeric === true && 'num', c.grow === true && 'is-grow', c.hideStacked === true && 'is-hide-stacked')}
                  >
                    {c.render(row, i)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
        {footer === true ? (
          <tfoot>
            <tr>
              {columns.map((c) => (
                <td key={c.key} data-label={c.header} className={cx(c.align === 'end' && 'is-end', c.numeric === true && 'num', c.footer === undefined && 'is-hide-stacked')}>
                  {c.footer}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
