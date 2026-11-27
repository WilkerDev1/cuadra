// Ficha flotante de las gráficas del panel: sale junto al punto o la barra fijados (cursor o teclado), hacia el
// lado con más sitio, y nunca tapa lo que señala. Es solo visual (aria-hidden): cada gráfica anuncia lo mismo en
// su región aria-live.
import type { CSSProperties, ReactNode } from 'react';
import { cx } from '../../../ui';
import { tipSide } from '../logic/chart';

export interface ChartTipProps {
  /** Punto señalado en píxeles del lienzo. */
  x: number;
  width: number;
  /** Distancia lateral al punto (la mitad de la barra, o el radio del punto, más aire). */
  gap?: number;
  className?: string;
  children: ReactNode;
}

export function ChartTip({ x, width, gap = 12, className, children }: ChartTipProps) {
  const side = tipSide(x, width);
  const style = { '--tip-x': `${side === 'right' ? x + gap : x - gap}px` } as CSSProperties;
  return (
    <div className={cx('home-tip', `home-tip--${side}`, className)} style={style} aria-hidden="true">
      {children}
    </div>
  );
}

/** Fila «etiqueta · cifra» de la ficha. */
export function TipRow({ label, children, strong = false }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className={cx('home-tip__row', strong && 'home-tip__row--strong')}>
      <span className="home-tip__label">{label}</span>
      <span className="home-tip__fig">{children}</span>
    </div>
  );
}
