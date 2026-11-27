// El DDL de 001_init.sql contra SQLite real (node:sqlite de Node 26 → SQLite 3.54.1, la misma versión
// que @sqlite.org/sqlite-wasm 3.54.1). Cada trigger se prueba haciendo justo lo que prohíbe.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DomainError } from '../core/errors';
import type { SqlDriver, SqlExecutor } from '../core/ports';
import { compareVersions, SqlError } from './errors';
import { migrate } from './migrate';
import { openNodeDriver } from './node/nodeDriver';

const T = '2026-06-15T12:00:00.000Z';
let db: SqlDriver;

beforeEach(async () => {
  db = await openNodeDriver();
  await migrate(db);
});
afterEach(async () => {
  await db.close();
});

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    if (err instanceof SqlError) return `sql:${err.message}`;
    throw err;
  }
  throw new Error('se esperaba un error');
}

async function workspace(ex: SqlExecutor, id = 'ws1'): Promise<string> {
  await ex.run(
    'INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [id, `Espacio ${id}`, T, T],
  );
  return id;
}

async function account(ex: SqlExecutor, id = 'acc1', ws = 'ws1'): Promise<string> {
  await ex.run(
    'INSERT INTO accounts (id, workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [id, ws, `Cuenta ${id}`, T, T],
  );
  return id;
}

async function reserveSeq(ex: SqlExecutor, accountId: string): Promise<number> {
  const row = await ex.get<{ seq: number }>(
    'UPDATE accounts SET next_seq = next_seq + 1 WHERE id = ? RETURNING next_seq - 1 AS seq',
    [accountId],
  );
  return Number(row!.seq);
}

interface TxInput {
  id: string;
  account?: string;
  ws?: string;
  kind?: string;
  direction?: string;
  amount?: number;
  seq?: number;
  transferGroup?: string | null;
}

async function insertTx(ex: SqlExecutor, input: TxInput): Promise<number> {
  const accountId = input.account ?? 'acc1';
  const seq = input.seq ?? (await reserveSeq(ex, accountId));
  await ex.run(
    `INSERT INTO transactions (id, workspace_id, account_id, seq, kind, direction, amount_minor, date,
       description, transfer_group_id, recorded_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '2026-06-15', 'Venta', ?, ?, ?)`,
    [
      input.id,
      input.ws ?? 'ws1',
      accountId,
      seq,
      input.kind ?? 'income',
      input.direction ?? 'in',
      input.amount ?? 1000,
      input.transferGroup ?? null,
      T,
      T,
    ],
  );
  return seq;
}

async function setup(): Promise<void> {
  await db.transaction(async (tx) => {
    await workspace(tx);
    await account(tx);
  });
}

const enterMaintenance = (ex: SqlExecutor) =>
  ex.run("INSERT INTO settings (scope_id, key, value, updated_at) VALUES ('', 'sys.maintenance', 'true', ?)", [T]);

describe('001_init.sql sobre SQLite real', () => {
  it('node:sqlite trae SQLite >= 3.45 (Node 26 → 3.54.1)', async () => {
    const { v } = (await db.get<{ v: string }>('SELECT sqlite_version() AS v'))!;
    expect(db.info.sqliteVersion).toBe(v);
    expect(compareVersions(v, '3.45.0')).toBeGreaterThanOrEqual(0);
  });

  it('todas las tablas son STRICT y el esquema pasa integrity_check', async () => {
    const tables = await db.all<{ name: string; strict: number }>(
      "SELECT name, strict FROM pragma_table_list WHERE schema = 'main' AND name NOT LIKE 'sqlite_%'",
    );
    expect(tables.map((t) => t.name).sort()).toEqual([
      'accounts',
      'audit_log',
      'audit_log_changes',
      'batches',
      'field_options',
      'fields',
      'saved_views',
      'schema_migrations',
      'settings',
      'transaction_field_values',
      'transactions',
      'workspaces',
    ]);
    expect(tables.every((t) => Number(t.strict) === 1)).toBe(true);
    expect(await db.get('PRAGMA integrity_check')).toEqual({ integrity_check: 'ok' });
    const triggers = await db.all("SELECT name FROM sqlite_master WHERE type = 'trigger'");
    expect(triggers.length).toBe(16);
  });

  describe('nada se borra', () => {
    it('DELETE de un movimiento lo rechaza la BD (delete_forbidden)', async () => {
      await setup();
      await db.transaction((tx) => insertTx(tx, { id: 't1' }));
      expect(await codeOf(db.run("DELETE FROM transactions WHERE id = 't1'"))).toBe('delete_forbidden');
      expect((await db.all('SELECT id FROM transactions')).length).toBe(1);
    });

    it('DELETE de espacio, cuenta o lote lo rechaza la BD', async () => {
      await setup();
      await db.run(
        "INSERT INTO batches (id, workspace_id, source, created_at) VALUES ('b1', 'ws1', 'capture', ?)",
        [T],
      );
      expect(await codeOf(db.run("DELETE FROM batches WHERE id = 'b1'"))).toBe('delete_forbidden');
      expect(await codeOf(db.run("DELETE FROM accounts WHERE id = 'acc1'"))).toBe('delete_forbidden');
      expect(await codeOf(db.run("DELETE FROM workspaces WHERE id = 'ws1'"))).toBe('delete_forbidden');
    });

    it('el modo mantenimiento permite borrar dentro de su transacción y luego se cierra', async () => {
      await setup();
      await db.transaction((tx) => insertTx(tx, { id: 't1' }));
      await db.transaction(async (tx) => {
        await enterMaintenance(tx);
        await tx.run('DELETE FROM transactions');
        await tx.run('DELETE FROM accounts');
        await tx.run('DELETE FROM workspaces');
        await tx.run("DELETE FROM settings WHERE scope_id = '' AND key = 'sys.maintenance'");
      });
      expect((await db.all('SELECT id FROM workspaces')).length).toBe(0);
      await setup();
      await db.transaction((tx) => insertTx(tx, { id: 't2' }));
      expect(await codeOf(db.run("DELETE FROM transactions WHERE id = 't2'"))).toBe('delete_forbidden');
    });

    it('campos sin usar sí se borran; con un valor (aunque esté anulado) la FK lo impide', async () => {
      await setup();
      await db.run(
        `INSERT INTO fields (id, workspace_id, key, label, type, created_at, updated_at)
         VALUES ('f1', 'ws1', 'ref', 'Referencia', 'text', ?, ?), ('f2', 'ws1', 'nota', 'Nota', 'text', ?, ?)`,
        [T, T, T, T],
      );
      await db.transaction((tx) => insertTx(tx, { id: 't1' }));
      await db.run("INSERT INTO transaction_field_values (transaction_id, field_id, value_text) VALUES ('t1', 'f1', 'A-1')");
      await db.run("UPDATE transactions SET status = 'voided', voided_at = ? WHERE id = 't1'", [T]);
      expect(await db.run("DELETE FROM fields WHERE id = 'f2'")).toEqual({ changes: 1 });
      expect(await codeOf(db.run("DELETE FROM fields WHERE id = 'f1'"))).toMatch(/^sql:.*FOREIGN KEY/);
    });
  });

  describe('historial solo-añadir', () => {
    async function seedAudit(): Promise<void> {
      await db.run(
        `INSERT INTO audit_log (id, workspace_id, at, action, entity_type, entity_id, message)
         VALUES ('a1', NULL, ?, 'config', 'settings', NULL, 'audit.settings.edit')`,
        [T],
      );
      await db.run(
        "INSERT INTO audit_log_changes (action_id, ord, path, old_value, new_value) VALUES ('a1', 0, 'label', '\"a\"', '\"b\"')",
      );
    }

    it('UPDATE y DELETE sobre audit_log los rechaza la BD', async () => {
      await seedAudit();
      expect(await codeOf(db.run("UPDATE audit_log SET message = 'x' WHERE id = 'a1'"))).toBe('audit_append_only');
      expect(await codeOf(db.run("DELETE FROM audit_log WHERE id = 'a1'"))).toBe('audit_append_only');
    });

    it('UPDATE y DELETE sobre audit_log_changes los rechaza la BD', async () => {
      await seedAudit();
      expect(await codeOf(db.run("UPDATE audit_log_changes SET new_value = 'null'"))).toBe('audit_append_only');
      expect(await codeOf(db.run('DELETE FROM audit_log_changes'))).toBe('audit_append_only');
    });

    it('ni siquiera el modo mantenimiento permite editar el historial (solo vaciarlo al restaurar)', async () => {
      await seedAudit();
      await enterMaintenance(db);
      expect(await codeOf(db.run("UPDATE audit_log SET message = 'x'"))).toBe('audit_append_only');
      await db.run('DELETE FROM audit_log_changes');
      await db.run('DELETE FROM audit_log');
      expect((await db.all('SELECT id FROM audit_log')).length).toBe(0);
    });
  });

  describe('seq por cuenta', () => {
    it('seq reservado es consecutivo y un anulado conserva el suyo', async () => {
      await setup();
      const seqs = await db.transaction(async (tx) => [
        await insertTx(tx, { id: 't1' }),
        await insertTx(tx, { id: 't2' }),
      ]);
      await db.run("UPDATE transactions SET status = 'voided', voided_at = ? WHERE id = 't2'", [T]);
      const third = await db.transaction((tx) => insertTx(tx, { id: 't3' }));
      expect([...seqs, third]).toEqual([1, 2, 3]);
      expect(await db.all('SELECT id, seq FROM transactions ORDER BY seq')).toEqual([
        { id: 't1', seq: 1 },
        { id: 't2', seq: 2 },
        { id: 't3', seq: 3 },
      ]);
    });

    it('un INSERT con seq no reservado lo rechaza la BD (seq_not_reserved)', async () => {
      await setup();
      expect(await codeOf(db.transaction((tx) => insertTx(tx, { id: 't1', seq: 1 })))).toBe('seq_not_reserved');
      await db.transaction((tx) => insertTx(tx, { id: 't1' }));
      // Reutilizar un seq antiguo o saltarse uno.
      await db.transaction(async (tx) => {
        await reserveSeq(tx, 'acc1');
      });
      expect(await codeOf(db.transaction((tx) => insertTx(tx, { id: 't2', seq: 1 })))).toBe('seq_not_reserved');
      expect(await codeOf(db.transaction((tx) => insertTx(tx, { id: 't3', seq: 5 })))).toBe('seq_not_reserved');
    });

    it('next_seq nunca baja (seq_decrease), así que un seq no se reutiliza', async () => {
      await setup();
      await db.transaction((tx) => insertTx(tx, { id: 't1' }));
      expect(await codeOf(db.run("UPDATE accounts SET next_seq = 1 WHERE id = 'acc1'"))).toBe('seq_decrease');
      expect(await db.get("SELECT next_seq FROM accounts WHERE id = 'acc1'")).toEqual({ next_seq: 2 });
    });

    it('el mismo seq dos veces en una cuenta lo impide UNIQUE incluso en mantenimiento', async () => {
      await setup();
      await db.transaction((tx) => insertTx(tx, { id: 't1' }));
      await enterMaintenance(db);
      expect(await codeOf(db.transaction((tx) => insertTx(tx, { id: 't2', seq: 1 })))).toMatch(/^sql:.*UNIQUE/);
    });

    it('si falla el INSERT, ROLLBACK devuelve next_seq y no queda hueco', async () => {
      await setup();
      await expect(
        db.transaction(async (tx) => {
          await insertTx(tx, { id: 't1' });
          await insertTx(tx, { id: 't2', amount: -5 });
        }),
      ).rejects.toBeInstanceOf(SqlError);
      expect(await db.get("SELECT next_seq FROM accounts WHERE id = 'acc1'")).toEqual({ next_seq: 1 });
      expect(await db.transaction((tx) => insertTx(tx, { id: 't3' }))).toBe(1);
    });
  });

  describe('columnas inmutables del movimiento', () => {
    beforeEach(async () => {
      await setup();
      await db.transaction(async (tx) => {
        await account(tx, 'acc2');
        await insertTx(tx, { id: 't1' });
      });
    });

    it.each([
      ['seq', "seq = 9"],
      ['account_id', "account_id = 'acc2'"],
      ['recorded_at', "recorded_at = '2027-01-01T00:00:00.000Z'"],
      ['id', "id = 'otro'"],
      ['batch_id', "batch_id = 'b1'"],
    ])('UPDATE de %s lo rechaza la BD (immutable_column)', async (_col, assignment) => {
      expect(await codeOf(db.run(`UPDATE transactions SET ${assignment} WHERE id = 't1'`))).toBe('immutable_column');
    });

    it('income↔expense se permite; a transfer u opening no', async () => {
      await db.run("UPDATE transactions SET kind = 'expense', direction = 'out' WHERE id = 't1'");
      expect(await db.get("SELECT kind, direction FROM transactions WHERE id = 't1'")).toEqual({
        kind: 'expense',
        direction: 'out',
      });
      expect(await codeOf(db.run("UPDATE transactions SET kind = 'opening' WHERE id = 't1'"))).toBe('immutable_column');
      expect(
        await codeOf(db.run("UPDATE transactions SET kind = 'transfer', transfer_group_id = 'g' WHERE id = 't1'")),
      ).toBe('immutable_column');
    });

    it('los campos editables sí se actualizan', async () => {
      const r = await db.run(
        "UPDATE transactions SET amount_minor = 2500, description = 'Venta editada', updated_at = ? WHERE id = 't1'",
        [T],
      );
      expect(r).toEqual({ changes: 1 });
    });
  });

  describe('integridad entre tablas', () => {
    it('movimiento con cuenta de otro espacio → workspace_mismatch', async () => {
      await setup();
      await db.transaction(async (tx) => {
        await workspace(tx, 'ws2');
      });
      expect(await codeOf(db.transaction((tx) => insertTx(tx, { id: 't1', ws: 'ws2' })))).toBe('workspace_mismatch');
    });

    it('un solo saldo inicial por cuenta y una transferencia con un lado de cada dirección', async () => {
      await setup();
      await db.transaction(async (tx) => {
        await account(tx, 'acc2');
        await insertTx(tx, { id: 'o1', kind: 'opening' });
      });
      expect(await codeOf(db.transaction((tx) => insertTx(tx, { id: 'o2', kind: 'opening' })))).toMatch(/^sql:.*UNIQUE/);

      await db.transaction(async (tx) => {
        await insertTx(tx, { id: 'x1', kind: 'transfer', direction: 'out', transferGroup: 'g1' });
        await insertTx(tx, { id: 'x2', account: 'acc2', kind: 'transfer', direction: 'in', transferGroup: 'g1' });
      });
      expect(
        await codeOf(
          db.transaction((tx) =>
            insertTx(tx, { id: 'x3', account: 'acc2', kind: 'transfer', direction: 'in', transferGroup: 'g1' }),
          ),
        ),
      ).toMatch(/^sql:.*UNIQUE/);
    });

    it('CHECK y STRICT: monto negativo, tipo incoherente o texto en INTEGER fallan', async () => {
      await setup();
      expect(await codeOf(db.transaction((tx) => insertTx(tx, { id: 't1', amount: -1 })))).toMatch(/^sql:.*CHECK/);
      expect(await codeOf(db.transaction((tx) => insertTx(tx, { id: 't2', kind: 'income', direction: 'out' })))).toMatch(
        /^sql:.*CHECK/,
      );
      expect(await codeOf(db.transaction((tx) => insertTx(tx, { id: 't3', kind: 'transfer' })))).toMatch(/^sql:.*CHECK/);
      expect(
        await codeOf(
          db.run("UPDATE accounts SET sort_order = 'mucho' WHERE id = 'acc1'"),
        ),
      ).toMatch(/^sql:.*(datatype|INTEGER)/i);
    });

    it('FK: cuenta en un espacio inexistente falla', async () => {
      expect(await codeOf(db.transaction((tx) => account(tx, 'accX', 'nope')))).toMatch(/^sql:.*FOREIGN KEY/);
    });
  });

  describe('campos personalizables', () => {
    beforeEach(async () => {
      await setup();
      await db.run(
        `INSERT INTO fields (id, workspace_id, key, label, type, created_at, updated_at) VALUES
           ('cat', 'ws1', 'categoria', 'Categoría', 'list', ?, ?),
           ('pm', 'ws1', 'metodo', 'Método', 'list', ?, ?),
           ('ref', 'ws1', 'ref', 'Referencia', 'text', ?, ?)`,
        [T, T, T, T, T, T],
      );
      await db.run(
        `INSERT INTO field_options (id, field_id, label, created_at, updated_at) VALUES
           ('o1', 'cat', 'Ventas', ?, ?), ('o2', 'pm', 'Efectivo', ?, ?)`,
        [T, T, T, T],
      );
      await db.transaction((tx) => insertTx(tx, { id: 't1' }));
    });

    it('cambiar el tipo de un campo → field_type_immutable', async () => {
      expect(await codeOf(db.run("UPDATE fields SET type = 'text' WHERE id = 'cat'"))).toBe('field_type_immutable');
      await db.run("UPDATE fields SET label = 'Rubro' WHERE id = 'cat'");
    });

    it('opciones solo en campos de lista → options_require_list_field', async () => {
      expect(
        await codeOf(
          db.run("INSERT INTO field_options (id, field_id, label, created_at, updated_at) VALUES ('o3', 'ref', 'X', ?, ?)", [
            T,
            T,
          ]),
        ),
      ).toBe('options_require_list_field');
    });

    it('valor en la columna equivocada u opción de otro campo → field_value_type_mismatch', async () => {
      expect(
        await codeOf(db.run("INSERT INTO transaction_field_values (transaction_id, field_id, value_number) VALUES ('t1', 'ref', 3)")),
      ).toBe('field_value_type_mismatch');
      expect(
        await codeOf(
          db.run("INSERT INTO transaction_field_values (transaction_id, field_id, value_option_id) VALUES ('t1', 'cat', 'o2')"),
        ),
      ).toBe('field_value_type_mismatch');
      await db.run("INSERT INTO transaction_field_values (transaction_id, field_id, value_option_id) VALUES ('t1', 'cat', 'o1')");
      expect(
        await codeOf(db.run("UPDATE transaction_field_values SET value_option_id = 'o2' WHERE transaction_id = 't1'")),
      ).toBe('field_value_type_mismatch');
    });

    it('un movimiento no puede tener dos valores del mismo campo', async () => {
      await db.run("INSERT INTO transaction_field_values (transaction_id, field_id, value_option_id) VALUES ('t1', 'cat', 'o1')");
      await db.run("INSERT INTO field_options (id, field_id, label, created_at, updated_at) VALUES ('o4', 'cat', 'Otros', ?, ?)", [
        T,
        T,
      ]);
      expect(
        await codeOf(
          db.run("INSERT INTO transaction_field_values (transaction_id, field_id, value_option_id) VALUES ('t1', 'cat', 'o4')"),
        ),
      ).toMatch(/^sql:.*UNIQUE/);
    });

    it('una opción con valores no se borra (FK) y una etiqueta activa no se repite', async () => {
      await db.run("INSERT INTO transaction_field_values (transaction_id, field_id, value_option_id) VALUES ('t1', 'cat', 'o1')");
      expect(await codeOf(db.run("DELETE FROM field_options WHERE id = 'o1'"))).toMatch(/^sql:.*FOREIGN KEY/);
      expect(
        await codeOf(
          db.run("INSERT INTO field_options (id, field_id, label, created_at, updated_at) VALUES ('o5', 'cat', 'ventas', ?, ?)", [
            T,
            T,
          ]),
        ),
      ).toMatch(/^sql:.*UNIQUE/);
    });
  });
});
