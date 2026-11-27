// Respaldo cifrado con la contraseña de la sesión → cambio posterior → restaurar deja todo como estaba.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, go, test } from './fixtures';
import { balanceOf, enablePassword, expectBalance, quickExpense } from './helpers';

test('respaldo cifrado y restauración', async ({ page, colmado, mobile }) => {
  test.setTimeout(240_000);
  await enablePassword(page);
  const before = await balanceOf(page, colmado, 'Caja');

  await go(page, '/respaldo');
  const card = page.getByRole('region', { name: 'Descargar respaldo' });
  await expect(card.getByRole('switch', { name: 'Cifrar con tu contraseña' })).toBeChecked();
  const [download] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: 'Descargar respaldo' }).click()]);
  const file = join(test.info().outputDir, download.suggestedFilename());
  await download.saveAs(file);
  const text = await readFile(file, 'utf8');
  expect(text).toContain('"format":"cuadra-encrypted"');
  expect(text).not.toContain('Colmado');
  expect(download.suggestedFilename()).not.toMatch(/colmado/i);

  // Un cambio después del respaldo…
  await quickExpense(page, colmado, mobile, '777', 'Después del respaldo');
  await expectBalance(page, colmado, 'Caja', before - 77_700);

  // …desaparece al restaurar (se abre con la contraseña de la sesión, sin pedirla).
  await go(page, '/respaldo');
  const restore = page.getByRole('region', { name: 'Restaurar' });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), restore.getByRole('button', { name: 'Elegir archivo' }).click()]);
  await chooser.setFiles(file);
  await restore.getByRole('button', { name: 'Restaurar todo' }).click();
  const confirm = page.getByRole('dialog', { name: '¿Reemplazar todos los datos actuales?' });
  const started = Date.now();
  await confirm.getByRole('button', { name: 'Restaurar', exact: true }).click();
  // Restaurar reescribe ~7 200 movimientos: con las pruebas en paralelo tarda bastante más que a solas.
  await expect(page.getByText('Datos restaurados').first()).toBeVisible({ timeout: 150_000 });
  test.info().annotations.push({ type: 'restaurar-ms', description: String(Date.now() - started) });
  await expectBalance(page, colmado, 'Caja', before);
});
