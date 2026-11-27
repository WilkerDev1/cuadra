// La PWA arranca sin red tras la primera carga: el service worker sirve la app y la base está en el dispositivo.
import { expect, go, test } from './fixtures';

test('arranque sin red tras la primera carga', async ({ page, context, colmado }) => {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // La primera visita instala el SW; desde la siguiente carga es él quien responde.
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: 20_000 }).toBe(true);

  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: /Colmado La Esquina/ })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Saldo total' })).toContainText('RD$');
    // Otras pantallas (bloques cargados bajo demanda) también salen del precache.
    for (const [path, title] of [['movimientos', 'Movimientos'], ['resumen', 'Resumen'], ['informes', 'Informes']] as const) {
      await go(page, `/e/${colmado}/${path}`);
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    }
  } finally {
    await context.setOffline(false);
  }
});
