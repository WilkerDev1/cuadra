// Piezas comunes del inicio: ancho medido, porcentajes y comparaciones en texto llano.
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useMoneyFormat } from '../../../app/data/hooks';
import type { Minor } from '../../../core';
import { useT } from '../../../i18n';
import { getLocale } from '../../../i18n/format';
import { changeRatio } from '../logic/chart';

/** Ancho real del contenedor, para dibujar el SVG en píxeles (trazos nítidos). */
export function useWidth<T extends HTMLElement>(fallback: number): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (el === null || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setW(Math.max(120, Math.round(entry.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function formatPct(ratio: number): string {
  return new Intl.NumberFormat(getLocale(), { style: 'percent', maximumFractionDigits: Math.abs(ratio) < 0.1 ? 1 : 0 }).format(Math.abs(ratio));
}

/** «12 % más que octubre 2026» / «Igual que…» / «Nada en…»; si el signo cambia, «En octubre: +RD$…». */
export function useCompare(): (cur: Minor, prev: Minor, prevLabel: string) => string {
  const t = useT();
  const fmt = useMoneyFormat();
  return (cur, prev, prevLabel) => {
    if (cur !== 0 && prev !== 0 && cur < 0 !== prev < 0) return t('home.compare.flip', { period: prevLabel, amount: fmt(prev, { sign: 'always' }) });
    const r = changeRatio(cur, prev);
    if (r === null) return cur === 0 ? t('home.compare.same', { period: prevLabel }) : t('home.compare.none', { period: prevLabel });
    if (Math.abs(r) < 0.005) return t('home.compare.same', { period: prevLabel });
    return t(r > 0 ? 'home.compare.more' : 'home.compare.less', { pct: formatPct(r), period: prevLabel });
  };
}

/** Mes corto para ejes: «nov», y «ene 26» al cambiar de año. */
export function shortMonth(key: string, withYear = false): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, 15));
  const month = new Intl.DateTimeFormat(getLocale(), { month: 'short', timeZone: 'UTC' }).format(d).replace('.', '');
  return withYear ? `${month} ${String(y).slice(2)}` : month;
}

/** «noviembre 2026». */
export function longMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, 15));
  return new Intl.DateTimeFormat(getLocale(), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d).replace(' de ', ' ');
}
