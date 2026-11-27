// Fechas «sueltas» de la captura (DESIGN §10.8): la celda entiende `15`, `ayer`, `-2`, `15/11`, `15/11/2026` e ISO.
// Puras: reciben `today` (lo da el reloj del núcleo) y devuelven ISO o `null` si no se entiende.
import { addDays, addMonths, isIsoDate, type IsoDate } from '../../../core';
import { normalizeSearch } from '../../../core';

const WORDS: Record<string, number> = { hoy: 0, ayer: -1, anteayer: -2, manana: 1 };

function iso(y: number, m: number, d: number): IsoDate | null {
  const text = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isIsoDate(text) ? text : null;
}

/**
 * Interpreta lo que se escribe en una celda de fecha. `15` y `15/11` toman el día más reciente que no sea futuro
 * (el día 15 de este mes o, si aún no llegó, del anterior): en la captura casi siempre se anota lo ya ocurrido.
 */
export function parseLooseDate(text: string, today: IsoDate): IsoDate | null {
  const s = normalizeSearch(text).replace(/\s+/g, '');
  if (s === '') return null;
  if (s in WORDS) return addDays(today, WORDS[s] ?? 0);
  if (/^[+-]\d{1,3}$/.test(s)) return addDays(today, Number(s));
  if (isIsoDate(s)) return s;
  const [ty = 0, tm = 1] = today.split('-').map(Number);
  let m = /^(\d{1,2})$/.exec(s);
  if (m !== null) {
    const day = Number(m[1]);
    const here = iso(ty, tm, day);
    if (here !== null && here <= today) return here;
    const prev = addMonths(`${today.slice(0, 7)}-01`, -1);
    const [py = 0, pm = 1] = prev.split('-').map(Number);
    return iso(py, pm, day) ?? here;
  }
  m = /^(\d{1,2})[/.-](\d{1,2})$/.exec(s);
  if (m !== null) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    const here = iso(ty, month, day);
    if (here !== null && here <= today) return here;
    return iso(ty - 1, month, day) ?? here;
  }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m !== null) {
    const raw = Number(m[3]);
    const year = (m[3] ?? '').length === 2 ? 2000 + raw : raw;
    return iso(year, Number(m[2]), Number(m[1]));
  }
  return null;
}

/** ISO → `27/11/2026` (lo que la celda muestra tras salir de ella; el parser lo vuelve a leer igual). */
export function isoToDmy(value: IsoDate): string {
  const [y = '', m = '', d = ''] = value.split('-');
  return `${d}/${m}/${y}`;
}
