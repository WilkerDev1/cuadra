// Informe resumido → CSV y Excel: el contenido descargado coincide con lo que se ve en pantalla.
import { readFile } from 'node:fs/promises';
import readXlsxFile from 'read-excel-file/node';
import { expect, go, minorOf, test } from './fixtures';

test('informe: descarga CSV y XLSX con el contenido correcto', async ({ page, colmado }) => {
  await go(page, `/e/${colmado}/informes/resumido`);
  const report = page.getByRole('article', { name: /Informe resumido/ });
  const cajaRow = report.getByRole('table', { name: 'Estado por cuenta' }).getByRole('row').filter({ has: page.getByRole('cell', { name: 'Caja', exact: true }) });
  await expect(cajaRow).toContainText(/\d\.\d{2}/);
  const cells = await cajaRow.getByRole('cell').allInnerTexts();
  const finalMinor = minorOf(cells.at(-1) ?? '');
  const finalDecimal = (finalMinor / 100).toFixed(2);

  // CSV: BOM, cabeceras y el saldo final de Caja en decimal canónico.
  const [csvDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'CSV', exact: true }).click()]);
  expect(csvDownload.suggestedFilename()).toMatch(/\.csv$/);
  const csv = await readFile((await csvDownload.path()) ?? '', 'utf8');
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv).toContain('Saldo final');
  const cajaLine = csv.split(/\r?\n/).find((l) => l.startsWith('Caja,'));
  expect(cajaLine, 'fila de Caja en el CSV').toBeDefined();
  expect(cajaLine).toContain(finalDecimal);

  // Excel: la misma fila, con el saldo como número.
  const [xlsxDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Excel', exact: true }).click()]);
  expect(xlsxDownload.suggestedFilename()).toMatch(/\.xlsx$/);
  const sheets = await readXlsxFile(await readFile((await xlsxDownload.path()) ?? ''));
  const rows = sheets.flatMap((s) => s.data);
  const caja = rows.find((r) => r[0] === 'Caja');
  expect(caja, 'fila de Caja en el Excel').toBeDefined();
  expect(caja).toContain(Number(finalDecimal));
});
