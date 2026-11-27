// La cinta de sumadora (DESIGN §10.8) y la minicinta de la Ráfaga (§10.9): líneas `+ 1,500.00` / `− 350.00`
// en ancho 75, suma, control y diferencia; cuando la diferencia llega a 0 imprime «Cuadra.» con el sello.
import type { ReactNode } from 'react';
import type { Minor, TxKind } from '../../../core';
import { useT } from '../../../i18n';
import { AmountText, DoubleRule, Stamp, cx } from '../../../ui';
import { useCurrency } from '../hooks';

export interface TapeLine {
  id: string;
  minor: Minor;
  kind: TxKind;
  description: string;
}

export interface TapeTotalsProps {
  sumMinor: Minor;
  controlMinor: Minor | null;
  /** Etiqueta accesible de la suma. */
  count: number;
}

/** Pie de la cinta: Suma, Control y «Faltan/Sobran …» o «Cuadra.» con doble raya y sello. */
export function TapeTotals({ sumMinor, controlMinor, count }: TapeTotalsProps) {
  const t = useT('capture');
  const currency = useCurrency();
  const diff = controlMinor === null ? null : controlMinor - sumMinor;
  return (
    <div className="cap-tape__foot" role="status" aria-live="polite">
      <p className="cap-tape__total">
        <span>{t('tape.sum', { n: count })}</span>
        <AmountText minor={sumMinor} size="m" currency={currency} neutral animate />
      </p>
      {controlMinor === null ? null : (
        <p className="cap-tape__total cap-tape__total--muted">
          <span>{t('tape.control')}</span>
          <AmountText minor={controlMinor} size="m" currency={currency} neutral />
        </p>
      )}
      {diff === null ? null : diff === 0 ? (
        <div className="cap-tape__square">
          <DoubleRule animate animateKey={sumMinor} />
          <p className="cap-tape__cuadra">
            <span>{t('tape.square')}</span>
            <Stamp animate size="2.25rem" label={t('tape.squareLabel')} />
          </p>
        </div>
      ) : (
        <p className="cap-tape__total cap-tape__total--warn">
          <span>{diff > 0 ? t('tape.missing') : t('tape.over')}</span>
          <AmountText minor={Math.abs(diff)} size="m" currency={currency} neutral />
        </p>
      )}
    </div>
  );
}

export interface TapeProps {
  lines: readonly TapeLine[];
  sumMinor: Minor;
  controlMinor: Minor | null;
  title: string;
  empty?: ReactNode;
  className?: string;
}

/** Cinta completa (panel derecho de la Captura en escritorio). */
export function Tape({ lines, sumMinor, controlMinor, title, empty, className }: TapeProps) {
  const currency = useCurrency();
  return (
    <section className={cx('cap-tape', className)} aria-label={title}>
      <ol className="cap-tape__lines">
        {lines.length === 0 && empty !== undefined ? <li className="cap-tape__empty">{empty}</li> : null}
        {lines.map((l) => (
          <li key={l.id} className="cap-tape__line">
            <AmountText minor={l.minor} kind={l.kind} size="row" symbol={false} currency={currency} />
          </li>
        ))}
      </ol>
      <TapeTotals sumMinor={sumMinor} controlMinor={controlMinor} count={lines.length} />
    </section>
  );
}

/** Minicinta: las últimas 3 líneas anotadas en esta hoja y su suma (Ráfaga desde «+ otro»). */
export function MiniTape({ lines, controlMinor = null, onSelect, selected }: { lines: readonly TapeLine[]; controlMinor?: Minor | null; onSelect?: (index: number) => void; selected?: number | null }) {
  const t = useT('capture');
  const currency = useCurrency();
  let sum = 0;
  for (const l of lines) sum += l.minor;
  const last = lines.map((line, index) => ({ line, index })).slice(-3).reverse();
  return (
    <section className="cap-mini" aria-label={t('tape.mini')}>
      <ol className="cap-mini__lines">
        {last.map(({ line, index }) => {
          const body = (
            <>
              <span className="cap-mini__desc truncate">{line.description}</span>
              <AmountText minor={line.minor} kind={line.kind} size="row" symbol={false} currency={currency} />
            </>
          );
          return (
            <li key={line.id}>
              {onSelect === undefined ? (
                <span className="cap-mini__line">{body}</span>
              ) : (
                <button type="button" className="cap-mini__line" aria-pressed={selected === index} onClick={() => onSelect(index)} aria-label={t('tape.fix', { name: line.description })}>
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      <TapeTotals sumMinor={sum} controlMinor={controlMinor} count={lines.length} />
    </section>
  );
}
