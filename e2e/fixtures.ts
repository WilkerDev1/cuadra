// Base de las pruebas E2E (Oleada 4). Cada prueba abre un perfil de Chromium NUEVO y persistente en una carpeta
// temporal: un contexto de incógnito (el de Playwright por defecto) guarda OPFS en memoria y la carga de los datos
// de ejemplo pasa de ~5 s a ~55 s. El perfil se borra al terminar, así que el contexto sigue siendo limpio.
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

/** El Chromium de la caché de Playwright (la versión que espera @playwright/test no está descargada). */
export function findChromium(): string | undefined {
  if (process.env['CHROMIUM_PATH']) return process.env['CHROMIUM_PATH'];
  const cache = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(cache)) return undefined;
  const builds = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
  for (const b of builds) {
    for (const sub of ['chrome-linux64', 'chrome-linux']) {
      const p = join(cache, b, sub, 'chrome');
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

interface Fixtures {
  /** Errores de consola y excepciones de la página principal: la prueba falla si queda alguno. */
  consoleErrors: string[];
  /** Id del espacio «Colmado La Esquina» tras cargar los datos de ejemplo (y la página ya en su Inicio). */
  colmado: string;
  /** ¿La prueba corre en el proyecto móvil? */
  mobile: boolean;
}

export const test = base.extend<Fixtures>({
  context: async ({ playwright, viewport, isMobile, hasTouch, deviceScaleFactor, userAgent, colorScheme, baseURL }, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'cuadra-e2e-'));
    const executablePath = findChromium();
    const context = await playwright.chromium.launchPersistentContext(dir, {
      ...(executablePath !== undefined ? { executablePath } : {}),
      headless: true,
      viewport,
      isMobile,
      hasTouch,
      ...(deviceScaleFactor !== undefined ? { deviceScaleFactor } : {}),
      ...(userAgent ? { userAgent } : {}),
      colorScheme,
      locale: 'es-DO',
      timezoneId: 'America/Santo_Domingo',
      acceptDownloads: true,
      ...(baseURL ? { baseURL } : {}),
    });
    // Chromium tiene showSaveFilePicker, pero sin pantalla el diálogo nativo se cancela solo. Sin él, la app cae a
    // la descarga normal, que es lo que Playwright sabe recoger (el selector nativo no se puede automatizar).
    await context.addInitScript(() => {
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
    });
    try {
      await use(context);
    } finally {
      await context.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
  page: async ({ context }, use) => {
    const page = context.pages()[0] ?? (await context.newPage());
    await use(page);
  },
  mobile: async ({ isMobile }, use) => use(isMobile),
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(String(e)));
      await use(errors);
      expect(errors, 'errores de consola').toEqual([]);
    },
    { auto: true },
  ],
  colmado: async ({ page }, use) => {
    await use(await loadDemo(page));
  },
});

export { expect };

/** Bienvenida → «Ver con datos de ejemplo» → Inicio del colmado. Devuelve su id. */
export async function loadDemo(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ver con datos de ejemplo' }).click();
  await page.waitForURL(/#\/e\/[^/]+$/, { timeout: 90_000 });
  await expect(page.getByRole('heading', { level: 1, name: /Colmado La Esquina/ })).toBeVisible();
  return wsFromUrl(page);
}

export function wsFromUrl(page: Page): string {
  const m = /#\/e\/([^/?]+)/.exec(page.url());
  if (!m?.[1]) throw new Error(`sin espacio en ${page.url()}`);
  return m[1];
}

/** Navega dentro de la app por la ruta hash. */
export async function go(page: Page, path: string): Promise<void> {
  await page.goto(`/#${path.startsWith('/') ? path : `/${path}`}`);
}

/** Texto visible de una cifra (`RD$1,234.50`, `−RD$350.00`) → unidad menor. */
export function minorOf(text: string): number {
  const clean = text.replace(/\s/g, '');
  const m = /([−-])?[A-Z]*\$?([\d,]+)\.(\d{2})/.exec(clean);
  if (!m) throw new Error(`sin cifra en «${text}»`);
  const sign = m[1] ? -1 : 1;
  return sign * (Number(m[2]!.replace(/,/g, '')) * 100 + Number(m[3]));
}

/** Contexto extra con el mismo perfil (segunda pestaña). */
export async function secondTab(context: BrowserContext): Promise<Page> {
  return context.newPage();
}
