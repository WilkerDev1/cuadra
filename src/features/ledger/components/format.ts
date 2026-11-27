// Textos de fecha del libro: «Hoy», «Ayer», «Martes 24 nov», con año si no es el actual.
import { getLocale } from '../../../i18n/format';

const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(key: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const id = `${getLocale()}|${key}`;
  let f = cache.get(id);
  if (f === undefined) {
    f = new Intl.DateTimeFormat(getLocale(), { ...opts, timeZone: 'UTC' });
    cache.set(id, f);
  }
  return f;
}

const noon = (iso: string) => new Date(`${iso}T12:00:00Z`);
const clean = (s: string) => s.replace(/,/g, '').replace(/ de /g, ' ').replace(/\./g, '');
const capital = (s: string) => s.charAt(0).toLocaleUpperCase(getLocale()) + s.slice(1);

export function dayHeader(iso: string, today: string, t: (k: string) => string): string {
  if (iso === today) return t('ledger.day.today');
  const y = new Date(`${today}T12:00:00Z`);
  y.setUTCDate(y.getUTCDate() - 1);
  if (iso === y.toISOString().slice(0, 10)) return t('ledger.day.yesterday');
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  const f = sameYear
    ? fmt('day', { weekday: 'long', day: 'numeric', month: 'short' })
    : fmt('dayY', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
  return capital(clean(f.format(noon(iso))));
}

/** «Martes 24 nov 2026». */
export function longDate(iso: string): string {
  return capital(clean(fmt('long', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }).format(noon(iso))));
}

/** «24 nov», con año («24 nov 2025») si no es el de `today`: para metas de fila que deben caber en móvil. */
export function shortDate(iso: string, today: string): string {
  const f = iso.slice(0, 4) === today.slice(0, 4) ? fmt('short', { day: 'numeric', month: 'short' }) : fmt('shortY', { day: 'numeric', month: 'short', year: 'numeric' });
  return clean(f.format(noon(iso)));
}

/** «26 nov 2026, 14:32» en la hora local del equipo. */
export function dateTime(ts: string): string {
  const d = new Date(ts);
  const date = clean(new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(d));
  const time = new Intl.DateTimeFormat(getLocale(), { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${date}, ${time}`;
}

/** Fecha local (AAAA-MM-DD) de una marca de tiempo. */
export function localDay(ts: string): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
