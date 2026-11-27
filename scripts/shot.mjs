#!/usr/bin/env node
// Captura de pantalla de la app en desarrollo, con los datos de ejemplo cargados.
//
//   node scripts/shot.mjs --profile mio --path '/e/@colmado' --size 1440x900 --scheme dark --out docs/screens/x.png
//
// --profile  nombre del perfil de navegador (guarda la base entre corridas; usa uno propio por tarea)
// --path     ruta hash. `@colmado`, `@despacho`, `@personal` se sustituyen por el id del espacio de ejemplo
// --size     ANCHOxALTO (390x844 activa modo táctil)          --scheme  light | dark
// --full     página completa                                   --wait    ms extra antes de capturar
// --click    selector a pulsar antes de capturar (repetible)   --eval    JS a ejecutar en la página (repetible)
// --no-seed  no cargar datos de ejemplo                         --base    URL (por defecto http://localhost:5199)
// --reset    borra el perfil antes de empezar
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const one = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const many = (name) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []));
const has = (name) => args.includes(`--${name}`);

export function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const cache = join(homedir(), '.cache', 'ms-playwright');
  if (existsSync(cache)) {
    const builds = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const b of builds) {
      for (const sub of ['chrome-linux64', 'chrome-linux']) {
        const p = join(cache, b, sub, 'chrome');
        if (existsSync(p)) return p;
      }
    }
  }
  return undefined; // deja que Playwright busque el suyo
}

const PROFILE_NAMES = { colmado: 'Colmado', despacho: 'Estudio', personal: 'Mis finanzas' };

/** Abre la app con un perfil persistente y carga los datos de ejemplo si la base está vacía. */
export async function openApp({ profile = 'default', size = '1440x900', scheme = 'light', base = 'http://localhost:5199', seed = true, reset = false } = {}) {
  const [width, height] = size.split('x').map(Number);
  const dir = join(tmpdir(), 'cuadra-shots', profile);
  if (reset) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const mobile = width < 600;
  const context = await chromium.launchPersistentContext(dir, {
    executablePath: findChromium(),
    headless: true,
    viewport: { width, height },
    colorScheme: scheme,
    deviceScaleFactor: mobile ? 2 : 1,
    hasTouch: mobile,
    isMobile: mobile,
    locale: 'es-DO',
    timezoneId: 'America/Santo_Domingo',
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}/#/`);
  await page.waitForFunction(() => globalThis.__cuadra !== undefined, null, { timeout: 60_000 });
  let spaces = await page.evaluate(() => globalThis.__cuadra.workspaces.list());
  if (seed && spaces.length === 0) {
    await page.evaluate(() => globalThis.__cuadra.demo.seedAll({}), null);
    spaces = await page.evaluate(() => globalThis.__cuadra.workspaces.list());
  }
  const ids = {};
  for (const [key, prefix] of Object.entries(PROFILE_NAMES)) {
    const ws = spaces.find((s) => s.name.startsWith(prefix));
    if (ws) ids[key] = ws.id;
  }
  const go = async (path) => {
    const resolved = path.replace(/@(\w+)/g, (m, k) => ids[k] ?? m);
    await page.goto(`${base}/#${resolved.startsWith('/') ? resolved : `/${resolved}`}`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
  };
  return { context, page, ids, errors, go };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = one('out', 'shot.png');
  const app = await openApp({
    profile: one('profile', 'default'),
    size: one('size', '1440x900'),
    scheme: one('scheme', 'light'),
    base: one('base', 'http://localhost:5199'),
    seed: !has('no-seed'),
    reset: has('reset'),
  });
  try {
    await app.go(one('path', '/'));
    for (const js of many('eval')) await app.page.evaluate(js);
    for (const sel of many('click')) await app.page.click(sel);
    const wait = Number(one('wait', '0'));
    if (wait > 0) await app.page.waitForTimeout(wait);
    mkdirSync(dirname(out), { recursive: true });
    await app.page.screenshot({ path: out, fullPage: has('full') });
    console.log(`captura: ${out}`);
    console.log(`espacios: ${JSON.stringify(app.ids)}`);
    if (app.errors.length > 0) console.log(`errores de consola (${app.errors.length}):\n${app.errors.slice(0, 15).join('\n')}`);
  } finally {
    await app.context.close();
  }
}
