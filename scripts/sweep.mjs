// Barrido de calidad (Oleada 4): todas las rutas × 390/768/1440 × claro/oscuro contra el servidor de desarrollo
// (http://localhost:5199, con la fachada window.__cuadra). Informa errores de consola, claves i18n sin texto (⟦clave⟧) y
// desbordes horizontales. Uso: node scripts/sweep.mjs   [SIZES=390x844 SCHEMES=dark ONLY=regex]
import { openApp } from './shot.mjs';
const sizes = (process.env.SIZES ?? '390x844,768x1024,1440x900').split(',');
const schemes = (process.env.SCHEMES ?? 'light,dark').split(',');
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const results = [];
for (const size of sizes) for (const scheme of schemes) {
  const app = await openApp({ profile: 'sweep', size, scheme });
  const { page, ids } = app;
  const warns = [];
  page.on('console', (m) => { if (m.type() === 'warning' && /i18n/.test(m.text())) warns.push(m.text()); });
  // Espacio vacío (plantilla en blanco) para ver los estados sin datos.
  let empty = await page.evaluate(async () => (await globalThis.__cuadra.workspaces.list()).find((w) => w.name === 'Vacío E2E')?.id);
  if (!empty) empty = await page.evaluate(async () => (await globalThis.__cuadra.templates.apply('blanco', { name: 'Vacío E2E' })).value.id).catch((e) => { console.log('blank', String(e)); return null; });
  const ws = ids.colmado;
  const extra = await page.evaluate(async (ws) => {
    const c = globalThis.__cuadra;
    const tx = (await c.transactions.list({ workspaceId: ws, filter: {}, limit: 1 })).items?.[0]?.id;
    const acc = (await c.accounts.list(ws))[0]?.id;
    const field = (await c.fields.list(ws))[0]?.id;
    const batch = (await c.batches.list(ws))?.[0]?.id ?? (await c.batches.list({ workspaceId: ws }))?.items?.[0]?.id;
    return { tx, acc, field, batch };
  }, ws).catch((e) => ({ err: String(e) }));
  const routes = ['/', '/bienvenida', '/respaldo', '/ajustes', '/plantillas', '/seguridad'];
  for (const w of [ws, ids.despacho, ids.personal, empty].filter(Boolean)) {
    for (const r of ['', 'movimientos', 'cuentas', 'resumen', 'informes', 'informes/resumido', 'informes/detallado', 'captura', 'historial', 'lotes', 'ajustes', 'ajustes/espacio', 'ajustes/cuentas', 'ajustes/campos', 'ajustes/vistas', 'ajustes/plantilla', 'importar', 'nuevo?tipo=salida', 'transferencia']) {
      if (w !== ws && /informes\/|ajustes\/|importar|nuevo|transferencia|captura/.test(r)) continue;
      routes.push(`/e/${w}/${r}`);
    }
  }
  if (extra.tx) routes.push(`/e/${ws}/movimientos/${extra.tx}`);
  if (extra.acc) routes.push(`/e/${ws}/cuentas/${extra.acc}`);
  if (extra.field) routes.push(`/e/${ws}/ajustes/campos/${extra.field}`);
  if (extra.batch) routes.push(`/e/${ws}/lotes/${extra.batch}`);
  for (const r of routes) {
    if (only && !only.test(r)) continue;
    app.errors.length = 0; warns.length = 0;
    await page.goto(`http://localhost:5199/#${r}`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(900);
    const m = await page.evaluate(() => {
      const de = document.documentElement;
      const over = de.scrollWidth - window.innerWidth;
      const culprits = [];
      if (over > 0) {
        for (const el of document.querySelectorAll('body *')) {
          const b = el.getBoundingClientRect();
          if (b.right > window.innerWidth + 1 && b.width > 0 && getComputedStyle(el).position !== 'fixed') {
            let p = el.parentElement, clipped = false;
            while (p) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') { clipped = true; break; } p = p.parentElement; }
            if (!clipped) culprits.push((el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : el.tagName) + ':' + Math.round(b.right));
          }
          if (culprits.length > 4) break;
        }
      }
      const text = document.body.innerText;
      const keys = [...text.matchAll(/⟦[^⟧]+⟧/g)].map((x) => x[0]);
      return { over, culprits, keys };
    });
    const bad = app.errors.length || m.over > 0 || m.keys.length || warns.length;
    results.push({ size, scheme, r, ...m, errors: [...app.errors], warns: [...warns] });
    if (bad) console.log(`${size} ${scheme} ${r.replace(/[0-9a-f-]{36}/g, ':id')} over=${m.over} ${m.culprits.join(' ')} keys=${m.keys.join(',')} errs=${app.errors.slice(0, 2).map((e) => e.slice(0, 160)).join(' | ')} warns=${warns.slice(0,2).join('|')}`);
  }
  await app.context.close();
}
const bad = results.filter((x) => x.errors.length || x.over > 0 || x.keys.length || x.warns.length);
console.log(`visitas ${results.length}, con problemas ${bad.length}`);
