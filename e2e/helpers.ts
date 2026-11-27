// Ayudas de interfaz compartidas por las pruebas E2E.
import type { Page } from '@playwright/test';
import { expect, go, minorOf } from './fixtures';

export function accountChip(page: Page, name: string) {
  const label = `Movimientos de ${name}`;
  const main = page.getByRole('main');
  return main.getByRole('link', { name: label, exact: true }).or(main.getByRole('button', { name: label, exact: true }));
}

/** Saldo de una cuenta leído en la tira de cuentas de Inicio. */
export async function balanceOf(page: Page, ws: string, name: string): Promise<number> {
  await go(page, `/e/${ws}`);
  const chip = accountChip(page, name);
  await expect(chip).toContainText('RD$');
  return minorOf(await chip.innerText());
}

const KEY_NAMES: Record<string, string> = {
  '0': 'cero', '1': 'uno', '2': 'dos', '3': 'tres', '4': 'cuatro', '5': 'cinco', '6': 'seis', '7': 'siete', '8': 'ocho', '9': 'nueve',
  '+': 'más', '-': 'menos', '*': 'por', '.': 'punto decimal',
};

/** Escribe una expresión con las teclas del teclado propio (`1500+250`). */
export async function keypad(page: Page, expr: string): Promise<void> {
  const keys = page.getByRole('group', { name: 'Monto' });
  for (const ch of expr) await keys.getByRole('button', { name: KEY_NAMES[ch] ?? ch, exact: true }).click();
}

/** El formulario de anotar: hoja en móvil, panel de detalle en escritorio. */
export function sheet(page: Page, mobile: boolean, name: string | RegExp) {
  return mobile ? page.getByRole('dialog', { name }) : page.getByRole('region', { name });
}

export const PASSWORD = 'una frase de prueba larga';

/** Activa la contraseña desde /seguridad y devuelve la clave de recuperación que se muestra una sola vez. */
export async function enablePassword(page: Page, password = PASSWORD): Promise<string> {
  await go(page, '/seguridad');
  const main = page.getByRole('main');
  await main.getByRole('textbox', { name: 'Tu nombre o el del negocio' }).fill('Colmado E2E');
  await main.getByLabel('Contraseña', { exact: true }).fill(password);
  await main.getByLabel('Repite la contraseña', { exact: true }).fill(password);
  await main.getByRole('button', { name: 'Activar contraseña' }).click();
  await expect(main.getByRole('heading', { name: 'Guarda tu clave de recuperación' })).toBeVisible();
  const key = (await main.locator('.auth-key__group').allInnerTexts()).join('-');
  expect(key).toMatch(/^(\w{4}-){5}\w{4}$/);
  await main.getByRole('checkbox').check();
  await main.locator('.auth-key__confirm').getByRole('button').click();
  await expect(main.getByText('Contraseña activada').first()).toBeVisible();
  return key;
}

/** Anota una salida en Caja (teclado propio en móvil, campo de monto en escritorio). */
export async function quickExpense(page: Page, ws: string, mobile: boolean, amount: string, concept: string): Promise<void> {
  await go(page, `/e/${ws}/nuevo?tipo=salida`);
  const form = sheet(page, mobile, 'Nuevo movimiento');
  if (mobile) await keypad(page, amount);
  else await form.getByRole('textbox', { name: 'Monto' }).fill(amount);
  await form.getByRole('textbox', { name: 'Concepto' }).fill(concept);
  await form.getByRole('button', { name: mobile ? 'Anotar salida' : 'Guardar' , exact: true }).click();
  await expect(form).toBeHidden();
}

/** Espera a que el saldo de una cuenta en Inicio llegue a `expected` (las consultas se refrescan tras guardar). */
export async function expectBalance(page: Page, ws: string, name: string, expected: number): Promise<void> {
  await go(page, `/e/${ws}`);
  const chip = accountChip(page, name);
  await expect.poll(async () => minorOf(await chip.innerText()), { timeout: 20_000 }).toBe(expected);
}
