// Anotar con el teclado propio (móvil) o con el campo de monto (escritorio) y transferir entre cuentas.
import { expect, go, test } from './fixtures';
import { balanceOf, expectBalance, keypad } from './helpers';

test('anotar una salida con aritmética y ver bajar el saldo', async ({ page, colmado, mobile }) => {
  const before = await balanceOf(page, colmado, 'Caja');
  await go(page, `/e/${colmado}/nuevo?tipo=salida&cuenta=`);
  const form = mobile ? page.getByRole('dialog', { name: 'Nuevo movimiento' }) : page.getByRole('region', { name: 'Nuevo movimiento' });
  await expect(form.getByRole('radio', { name: 'Salida' })).toBeChecked();
  if (mobile) await keypad(page, '1500+250*2');
  else await form.getByRole('textbox', { name: 'Monto' }).fill('1500+250*2');
  await expect(form.getByRole('status').first()).toContainText('2,000.00');
  await form.getByRole('textbox', { name: 'Concepto' }).fill('Prueba E2E: compra de fundas');
  if (mobile) await form.getByRole('button', { name: 'Anotar salida' }).click();
  else await form.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(form).toBeHidden();
  await expectBalance(page, colmado, 'Caja', before - 200_000);
  await go(page, `/e/${colmado}/movimientos`);
  await expect(page.getByRole('main').getByText('Prueba E2E: compra de fundas').first()).toBeVisible();
});

test('transferencia entre cuentas mueve el saldo de las dos', async ({ page, colmado, mobile }) => {
  const caja = await balanceOf(page, colmado, 'Caja');
  const banco = await balanceOf(page, colmado, 'Banco');
  await go(page, `/e/${colmado}/transferencia`);
  const form = mobile ? page.getByRole('dialog', { name: /Transferencia/ }) : page.getByRole('region', { name: /Transferencia/ });
  await expect(form).toBeVisible();
  if (mobile) await keypad(page, '5000');
  else await form.getByRole('textbox', { name: 'Monto' }).fill('5000');
  const note = form.getByRole('textbox', { name: 'Nota', exact: true });
  if (await note.isVisible()) await note.fill('Depósito E2E');
  await form.getByRole('button', { name: 'Transferir', exact: true }).click();
  await expect(form).toBeHidden();
  await expectBalance(page, colmado, 'Caja', caja - 500_000);
  await expectBalance(page, colmado, 'Banco', banco + 500_000);
});
