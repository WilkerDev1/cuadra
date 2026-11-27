// Guardar un espacio como plantilla y crear otro desde ese archivo: trae la estructura, no los movimientos.
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { expect, go, test } from './fixtures';

test('guardar espacio como plantilla y crear desde ella', async ({ page, colmado }) => {
  await go(page, `/e/${colmado}/ajustes/plantilla`);
  const card = page.getByRole('region', { name: 'Guardar un espacio como plantilla' });
  await card.getByRole('textbox', { name: 'Nombre de la plantilla' }).fill('Colmado E2E');
  const [download] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: 'Descargar plantilla' }).click()]);
  const file = join(test.info().outputDir, download.suggestedFilename());
  await download.saveAs(file);
  const json = await readFile(file, 'utf8');
  expect(json).toContain('Colmado E2E');
  expect(json).not.toContain('Compra de pan para reventa'); // sin movimientos

  await go(page, '/plantillas');
  const create = page.getByRole('region', { name: 'Crear un espacio con una plantilla' });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), create.getByRole('button', { name: 'Elegir archivo de plantilla' }).click()]);
  await chooser.setFiles(file);
  await expect(create.getByText(/3 cuentas · 6 campos/)).toBeVisible();
  await create.getByRole('textbox', { name: 'Nombre del espacio' }).fill('Sucursal E2E');
  await create.getByRole('button', { name: 'Crear espacio' }).click();
  await expect(page.getByText('Espacio «Sucursal E2E» creado').first()).toBeVisible();
  await page.getByRole('link', { name: 'Abrir espacio' }).or(page.getByRole('button', { name: 'Abrir espacio' })).first().click();
  await expect(page.getByRole('heading', { level: 1, name: /Sucursal E2E/ })).toBeVisible();
  // Libro en blanco con las mismas cuentas y campos.
  await expect(page.getByText('Tu libro está en blanco').first()).toBeVisible();
  const ws = /#\/e\/([^/?]+)/.exec(page.url())?.[1] ?? '';
  await go(page, `/e/${ws}/cuentas`);
  await expect(page.getByRole('main').getByText('Tarjeta de crédito').first()).toBeVisible();
  await go(page, `/e/${ws}/ajustes/campos`);
  await expect(page.getByRole('main').getByText('Método de pago').first()).toBeVisible();
});
