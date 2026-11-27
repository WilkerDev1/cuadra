// Importar movimientos desde CSV y desde Excel: archivo → columnas → vista previa → importar como lote.
import type { Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import writeXlsxFile from 'write-excel-file/node';
import { expect, go, test } from './fixtures';

const ROWS: Array<[string, string, number]> = [
  ['2026-11-02', 'Importado E2E: venta de cajas', 1250.5],
  ['2026-11-03', 'Importado E2E: pago de gas', -480],
  ['2026-11-04', 'Importado E2E: venta al por mayor', 3200],
];

async function importFile(page: Page, ws: string, file: string, tag: string) {
  await go(page, `/e/${ws}/importar`);
  const main = page.getByRole('main');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), main.getByRole('button', { name: 'Elegir archivo' }).click()]);
  await chooser.setFiles(file);
  await expect(main.getByText(/3 filas/).first()).toBeVisible();
  await main.getByRole('button', { name: 'Siguiente' }).click();
  await expect(main.getByRole('heading', { name: 'Qué es cada columna' })).toBeVisible();
  await main.getByRole('button', { name: 'Siguiente' }).click();
  await expect(main.getByRole('heading', { name: 'Revisa antes de importar' })).toBeVisible();
  await expect(main.getByRole('table', { name: 'Vista previa de las filas del archivo' })).toContainText(`${tag}: pago de gas`);
  await main.getByRole('button', { name: 'Siguiente' }).click();
  await main.getByRole('button', { name: 'Importar 3 movimientos' }).click();
  await expect(main.getByText('3 movimientos importados')).toBeVisible({ timeout: 30_000 });
  // Quedan en el libro, con su signo.
  await go(page, `/e/${ws}/movimientos`);
  await page.getByRole('searchbox').first().fill(tag);
  const totals = page.getByRole('region', { name: 'Totales del filtro' });
  await expect(totals).toContainText('3 movimientos');
  await expect(totals).toContainText('4,450.50');
  await expect(totals).toContainText('480.00');
}

test('importar CSV', async ({ page, colmado }) => {
  const file = test.info().outputPath('movimientos.csv');
  const tag = 'CSV E2E';
  const csv = ['Fecha,Concepto,Monto', ...ROWS.map(([d, c, m]) => `${d},"${c.replace('Importado E2E', tag)}",${m.toFixed(2)}`)].join('\r\n');
  await writeFile(file, csv, 'utf8');
  await importFile(page, colmado, file, tag);
});

test('importar Excel (.xlsx)', async ({ page, colmado }) => {
  const file = test.info().outputPath('movimientos.xlsx');
  const tag = 'XLSX E2E';
  const data = [
    [{ value: 'Fecha' }, { value: 'Concepto' }, { value: 'Monto' }],
    ...ROWS.map(([d, c, m]) => [{ value: new Date(`${d}T12:00:00Z`), type: Date, format: 'yyyy-mm-dd' }, { value: c.replace('Importado E2E', tag) }, { value: m, type: Number }]),
  ];
  await writeXlsxFile(data as never, {}).toFile(file);
  await importFile(page, colmado, file, tag);
});
