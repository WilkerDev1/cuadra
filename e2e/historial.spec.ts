// Editar, anular y restaurar un movimiento: cada paso queda en su historial y en el historial general.
import type { Page } from '@playwright/test';
import { expect, go, test } from './fixtures';

function detail(page: Page, mobile: boolean) {
  return mobile ? page.getByRole('dialog').last() : page.getByRole('complementary', { name: 'Detalle' });
}

test('editar, anular y restaurar con historial', async ({ page, colmado, mobile }) => {
  await go(page, `/e/${colmado}/movimientos`);
  // Escritorio: la fila lleva un enlace; móvil: la fila es un botón que abre el detalle en hoja.
  if (mobile) await page.getByRole('main').getByRole('listitem').getByRole('button').first().click();
  else await page.getByRole('main').locator('a[href*="/movimientos/"]').first().click();
  await page.waitForURL(/\/movimientos\/[\w-]+$/);
  const txPath = new URL(page.url()).hash.replace(/^#/, '');

  // Editar el concepto.
  await go(page, txPath);
  let panel = detail(page, mobile);
  await panel.getByRole('button', { name: 'Editar', exact: true }).click();
  const form = mobile ? page.getByRole('dialog', { name: 'Editar movimiento' }) : page.getByRole('region', { name: 'Editar movimiento' });
  const concept = form.getByRole('textbox', { name: 'Concepto' });
  await concept.fill('Concepto editado por E2E');
  await form.getByRole('button', { name: /^(Guardar|Guardar cambios)$/ }).first().click();
  await expect(form).toBeHidden();

  await go(page, txPath);
  panel = detail(page, mobile);
  await expect(panel).toContainText('Concepto editado por E2E');
  const history = panel.getByRole('region', { name: 'Historial de cambios' });
  await expect(history).toContainText('Editado');

  // Anular con motivo.
  await panel.getByRole('button', { name: 'Anular', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '¿Anular este movimiento?' });
  await confirm.getByRole('textbox', { name: 'Motivo (opcional)' }).fill('Prueba E2E');
  await confirm.getByRole('button', { name: 'Anular', exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(history).toContainText('Anulado');
  await expect(panel).toContainText('Prueba E2E');

  // Restaurar.
  await panel.getByRole('button', { name: /^Restaurar/ }).click();
  const again = page.getByRole('dialog', { name: /Restaurar/ });
  if (await again.isVisible().catch(() => false)) await again.getByRole('button', { name: /^Restaurar/ }).click();
  await expect(history).toContainText('Restaurado');
  await expect(panel.getByRole('button', { name: 'Anular', exact: true })).toBeVisible();

  // El historial general recoge los tres pasos.
  await go(page, `/e/${colmado}/historial`);
  const main = page.getByRole('main');
  for (const action of ['Editado', 'Anulado', 'Restaurado']) await expect(main.getByText(action, { exact: true }).first()).toBeVisible();
});
