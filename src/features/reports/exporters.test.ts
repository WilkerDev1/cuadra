import { afterEach, describe, expect, it } from 'vitest';
import Papa from 'papaparse';
import { reportToSheets, type Sheet } from '../../core';
import { ledgerFixture } from '../../core/services/ledger.fixture';
import { createTestCuadra, type TestCuadra } from '../../test/harness';
import { fileStem, moneyFormat, sheetsToCsv, sheetsToExcel, sheetsToXlsxBlob, toExcelCell } from './exporters';

let h: TestCuadra | undefined;
afterEach(async () => {
  await h?.driver.close();
  h = undefined;
});

async function buildDoc() {
  h = await createTestCuadra();
  const fx = ledgerFixture(h.driver, h.ids);
  const ws = await fx.workspace({ name: 'Colmado Ñandú', ownerName: 'Ana' });
  const caja = await fx.account(ws, 'Caja');
  await fx.opening(caja, 100000, '2026-06-01');
  await fx.income(caja, 123456, '2026-06-05', '=SUMA(A1:A9)');
  await fx.expense(caja, 7, '2026-06-06', '+15 de pan, "dulce"');
  await fx.expense(caja, 20000, '2026-06-07', '007');
  const { reports } = h.cuadra;
  return reports.build(ws, reports.preset('detailed', { from: '2026-06-01', to: '2026-06-30' }));
}

describe('CSV', () => {
  it('neutraliza fórmulas, escribe el dinero como decimal exacto y se vuelve a leer', async () => {
    const doc = await buildDoc();
    const csv = sheetsToCsv(reportToSheets(doc));
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain("'=SUMA(A1:A9)");
    expect(csv).toContain("'+15 de pan");
    expect(csv).toContain('1234.56');
    expect(csv).toContain('0.07');
    expect(csv).not.toMatch(/,-?\d+\.\d{3,}/);
    const back = Papa.parse<string[]>(csv.slice(1), { skipEmptyLines: false }).data;
    // La hoja de movimientos conserva «007» como texto y las comillas del concepto.
    const flat = back.flat();
    expect(flat).toContain('007');
    expect(flat).toContain('\'+15 de pan, "dulce"');
  });

  it('con una sola hoja no antepone su nombre', () => {
    const sheet: Sheet = { name: 'X', columns: [{ key: 'a', header: 'A', type: 'text' }], rows: [['uno']] };
    expect(sheetsToCsv([sheet])).toBe('\uFEFFA\r\nuno');
  });
});

describe('Excel', () => {
  it('el texto va como texto y el dinero como número exacto con formato', async () => {
    const doc = await buildDoc();
    const sheets = sheetsToExcel(reportToSheets(doc));
    const movements = sheets.find((s) => s.sheet === 'Movimientos');
    expect(movements).toBeDefined();
    const header = movements?.data[0]?.map((c) => c?.value);
    const iDesc = header?.indexOf('Descripción') ?? -1;
    const iIn = header?.indexOf('Entrada') ?? -1;
    const rows = movements?.data.slice(1) ?? [];
    const dosCeroSiete = rows.find((r) => r[iDesc]?.value === '007');
    expect(dosCeroSiete?.[iDesc]).toMatchObject({ value: '007', type: String });
    const formula = rows.find((r) => r[iDesc]?.value === '=SUMA(A1:A9)');
    expect(formula?.[iDesc]?.type).toBe(String);
    expect(formula?.[iIn]).toMatchObject({ value: 1234.56, type: Number, format: moneyFormat(2) });
  });

  it('los siete centavos no se pierden ni se ensucian', () => {
    const cell = toExcelCell(7, { key: 'x', header: 'X', type: 'money' }, 2);
    expect(cell?.value).toBe(0.07);
    expect(toExcelCell(-150, { key: 'x', header: 'X', type: 'money' }, 2)?.value).toBe(-1.5);
    expect(toExcelCell(12345, { key: 'x', header: 'X', type: 'money' }, 0)?.value).toBe(12345);
  });

  it('las fechas salen como fecha de calendario sin correrse por la zona horaria', () => {
    const cell = toExcelCell('2026-06-05', { key: 'd', header: 'Fecha', type: 'date' }, 2);
    expect((cell?.value as Date).toISOString()).toBe('2026-06-05T00:00:00.000Z');
    expect(toExcelCell('no es fecha', { key: 'd', header: 'Fecha', type: 'date' }, 2)).toMatchObject({ type: String });
    expect(toExcelCell(null, { key: 'd', header: 'Fecha', type: 'date' }, 2)).toBeNull();
  });

  it('el formato de dinero lleva paréntesis en los negativos', () => {
    expect(moneyFormat(2)).toBe('#,##0.00;(#,##0.00)');
    expect(moneyFormat(0)).toBe('#,##0;(#,##0)');
  });

  it('genera un .xlsx de verdad (zip) con el escritor real', async () => {
    const doc = await buildDoc();
    const universal = (await import('write-excel-file/universal')).default;
    const blob = await sheetsToXlsxBlob(reportToSheets(doc), universal as never);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0)).toBe('PK');
    expect(bytes.length).toBeGreaterThan(1000);
  });
});

describe('nombre de archivo', () => {
  it('quita tildes, espacios y signos', () => {
    expect(fileStem('Informe resumido', 'Colmado Ñandú, SRL', 'noviembre 2026')).toBe('Informe-resumido-Colmado-Nandu-SRL-noviembre-2026');
    expect(fileStem('///')).toBe('informe');
  });
});
