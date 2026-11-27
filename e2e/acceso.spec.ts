// Contraseña local: activar, bloquear, contraseña errónea, desbloquear, entrar con la clave de recuperación, y la
// segunda pestaña que queda bloqueada por el candado entre pestañas.
import type { Page } from '@playwright/test';
import { expect, go, test } from './fixtures';
import { enablePassword, PASSWORD } from './helpers';

const NEW_PASSWORD = 'otra frase nueva de prueba';

async function lockNow(page: Page) {
  await go(page, '/seguridad');
  await page.getByRole('main').getByRole('button', { name: 'Bloquear ahora' }).click();
  await expect(page.getByRole('heading', { name: 'Cuadra está bloqueada' })).toBeVisible();
}

/** La pantalla de bloqueo va en un <dialog> modal por encima de todo (la página de detrás sigue en el DOM). */
const lockLayer = (page: Page) => page.locator('dialog.lock-layer');

async function unlock(page: Page, password: string) {
  const lock = lockLayer(page);
  await lock.getByLabel('Contraseña', { exact: true }).fill(password);
  await lock.getByRole('button', { name: 'Entrar', exact: true }).click();
}

test('contraseña: bloquear, error, desbloquear y recuperar con la clave', async ({ page, colmado }) => {
  const key = await enablePassword(page);

  await lockNow(page);
  await unlock(page, 'no es la contraseña');
  await expect(lockLayer(page).getByText('Contraseña incorrecta.')).toBeVisible();
  await unlock(page, PASSWORD);
  await expect(page.getByRole('heading', { name: 'Cuadra está bloqueada' })).toBeHidden();
  await go(page, `/e/${colmado}`);
  await expect(page.getByRole('heading', { level: 1, name: /Colmado La Esquina/ })).toBeVisible();

  // Olvidé la contraseña → clave de recuperación → contraseña nueva.
  await lockNow(page);
  const lock = lockLayer(page);
  await lock.getByRole('button', { name: /Olvidé la contraseña|Usar la clave de recuperación/ }).first().click();
  await lock.getByLabel('Clave de recuperación', { exact: true }).fill(key.toLowerCase().replace(/-/g, ' '));
  await lock.getByLabel('Contraseña nueva', { exact: true }).fill(NEW_PASSWORD);
  const repeat = lock.getByLabel('Repite la contraseña', { exact: true });
  if (await repeat.isVisible().catch(() => false)) await repeat.fill(NEW_PASSWORD);
  await lock.getByRole('button', { name: 'Poner contraseña nueva y entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Cuadra está bloqueada' })).toBeHidden();

  // La nueva vale; la vieja ya no.
  await lockNow(page);
  await unlock(page, PASSWORD);
  await expect(lockLayer(page).getByText('Contraseña incorrecta.')).toBeVisible();
  await unlock(page, NEW_PASSWORD);
  await expect(page.getByRole('heading', { name: 'Cuadra está bloqueada' })).toBeHidden();
});

test('una segunda pestaña queda bloqueada mientras la primera tiene el libro', async ({ page, context, colmado }) => {
  const second = await context.newPage();
  await second.goto(`/#/e/${colmado}`);
  await expect(second.getByRole('heading', { level: 1 })).toContainText(/otra pestaña/i);
  await expect(second.getByRole('heading', { level: 1, name: /Colmado La Esquina/ })).toHaveCount(0);
  // La primera sigue trabajando.
  await page.bringToFront();
  await go(page, `/e/${colmado}/movimientos`);
  await expect(page.getByRole('heading', { level: 1, name: 'Movimientos' })).toBeVisible();
  await second.close();
});
