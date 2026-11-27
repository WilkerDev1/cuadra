// Captura en lote con total de control que no cuadra: se acepta el descuadre y el lote queda señalado.
import { expect, go, test } from './fixtures';
import { keypad } from './helpers';

test('captura en lote con descuadre aceptado', async ({ page, colmado, mobile }) => {
  await go(page, `/e/${colmado}/captura`);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: 'Captura en lote' })).toBeVisible();
  if (mobile) {
    await main.getByRole('button', { name: 'Control' }).click();
    await main.getByRole('textbox', { name: 'Total de control' }).fill('1000');
    await main.getByRole('button', { name: 'Listo' }).click();
    for (const [amount, text] of [['400', 'Fundas E2E'], ['500', 'Hielo E2E']] as const) {
      await keypad(page, amount);
      await main.getByRole('textbox', { name: 'Concepto' }).fill(text);
      await main.getByRole('button', { name: /^Añadir línea/ }).click();
    }
    await main.getByRole('button', { name: /^Cerrar lote/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cerrar igual' }).click();
  } else {
    await main.getByRole('textbox', { name: 'Lote', exact: true }).fill('Lote E2E descuadrado');
    await main.getByRole('textbox', { name: 'Total de control' }).fill('1000');
    await main.getByRole('textbox', { name: 'Concepto, fila 1' }).fill('Fundas E2E');
    await main.getByRole('textbox', { name: 'Monto, fila 1' }).fill('400');
    await main.getByRole('textbox', { name: 'Concepto, fila 2' }).fill('Hielo E2E');
    await main.getByRole('textbox', { name: 'Monto, fila 2' }).fill('500');
    await expect(main.getByRole('region', { name: 'Cinta' })).toContainText('900.00');
    await main.getByRole('button', { name: 'Guardar lote' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Guardar igual' }).click();
  }
  await expect(page.getByRole('dialog')).toBeHidden();
  await go(page, `/e/${colmado}/lotes?ver=descuadrados`);
  const row = page.getByRole('main').getByRole('listitem').filter({ hasText: mobile ? /2 mov/ : 'Lote E2E descuadrado' }).first();
  await expect(row).toContainText(/Faltan|Sobran/);
  await expect(row).toContainText('100.00');
});
