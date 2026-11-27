// Ayudas de PRUEBA para los servicios de movimientos (2A). No lo importa ningún módulo de la app.
// Siembra espacios, cuentas y campos con SQL directo para que las pruebas de movimientos no dependan de
// los servicios de estructura (2B), y ofrece las consultas canónicas de 2.3 para comprobar saldos.
import type { Clock, IdGen, SqlDriver, SqlExecutor } from '../ports';
import { insertSql, recordValues } from '../sql/rows';
import type { AccountType, FieldType, Id, Minor } from '../types';

export interface Kit {
  driver: SqlDriver;
  ids: IdGen;
  clock: Clock;
}

const now = (kit: Kit) => kit.clock.now().toISOString();

export async function seedWorkspace(
  kit: Kit,
  opts: { name?: string; minorDigits?: 0 | 2 | 3; archived?: boolean } = {},
): Promise<Id> {
  const id = kit.ids.next();
  const at = now(kit);
  await kit.driver.run(
    insertSql('workspaces'),
    recordValues('workspaces', {
      id,
      name: opts.name ?? 'Colmado de prueba',
      owner_name: '',
      template_id: null,
      currency_code: 'DOP',
      currency_symbol: null,
      minor_digits: opts.minorDigits ?? 2,
      logo_data_url: null,
      color: null,
      sort_order: 0,
      is_demo: 0,
      archived_at: opts.archived ? at : null,
      created_at: at,
      updated_at: at,
    }),
  );
  return id;
}

export async function seedAccount(
  kit: Kit,
  workspaceId: Id,
  opts: { name?: string; type?: AccountType; archived?: boolean } = {},
): Promise<Id> {
  const id = kit.ids.next();
  const at = now(kit);
  await kit.driver.run(
    insertSql('accounts'),
    recordValues('accounts', {
      id,
      workspace_id: workspaceId,
      name: opts.name ?? `Cuenta ${id.slice(-4)}`,
      type: opts.type ?? 'cash',
      color: null,
      icon: null,
      sort_order: 0,
      next_seq: 1,
      archived_at: opts.archived ? at : null,
      created_at: at,
      updated_at: at,
    }),
  );
  return id;
}

export async function archiveAccount(kit: Kit, accountId: Id): Promise<void> {
  await kit.driver.run('UPDATE accounts SET archived_at = ? WHERE id = ?', [now(kit), accountId]);
}

export interface SeededField {
  id: Id;
  /** etiqueta → id de opción */
  options: Record<string, Id>;
}

export async function seedField(
  kit: Kit,
  workspaceId: Id,
  input: { key: string; label?: string; type: FieldType; options?: string[]; inactive?: boolean },
): Promise<SeededField> {
  const id = kit.ids.next();
  const at = now(kit);
  await kit.driver.run(
    insertSql('fields'),
    recordValues('fields', {
      id,
      workspace_id: workspaceId,
      key: input.key,
      label: input.label ?? input.key,
      type: input.type,
      role: null,
      applies_to: 'both',
      sort_order: 0,
      show_in_list: 0,
      deactivated_at: input.inactive ? at : null,
      created_at: at,
      updated_at: at,
    }),
  );
  const options: Record<string, Id> = {};
  for (const [i, label] of (input.options ?? []).entries()) {
    const optionId = kit.ids.next();
    options[label] = optionId;
    await kit.driver.run(
      insertSql('field_options'),
      recordValues('field_options', {
        id: optionId,
        field_id: id,
        key: null,
        label,
        color: null,
        applies_to: 'both',
        sort_order: i,
        deactivated_at: null,
        merged_into_id: null,
        created_at: at,
        updated_at: at,
      }),
    );
  }
  return { id, options };
}

export async function deactivateField(kit: Kit, fieldId: Id): Promise<void> {
  await kit.driver.run('UPDATE fields SET deactivated_at = ? WHERE id = ?', [now(kit), fieldId]);
}

export async function deactivateOption(kit: Kit, optionId: Id): Promise<void> {
  await kit.driver.run('UPDATE field_options SET deactivated_at = ? WHERE id = ?', [now(kit), optionId]);
}

// ── Consultas canónicas (ARCHITECTURE.md 2.3) ────────────────────────────────────────

/** Saldo de una cuenta: Σ con signo de sus movimientos activos de todo tipo (I-1). */
export async function balanceOf(ex: SqlExecutor, accountId: Id): Promise<Minor> {
  const row = await ex.get<{ b: number | null }>(
    `SELECT SUM(CASE direction WHEN 'in' THEN amount_minor ELSE -amount_minor END) AS b
     FROM transactions WHERE account_id = ? AND status = 'active'`,
    [accountId],
  );
  return Number(row?.b ?? 0);
}

export interface CanonicalTotals {
  inMinor: Minor;
  outMinor: Minor;
  transfersInMinor: Minor;
  transfersOutMinor: Minor;
  openingsMinor: Minor;
  count: number;
}

/** Totales del espacio (activos): transferencias y saldos iniciales en líneas propias (I-3). */
export async function totalsOf(ex: SqlExecutor, workspaceId: Id): Promise<CanonicalTotals> {
  const r = await ex.get<Record<string, number | null>>(
    `SELECT
       SUM(CASE WHEN kind = 'income'  THEN amount_minor ELSE 0 END) AS in_minor,
       SUM(CASE WHEN kind = 'expense' THEN amount_minor ELSE 0 END) AS out_minor,
       SUM(CASE WHEN kind = 'transfer' AND direction = 'in'  THEN amount_minor ELSE 0 END) AS tin,
       SUM(CASE WHEN kind = 'transfer' AND direction = 'out' THEN amount_minor ELSE 0 END) AS tout,
       SUM(CASE WHEN kind = 'opening' THEN CASE direction WHEN 'in' THEN amount_minor ELSE -amount_minor END ELSE 0 END) AS op,
       COUNT(*) AS n
     FROM transactions WHERE workspace_id = ? AND status = 'active'`,
    [workspaceId],
  );
  return {
    inMinor: Number(r?.['in_minor'] ?? 0),
    outMinor: Number(r?.['out_minor'] ?? 0),
    transfersInMinor: Number(r?.['tin'] ?? 0),
    transfersOutMinor: Number(r?.['tout'] ?? 0),
    openingsMinor: Number(r?.['op'] ?? 0),
    count: Number(r?.['n'] ?? 0),
  };
}

export async function countRows(ex: SqlExecutor, table: string, where = '1 = 1', params: readonly (string | number)[] = []): Promise<number> {
  const r = await ex.get<{ n: number }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`, params);
  return Number(r?.n ?? 0);
}

export async function nextSeqOf(ex: SqlExecutor, accountId: Id): Promise<number> {
  const r = await ex.get<{ n: number }>('SELECT next_seq AS n FROM accounts WHERE id = ?', [accountId]);
  return Number(r?.n ?? 0);
}

/** Código de un DomainError (o 'sql:<mensaje>' para otros errores con mensaje). */
export async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const e = error as { name?: string; code?: unknown; message?: string };
    if (e.name === 'DomainError' && typeof e.code === 'string') return e.code;
    return `sql:${e.message ?? String(error)}`;
  }
  throw new Error('se esperaba un error');
}
