// Pruebas de cuentas y espacios (ARCHITECTURE.md 4.2, 22–27) más las reglas de estructura de 2B.
// Los saldos se prueban con movimientos insertados por SQL (mismas reglas de seq y triggers) para no
// depender del servicio de movimientos; las pruebas que necesitan transactions.create se activan solas
// cuando ese servicio existe.
import { afterEach, describe, expect, it } from 'vitest';
import { createTestCuadra, type TestCuadra } from '../../test/harness';
import type { ChangeEvent } from '../events';
import type { Direction, Id, IsoDate, TxKind } from '../types';

let h: TestCuadra | undefined;
afterEach(async () => {
  await h?.driver.close();
  h = undefined;
});

async function setup() {
  h = await createTestCuadra();
  return h;
}


interface RawTxOptions {
  status?: 'active' | 'voided';
  transferGroupId?: Id;
  description?: string;
}

/** Inserta un movimiento como lo haría el núcleo: reserva seq en la misma transacción. */
async function rawTx(
  t: TestCuadra,
  workspaceId: Id,
  accountId: Id,
  kind: TxKind,
  direction: Direction,
  amountMinor: number,
  date: IsoDate,
  opts: RawTxOptions = {},
): Promise<Id> {
  const id = t.ids.next();
  const now = t.clock.now().toISOString();
  await t.driver.transaction(async (tx) => {
    const r = await tx.get<{ seq: number }>(
      'UPDATE accounts SET next_seq = next_seq + 1 WHERE id = ? RETURNING next_seq - 1 AS seq',
      [accountId],
    );
    const voided = opts.status === 'voided';
    await tx.run(
      `INSERT INTO transactions (id, workspace_id, account_id, seq, kind, direction, amount_minor, date,
         description, status, voided_at, transfer_group_id, recorded_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        workspaceId,
        accountId,
        r?.seq ?? 0,
        kind,
        direction,
        amountMinor,
        date,
        opts.description ?? 'Movimiento',
        voided ? 'voided' : 'active',
        voided ? now : null,
        opts.transferGroupId ?? null,
        now,
        now,
      ],
    );
  });
  return id;
}

async function workspaceWithAccounts(t: TestCuadra) {
  const ws = (await t.cuadra.workspaces.create({ name: 'Colmado La Esquina' })).value;
  const caja = (
    await t.cuadra.accounts.create({
      workspaceId: ws.id,
      name: 'Caja',
      type: 'cash',
      opening: { amountMinor: 1_500_000, direction: 'in', date: '2026-01-01' },
    })
  ).value;
  const banco = (await t.cuadra.accounts.create({ workspaceId: ws.id, name: 'Banco', type: 'bank' })).value;
  return { ws, caja, banco };
}

describe('saldos de cuentas', () => {
  it('saldo = inicial + entradas − salidas ± transferencias, sin anulados', async () => {
    const t = await setup();
    const { ws, caja, banco } = await workspaceWithAccounts(t);
    await rawTx(t, ws.id, caja.id, 'income', 'in', 320_000, '2026-02-01');
    await rawTx(t, ws.id, caja.id, 'expense', 'out', 45_050, '2026-02-02');
    await rawTx(t, ws.id, caja.id, 'expense', 'out', 99_999, '2026-02-03', { status: 'voided' });
    const group = t.ids.next();
    await rawTx(t, ws.id, caja.id, 'transfer', 'out', 200_000, '2026-02-04', { transferGroupId: group });
    await rawTx(t, ws.id, banco.id, 'transfer', 'in', 200_000, '2026-02-04', { transferGroupId: group });
    await rawTx(t, ws.id, banco.id, 'income', 'in', 10_000, '2026-02-05', { status: 'voided' });

    const accounts = await t.cuadra.accounts.list(ws.id);
    const byName = Object.fromEntries(accounts.map((a) => [a.name, a]));
    expect(byName['Caja']?.balanceMinor).toBe(1_500_000 + 320_000 - 45_050 - 200_000);
    expect(byName['Banco']?.balanceMinor).toBe(200_000);
    expect(byName['Caja']?.openingTransactionId).not.toBeNull();
    expect(byName['Banco']?.openingTransactionId).toBeNull();
    expect(byName['Caja']?.lastMovementDate).toBe('2026-02-04');
    const one = await t.cuadra.accounts.get(caja.id);
    expect(one.balanceMinor).toBe(1_574_950);
    expect(one.isNegative).toBe(false);
  });

  it('saldo del espacio = suma de saldos de cuentas, incluidas archivadas', async () => {
    const t = await setup();
    const { ws, caja, banco } = await workspaceWithAccounts(t);
    await rawTx(t, ws.id, banco.id, 'income', 'in', 50_000, '2026-03-01');
    await t.cuadra.accounts.archive(banco.id);

    const visible = await t.cuadra.accounts.list(ws.id);
    expect(visible.map((a) => a.id)).toEqual([caja.id]);
    const all = await t.cuadra.accounts.list(ws.id, { includeArchived: true });
    expect(all).toHaveLength(2);
    const sum = all.reduce((s, a) => s + a.balanceMinor, 0);

    const [summary] = await t.cuadra.workspaces.list();
    expect(summary?.balanceMinor).toBe(sum);
    expect(summary?.balanceMinor).toBe(1_550_000);
    expect(summary?.accountCount).toBe(1);
    expect(summary?.lastMovementDate).toBe('2026-03-01');
  });

  it('una salida que deja la cuenta en negativo se guarda con aviso negative_balance', async () => {
    const t = await setup();
    const { banco } = await workspaceWithAccounts(t);
    const r = await t.cuadra.transactions.create({
      accountId: banco.id,
      kind: 'expense',
      amountMinor: 7_500,
      date: '2026-06-10',
      description: 'Comisión',
    });
    expect(r.warnings).toContainEqual({ code: 'negative_balance', accountId: banco.id, balanceAfterMinor: -7_500 });

    // La cuenta queda guardada en negativo y la lista lo marca (aviso en la UI).
    const after = await t.cuadra.accounts.get(banco.id);
    expect(after.balanceMinor).toBe(-7_500);
    expect(after.isNegative).toBe(true);
  });

  it('cuenta archivada conserva movimientos y rechaza nuevos (account_archived)', async () => {
    const t = await setup();
    const { ws, caja } = await workspaceWithAccounts(t);
    await rawTx(t, ws.id, caja.id, 'income', 'in', 10_000, '2026-04-01');
    const archived = await t.cuadra.accounts.archive(caja.id);
    expect(archived.value.archivedAt).not.toBeNull();
    expect(archived.auditActionId).not.toBeNull();

    const count = await t.driver.get<{ n: number }>('SELECT COUNT(*) AS n FROM transactions WHERE account_id = ?', [
      caja.id,
    ]);
    expect(count?.n).toBe(2);
    const kept = await t.cuadra.accounts.get(caja.id);
    expect(kept.balanceMinor).toBe(1_510_000);

    await expect(
      t.cuadra.transactions.create({
        accountId: caja.id,
        kind: 'income',
        amountMinor: 100,
        date: '2026-06-15',
        description: 'Venta',
      }),
    ).rejects.toMatchObject({ code: 'account_archived' });

    // Recuperarla vuelve a aceptarla; el nombre no puede chocar con otra cuenta activa.
    await t.cuadra.accounts.create({ workspaceId: ws.id, name: 'caja' });
    await expect(t.cuadra.accounts.unarchive(caja.id)).rejects.toMatchObject({ code: 'duplicate_label' });
  });

  it('balances asOf excluye movimientos posteriores a la fecha', async () => {
    const t = await setup();
    const { ws, caja } = await workspaceWithAccounts(t);
    await rawTx(t, ws.id, caja.id, 'income', 'in', 10_000, '2026-05-01');
    await rawTx(t, ws.id, caja.id, 'expense', 'out', 3_000, '2026-05-20');
    await rawTx(t, ws.id, caja.id, 'income', 'in', 7_000, '2026-06-01');

    const asOf = await t.cuadra.accounts.list(ws.id, { asOf: '2026-05-20' });
    expect(asOf.find((a) => a.id === caja.id)?.balanceMinor).toBe(1_500_000 + 10_000 - 3_000);
    const before = await t.cuadra.accounts.list(ws.id, { asOf: '2025-12-31' });
    expect(before.find((a) => a.id === caja.id)?.balanceMinor).toBe(0);
    await expect(t.cuadra.accounts.list(ws.id, { asOf: '2026-02-30' })).rejects.toMatchObject({
      code: 'invalid_date',
    });
  });

  it('crear cuenta con saldo inicial 0 no crea movimiento de saldo inicial', async () => {
    const t = await setup();
    const ws = (await t.cuadra.workspaces.create({ name: 'Personal' })).value;
    const zero = await t.cuadra.accounts.create({
      workspaceId: ws.id,
      name: 'Billetera',
      type: 'wallet',
      opening: { amountMinor: 0, direction: 'in', date: '2026-06-01' },
    });
    const n = await t.driver.get<{ n: number }>('SELECT COUNT(*) AS n FROM transactions WHERE account_id = ?', [
      zero.value.id,
    ]);
    expect(n?.n).toBe(0);
    expect((await t.cuadra.accounts.get(zero.value.id)).openingTransactionId).toBeNull();

    // Con monto, sí: un único movimiento 'opening', seq 1, en una sola acción de historial.
    const card = await t.cuadra.accounts.create({
      workspaceId: ws.id,
      name: 'Tarjeta',
      type: 'card',
      opening: { amountMinor: 850_000, direction: 'out', date: '2026-06-01' },
    });
    const rows = await t.driver.all<{ kind: string; seq: number; direction: string }>(
      'SELECT kind, seq, direction FROM transactions WHERE account_id = ?',
      [card.value.id],
    );
    expect(rows).toEqual([{ kind: 'opening', seq: 1, direction: 'out' }]);
    expect((await t.cuadra.accounts.get(card.value.id)).balanceMinor).toBe(-850_000);
    const actions = await t.driver.all<{ action: string }>('SELECT action FROM audit_log WHERE entity_id = ?', [
      card.value.id,
    ]);
    expect(actions).toEqual([{ action: 'create' }]);
  });
});

describe('cuentas: estructura', () => {
  it('valida nombre, duplicados, espacio, saldo inicial y fecha real', async () => {
    const t = await setup();
    const ws = (await t.cuadra.workspaces.create({ name: 'Negocio' })).value;
    await t.cuadra.accounts.create({ workspaceId: ws.id, name: 'Caja' });
    await expect(t.cuadra.accounts.create({ workspaceId: ws.id, name: '  CAJA ' })).rejects.toMatchObject({
      code: 'duplicate_label',
    });
    await expect(t.cuadra.accounts.create({ workspaceId: ws.id, name: '   ' })).rejects.toMatchObject({
      code: 'name_required',
    });
    await expect(t.cuadra.accounts.create({ workspaceId: 'nope', name: 'X' })).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      t.cuadra.accounts.create({
        workspaceId: ws.id,
        name: 'Banco',
        opening: { amountMinor: 10.5, direction: 'in', date: '2026-01-01' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_amount' });
    await expect(
      t.cuadra.accounts.create({
        workspaceId: ws.id,
        name: 'Banco',
        opening: { amountMinor: 100, direction: 'in', date: '2026-02-31' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_date' });
    await t.cuadra.workspaces.archive(ws.id);
    await expect(t.cuadra.accounts.create({ workspaceId: ws.id, name: 'Banco' })).rejects.toMatchObject({
      code: 'workspace_archived',
    });
  });

  it('renombrar, cambiar color, ordenar y archivar escriben historial solo si cambia algo', async () => {
    const t = await setup();
    const ws = (await t.cuadra.workspaces.create({ name: 'Negocio' })).value;
    const a = (await t.cuadra.accounts.create({ workspaceId: ws.id, name: 'Caja' })).value;
    const b = (await t.cuadra.accounts.create({ workspaceId: ws.id, name: 'Banco', type: 'bank' })).value;
    expect([a.sortOrder, b.sortOrder]).toEqual([0, 1]);

    const events: ChangeEvent[] = [];
    t.cuadra.subscribe((e) => events.push(e));
    const renamed = await t.cuadra.accounts.update(a.id, { name: 'Caja principal', color: 'tint-3' });
    expect(renamed.value).toMatchObject({ name: 'Caja principal', color: 'tint-3' });
    const entry = await t.driver.all<{ path: string; old_value: string; new_value: string }>(
      'SELECT path, old_value, new_value FROM audit_log_changes WHERE action_id = ? ORDER BY ord',
      [renamed.auditActionId],
    );
    expect(entry).toEqual([
      { path: 'name', old_value: '"Caja"', new_value: '"Caja principal"' },
      { path: 'color', old_value: 'null', new_value: '"tint-3"' },
    ]);
    const same = await t.cuadra.accounts.update(a.id, { name: 'Caja principal' });
    expect(same.auditActionId).toBeNull();
    expect(events).toHaveLength(1);
    await expect(t.cuadra.accounts.update(b.id, { name: 'caja principal' })).rejects.toMatchObject({
      code: 'duplicate_label',
    });

    await t.cuadra.accounts.reorder(ws.id, [b.id, a.id]);
    expect((await t.cuadra.accounts.list(ws.id)).map((x) => x.name)).toEqual(['Banco', 'Caja principal']);
    await expect(t.cuadra.accounts.reorder(ws.id, [b.id, 'otro'])).rejects.toMatchObject({ code: 'not_found' });

    const archived = await t.cuadra.accounts.archive(b.id);
    expect(archived.auditActionId).not.toBeNull();
    expect((await t.cuadra.accounts.archive(b.id)).auditActionId).toBeNull();
    const back = await t.cuadra.accounts.unarchive(b.id);
    expect(back.value.archivedAt).toBeNull();
    const actions = await t.driver.all<{ action: string }>(
      "SELECT action FROM audit_log WHERE entity_type = 'account' AND entity_id = ? ORDER BY id",
      [b.id],
    );
    expect(actions.map((x) => x.action)).toEqual(['create', 'archive', 'unarchive']);
  });
});

describe('espacios', () => {
  it('crea con moneda por espacio, renombra, archiva y recupera', async () => {
    const t = await setup();
    const usd = await t.cuadra.workspaces.create({
      name: '  Cliente USD ',
      ownerName: 'Brisa SRL',
      currency: { code: 'USD', minorDigits: 2, symbol: 'US$' },
    });
    expect(usd.value).toMatchObject({
      name: 'Cliente USD',
      ownerName: 'Brisa SRL',
      currency: { code: 'USD', minorDigits: 2, symbol: 'US$' },
      sortOrder: 0,
      isDemo: false,
    });
    const dop = (await t.cuadra.workspaces.create({ name: 'Colmado' })).value;
    expect(dop.currency).toEqual({ code: 'DOP', minorDigits: 2 });
    expect(dop.sortOrder).toBe(1);
    await expect(t.cuadra.workspaces.create({ name: 'X', currency: { code: 'pesos', minorDigits: 2 } })).rejects.toThrow();

    const renamed = await t.cuadra.workspaces.update(dop.id, { name: 'Colmado La Esquina', color: 'tint-2' });
    expect(renamed.value.name).toBe('Colmado La Esquina');
    expect(renamed.auditActionId).not.toBeNull();
    expect((await t.cuadra.workspaces.update(dop.id, { name: 'Colmado La Esquina' })).auditActionId).toBeNull();

    await t.cuadra.workspaces.reorder([dop.id, usd.value.id]);
    expect((await t.cuadra.workspaces.list()).map((w) => w.id)).toEqual([dop.id, usd.value.id]);

    await t.cuadra.workspaces.archive(usd.value.id);
    expect((await t.cuadra.workspaces.list()).map((w) => w.id)).toEqual([dop.id]);
    expect(await t.cuadra.workspaces.list({ includeArchived: true })).toHaveLength(2);
    const back = await t.cuadra.workspaces.unarchive(usd.value.id);
    expect(back.value.archivedAt).toBeNull();
    await expect(t.cuadra.workspaces.get('nope')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('los decimales de la moneda solo cambian si no hay movimientos (currency_locked)', async () => {
    const t = await setup();
    const ws = (await t.cuadra.workspaces.create({ name: 'Colmado' })).value;
    const changed = await t.cuadra.workspaces.update(ws.id, { currency: { code: 'CLP', minorDigits: 0 } });
    expect(changed.value.currency).toEqual({ code: 'CLP', minorDigits: 0 });
    await t.cuadra.accounts.create({
      workspaceId: ws.id,
      name: 'Caja',
      opening: { amountMinor: 5_000, direction: 'in', date: '2026-06-01' },
    });
    await expect(
      t.cuadra.workspaces.update(ws.id, { currency: { code: 'CLP', minorDigits: 2 } }),
    ).rejects.toMatchObject({ code: 'currency_locked' });
    // El símbolo sí se puede cambiar.
    const symbol = await t.cuadra.workspaces.update(ws.id, { currency: { code: 'CLP', minorDigits: 0, symbol: '$' } });
    expect(symbol.value.currency.symbol).toBe('$');
  });

  it('borrado definitivo exige el nombre exacto y elimina todo el espacio en modo mantenimiento', async () => {
    const t = await setup();
    const keep = await workspaceWithAccounts(t);
    const gone = (await t.cuadra.workspaces.create({ name: 'Prueba' })).value;
    const acc = (
      await t.cuadra.accounts.create({
        workspaceId: gone.id,
        name: 'Caja',
        opening: { amountMinor: 100, direction: 'in', date: '2026-06-01' },
      })
    ).value;
    const field = (
      await t.cuadra.fields.create({ workspaceId: gone.id, label: 'Categoría', type: 'list', options: [{ label: 'Ventas' }] })
    ).value;
    await t.cuadra.settings.setWs(gone.id, 'capture.lastAccountId', acc.id);
    await t.cuadra.settings.set('workspace.lastOpened', gone.id);
    await rawTx(t, gone.id, acc.id, 'income', 'in', 500, '2026-06-02');
    await t.driver.run(
      'INSERT INTO transaction_field_values (transaction_id, field_id, value_option_id) SELECT id, ?, ? FROM transactions WHERE account_id = ? AND kind = ?',
      [field.id, field.options[0]?.id ?? '', acc.id, 'income'],
    );

    await expect(t.cuadra.workspaces.purge(gone.id, 'prueba')).rejects.toMatchObject({ code: 'confirmation_mismatch' });
    await expect(t.driver.run('DELETE FROM workspaces WHERE id = ?', [gone.id])).rejects.toMatchObject({
      code: 'delete_forbidden',
    });

    await t.cuadra.workspaces.purge(gone.id, 'Prueba');
    for (const table of ['accounts', 'transactions', 'fields', 'saved_views', 'batches']) {
      const r = await t.driver.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE workspace_id = ?`, [gone.id]);
      expect(r?.n, table).toBe(0);
    }
    const settings = await t.driver.get<{ n: number }>('SELECT COUNT(*) AS n FROM settings WHERE scope_id = ?', [gone.id]);
    expect(settings?.n).toBe(0);
    const maintenance = await t.driver.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM settings WHERE key = 'sys.maintenance'",
    );
    expect(maintenance?.n).toBe(0);
    expect(await t.cuadra.settings.get('workspace.lastOpened')).toBeNull();
    const log = await t.driver.all<{ workspace_id: string | null; message: string }>(
      "SELECT workspace_id, message FROM audit_log WHERE entity_id = ? AND entity_type = 'workspace'",
      [gone.id],
    );
    expect(log).toEqual([{ workspace_id: null, message: 'audit.workspace.purge' }]);
    // El otro espacio sigue intacto.
    expect((await t.cuadra.accounts.list(keep.ws.id)).length).toBe(2);
    const fk = await t.driver.all('PRAGMA foreign_key_check');
    expect(fk).toEqual([]);
  });
});

describe('ajustes', () => {
  it('devuelve valores por defecto, guarda y lee por instalación y por espacio', async () => {
    const t = await setup();
    expect(await t.cuadra.settings.get('locale')).toBe('es-DO');
    expect(await t.cuadra.settings.get('theme')).toBe('system');
    expect(await t.cuadra.settings.get('backup.reminderDays')).toBe(30);
    expect(await t.cuadra.settings.get('demo.offered')).toBe(false);
    await t.cuadra.settings.set('theme', 'dark');
    await t.cuadra.settings.set('backup.reminderDays', 15);
    expect(await t.cuadra.settings.get('theme')).toBe('dark');
    expect(await t.cuadra.settings.get('backup.reminderDays')).toBe(15);
    await expect(t.cuadra.settings.set('theme', 'neon' as never)).rejects.toThrow();

    const ws = (await t.cuadra.workspaces.create({ name: 'Colmado' })).value;
    expect(await t.cuadra.settings.getWs(ws.id, 'capture.lastKind')).toBe('expense');
    expect(await t.cuadra.settings.getWs(ws.id, 'home.cards')).toEqual([]);
    await t.cuadra.settings.setWs(ws.id, 'capture.lastKind', 'income');
    await t.cuadra.settings.setWs(ws.id, 'ledger.columns', ['date', 'amount']);
    expect(await t.cuadra.settings.getWs(ws.id, 'capture.lastKind')).toBe('income');
    expect(await t.cuadra.settings.getWs(ws.id, 'ledger.columns')).toEqual(['date', 'amount']);
    await expect(t.cuadra.settings.setWs('nope', 'capture.lastKind', 'income')).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
