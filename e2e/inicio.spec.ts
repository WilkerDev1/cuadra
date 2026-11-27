// Bienvenida, datos de ejemplo y espacios nuevos desde plantilla.
import { expect, go, loadDemo, minorOf, test } from './fixtures';

test('bienvenida → datos de ejemplo → inicio con cifras', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/#\/bienvenida/);
  await expect(page.getByRole('heading', { level: 1, name: 'Cuadra' })).toBeVisible();
  const started = Date.now();
  await loadDemo(page);
  test.info().annotations.push({ type: 'demo-ms', description: String(Date.now() - started) });
  const total = page.getByRole('region', { name: 'Saldo total' });
  await expect(total).toContainText('RD$');
  expect(minorOf(await total.innerText())).not.toBe(0);
  await expect(page.getByRole('region', { name: 'Últimos movimientos' }).getByRole('link').first()).toBeVisible();
  // Los tres espacios de ejemplo quedan en el selector.
  await go(page, '/');
  for (const name of ['Colmado La Esquina', 'Estudio Creativo Brisa, SRL', 'Mis finanzas']) {
    await expect(page.getByRole('main').getByText(name, { exact: false }).first()).toBeVisible();
  }
});

test('crear un espacio desde una plantilla', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('textbox', { name: 'Nombre del espacio' }).fill('Ferretería Prueba');
  await page.getByText('Finanzas personales', { exact: true }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '¿Con cuánto empiezas?' })).toBeVisible();
  await page.getByRole('button', { name: /^Efectivo/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Saldo inicial de Efectivo' });
  // La hoja enfoca su campo al abrirse (tras la animación). Con la máquina cargada, teclear antes de ese foco
  // mandaba parte de las teclas a otro control: se espera al foco, como haría una persona.
  const amount = sheet.getByRole('textbox', { name: 'Saldo inicial de Efectivo' });
  await expect(amount).toBeFocused();
  await amount.pressSequentially('2500');
  await expect(sheet.getByRole('status').first()).toContainText('2,500.00');
  await sheet.getByRole('button', { name: 'Guardar saldo' }).click();
  await expect(page.getByRole('button', { name: /^Efectivo/ })).toContainText('2,500.00');
  await page.getByRole('button', { name: 'Crear espacio' }).click();
  await page.waitForURL(/#\/e\/[^/]+$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 1, name: /Ferretería Prueba/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Saldo total' })).toContainText('2,500.00');
});
