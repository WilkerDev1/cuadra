// Filtros y vistas guardadas, panel → movimientos y Resumen por categoría: las cifras cuadran entre pantallas.
import type { Page } from '@playwright/test';
import { expect, go, minorOf, test } from './fixtures';

/** Todas las cifras visibles de un texto, en orden. */
function amounts(text: string): number[] {
  return [...text.replace(/\s/g, '').matchAll(/[−-]?RD\$[\d,]+\.\d{2}/g)].map((m) => minorOf(m[0]));
}

async function filterTotals(page: Page) {
  const region = page.getByRole('main').getByRole('region', { name: 'Totales del filtro' });
  await expect(region).toContainText('RD$');
  const [inMinor = 0, outMinor = 0] = amounts(await region.innerText());
  const count = /(\d[\d,]*) movimientos?/.exec(await region.innerText())?.[1] ?? '';
  return { inMinor: Math.abs(inMinor), outMinor: Math.abs(outMinor), count };
}

test('filtro y vista guardada', async ({ page, colmado }) => {
  await go(page, `/e/${colmado}/movimientos`);
  const all = await filterTotals(page);
  await page.getByRole('button', { name: 'Filtros' }).click();
  const sheet = page.getByRole('dialog', { name: 'Filtros' });
  await sheet.getByRole('group', { name: 'Tipo' }).getByRole('button', { name: 'Salida', exact: true }).click();
  await sheet.getByRole('group', { name: 'Categoría' }).getByRole('button', { name: 'Electricidad', exact: true }).click();
  await sheet.getByRole('button', { name: 'Aplicar' }).click();
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(/[?&]f=/);
  const filtered = await filterTotals(page);
  expect(filtered.inMinor).toBe(0);
  expect(filtered.outMinor).toBeGreaterThan(0);
  expect(filtered.outMinor).toBeLessThan(all.outMinor);

  await page.getByRole('button', { name: 'Guardar vista' }).click();
  const save = page.getByRole('dialog', { name: 'Guardar estos filtros como vista' });
  await save.getByRole('textbox', { name: 'Nombre' }).fill('Luz E2E');
  await save.getByRole('button', { name: /^Guardar/ }).click();
  await expect(save).toBeHidden();

  const views = page.getByRole('group', { name: 'Vistas guardadas' });
  await views.getByRole('button', { name: 'Todo', exact: true }).click();
  await expect.poll(async () => (await filterTotals(page)).outMinor).toBe(all.outMinor);
  await views.getByRole('button', { name: 'Luz E2E', exact: true }).click();
  await expect.poll(async () => (await filterTotals(page)).outMinor).toBe(filtered.outMinor);
  // La vista sobrevive a recargar la página.
  await page.reload();
  await expect(page.getByRole('group', { name: 'Vistas guardadas' }).getByRole('button', { name: 'Luz E2E', exact: true })).toBeVisible();
});

test.describe('panel de escritorio', () => {
  test.skip(({ isMobile }) => isMobile, 'el panel con gráfica de flujo es de escritorio');

test('panel: clic en una barra abre sus movimientos con el mismo total', async ({ page, colmado }) => {
  expect(colmado).not.toBe(''); // el fixture deja la página en el Inicio del colmado
  const chart = page.locator('svg.home-flow__svg');
  await expect(chart).toBeVisible();
  // El penúltimo mes: un mes completo del ejemplo.
  const bars = page.locator('.home-flow__m');
  const n = await bars.count();
  expect(n).toBeGreaterThan(2);
  const box = await bars.nth(n - 2).locator('.home-flow__in').boundingBox();
  if (box === null) throw new Error('sin barra');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const tip = page.locator('.home-tip__title').locator('..');
  await expect(tip).toBeVisible();
  const [tipIn = 0, tipOut = 0] = amounts(await tip.innerText()).map(Math.abs);
  expect(tipIn).toBeGreaterThan(0);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page).toHaveURL(/\/movimientos\?/);
  const totals = await filterTotals(page);
  expect(totals.inMinor).toBe(tipIn);
  expect(totals.outMinor).toBe(tipOut);
});
});

test('resumen por categoría y su detalle', async ({ page, colmado, mobile }) => {
  await go(page, `/e/${colmado}/resumen`);
  const main = page.getByRole('main');
  if (mobile) await main.getByRole('button', { name: 'Editar resumen' }).click();
  const controls = mobile ? page.getByRole('dialog', { name: 'Editar resumen' }) : main;
  // Con varias pruebas en paralelo la pantalla puede tardar en atar sus controles: se repite hasta que la URL
  // recoge la agrupación.
  await expect(async () => {
    await controls.getByRole('combobox', { name: 'Agrupar por' }).selectOption({ label: 'Categoría' });
    await expect(page).toHaveURL(/[?&]por=(?!mes)/, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await controls.getByRole('radiogroup', { name: 'Medida' }).getByText('Salidas', { exact: true }).click();
  if (mobile) await controls.getByRole('button', { name: 'Listo' }).click();
  await expect(page).toHaveURL(/medida=salidas/);
  const link = main.getByRole('link', { name: /^Compra de mercancía: / }).first();
  await expect(link).toBeVisible();
  const label = (await link.getAttribute('aria-label')) ?? (await link.innerText());
  const [value = 0] = amounts(label).map(Math.abs);
  expect(value).toBeGreaterThan(0);
  await link.click();
  await expect(page).toHaveURL(/\/movimientos\?/);
  const totals = await filterTotals(page);
  expect(totals.outMinor).toBe(value);
});
