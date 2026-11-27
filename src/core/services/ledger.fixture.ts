// Siembra de datos para las pruebas de consultas, informes y vistas (2C).
//
// Escribe con SQL directo, respetando los triggers de 001_init.sql (seq reservado, mismo espacio, una
// transferencia = dos filas), para que las pruebas de lectura no dependan de que los servicios de escritura
// (2A/2B) estén terminados. Solo usa el puerto SqlExecutor: no importa node:* ni nada fuera de core.
// No lo importa ningún módulo de producción.
import type { IdGen, SqlExecutor } from '../ports';
import { buildSearchText } from '../text';
import type { AccountType, Direction, FieldRole, FieldType, Id, IsoDate, Minor, TxKind } from '../types';
import { insertSql, recordValues } from '../sql/rows';

export interface FixtureTxOptions {
  notes?: string;
  values?: Record<Id, FixtureValue>;
  batchId?: Id | null;
  voided?: string | true; // motivo
  recordedAt?: string;
}
export type FixtureValue =
  | { option: Id }
  | { text: string }
  | { number: number }
  | { date: IsoDate }
  | { bool: boolean };

export interface FixtureField {
  id: Id;
  opt: Record<string, Id>;
}

export interface LedgerFixture {
  exec: SqlExecutor;
  workspace(opts?: { name?: string; ownerName?: string; minorDigits?: 0 | 2 | 3; symbol?: string | null }): Promise<Id>;
  account(ws: Id, name: string, opts?: { type?: AccountType; archived?: boolean; sortOrder?: number }): Promise<Id>;
  field(
    ws: Id,
    def: { key: string; label: string; type: FieldType; role?: FieldRole; options?: string[]; sortOrder?: number },
  ): Promise<FixtureField>;
  deactivateField(fieldId: Id): Promise<void>;
  deactivateOption(optionId: Id, mergedIntoId?: Id): Promise<void>;
  renameOption(optionId: Id, label: string): Promise<void>;
  tx(
    accountId: Id,
    t: { kind: TxKind; direction?: Direction; amount: Minor; date: IsoDate; description: string; groupId?: Id },
    opts?: FixtureTxOptions,
  ): Promise<Id>;
  income(accountId: Id, amount: Minor, date: IsoDate, description: string, opts?: FixtureTxOptions): Promise<Id>;
  expense(accountId: Id, amount: Minor, date: IsoDate, description: string, opts?: FixtureTxOptions): Promise<Id>;
  opening(accountId: Id, amount: Minor, date: IsoDate, direction?: Direction, opts?: FixtureTxOptions): Promise<Id>;
  transfer(
    fromId: Id,
    toId: Id,
    amount: Minor,
    date: IsoDate,
    description: string,
    opts?: FixtureTxOptions,
  ): Promise<{ out: Id; in: Id; groupId: Id }>;
  voidTx(id: Id, reason?: string): Promise<void>;
  batch(
    ws: Id,
    b: { accountId?: Id | null; source?: 'capture' | 'import' | 'template' | 'demo'; label?: string; control?: Minor | null; accepted?: boolean },
  ): Promise<Id>;
  setting(key: string, value: unknown, scopeId?: string): Promise<void>;
}

const NOW = '2026-06-15T12:00:00.000Z';

export function ledgerFixture(exec: SqlExecutor, ids: IdGen): LedgerFixture {
  const wsOf = new Map<Id, Id>();
  const fieldTypes = new Map<Id, FieldType>();

  async function insertValues(txId: Id, values: Record<Id, FixtureValue> | undefined): Promise<void> {
    for (const [fieldId, v] of Object.entries(values ?? {})) {
      await exec.run(
        insertSql('transaction_field_values'),
        recordValues('transaction_field_values', {
          transaction_id: txId,
          field_id: fieldId,
          value_option_id: 'option' in v ? v.option : null,
          value_text: 'text' in v ? v.text : null,
          value_number: 'number' in v ? v.number : null,
          value_date: 'date' in v ? v.date : null,
          value_bool: 'bool' in v ? (v.bool ? 1 : 0) : null,
        }),
      );
    }
  }

  const fx: LedgerFixture = {
    exec,
    async workspace(opts = {}) {
      const id = ids.next();
      await exec.run(
        insertSql('workspaces'),
        recordValues('workspaces', {
          id,
          name: opts.name ?? 'Colmado La Esquina',
          owner_name: opts.ownerName ?? 'Ana Pérez',
          template_id: null,
          currency_code: 'DOP',
          currency_symbol: opts.symbol === undefined ? 'RD$' : opts.symbol,
          minor_digits: opts.minorDigits ?? 2,
          logo_data_url: null,
          color: null,
          sort_order: 0,
          is_demo: 0,
          archived_at: null,
          created_at: NOW,
          updated_at: NOW,
        }),
      );
      return id;
    },
    async account(ws, name, opts = {}) {
      const id = ids.next();
      await exec.run(
        insertSql('accounts'),
        recordValues('accounts', {
          id,
          workspace_id: ws,
          name,
          type: opts.type ?? 'cash',
          color: null,
          icon: null,
          sort_order: opts.sortOrder ?? wsOf.size,
          next_seq: 1,
          archived_at: opts.archived ? NOW : null,
          created_at: NOW,
          updated_at: NOW,
        }),
      );
      wsOf.set(id, ws);
      return id;
    },
    async field(ws, def) {
      const id = ids.next();
      await exec.run(
        insertSql('fields'),
        recordValues('fields', {
          id,
          workspace_id: ws,
          key: def.key,
          label: def.label,
          type: def.type,
          role: def.role ?? null,
          applies_to: 'both',
          sort_order: def.sortOrder ?? fieldTypes.size,
          show_in_list: 0,
          deactivated_at: null,
          created_at: NOW,
          updated_at: NOW,
        }),
      );
      fieldTypes.set(id, def.type);
      const opt: Record<string, Id> = {};
      for (const [i, label] of (def.options ?? []).entries()) {
        const oid = ids.next();
        await exec.run(
          insertSql('field_options'),
          recordValues('field_options', {
            id: oid,
            field_id: id,
            key: null,
            label,
            color: `#00${i}`,
            applies_to: 'both',
            sort_order: i,
            deactivated_at: null,
            merged_into_id: null,
            created_at: NOW,
            updated_at: NOW,
          }),
        );
        opt[label] = oid;
      }
      return { id, opt };
    },
    async deactivateField(fieldId) {
      await exec.run('UPDATE fields SET deactivated_at = ? WHERE id = ?', [NOW, fieldId]);
    },
    async deactivateOption(optionId, mergedIntoId) {
      if (mergedIntoId !== undefined) {
        await exec.run('UPDATE transaction_field_values SET value_option_id = ? WHERE value_option_id = ?', [
          mergedIntoId,
          optionId,
        ]);
      }
      await exec.run('UPDATE field_options SET deactivated_at = ?, merged_into_id = ? WHERE id = ?', [
        NOW,
        mergedIntoId ?? null,
        optionId,
      ]);
    },
    async renameOption(optionId, label) {
      await exec.run('UPDATE field_options SET label = ? WHERE id = ?', [label, optionId]);
    },
    async tx(accountId, t, opts = {}) {
      const ws =
        wsOf.get(accountId) ??
        (await exec.get<{ workspace_id: string }>('SELECT workspace_id FROM accounts WHERE id = ?', [accountId]))
          ?.workspace_id;
      if (ws === undefined) throw new Error(`cuenta desconocida en el fixture: ${accountId}`);
      const reserved = await exec.get<{ seq: number }>(
        'UPDATE accounts SET next_seq = next_seq + 1 WHERE id = ? RETURNING next_seq - 1 AS seq',
        [accountId],
      );
      const id = ids.next();
      const direction = t.direction ?? (t.kind === 'expense' ? 'out' : 'in');
      const notes = opts.notes ?? '';
      const voided = opts.voided !== undefined;
      await exec.run(
        insertSql('transactions'),
        recordValues('transactions', {
          id,
          workspace_id: ws,
          account_id: accountId,
          seq: reserved?.seq ?? 0,
          kind: t.kind,
          direction,
          amount_minor: t.amount,
          date: t.date,
          description: t.description,
          notes,
          search_text: buildSearchText(t.description, notes),
          status: voided ? 'voided' : 'active',
          void_reason: voided && typeof opts.voided === 'string' ? opts.voided : null,
          voided_at: voided ? NOW : null,
          voided_with_batch: 0,
          batch_id: opts.batchId ?? null,
          transfer_group_id: t.groupId ?? null,
          recorded_at: opts.recordedAt ?? NOW,
          updated_at: NOW,
        }),
      );
      await insertValues(id, opts.values);
      return id;
    },
    income(accountId, amount, date, description, opts) {
      return fx.tx(accountId, { kind: 'income', amount, date, description }, opts);
    },
    expense(accountId, amount, date, description, opts) {
      return fx.tx(accountId, { kind: 'expense', amount, date, description }, opts);
    },
    opening(accountId, amount, date, direction = 'in', opts) {
      return fx.tx(accountId, { kind: 'opening', direction, amount, date, description: 'Saldo inicial' }, opts);
    },
    async transfer(fromId, toId, amount, date, description, opts = {}) {
      const groupId = ids.next();
      const out = await fx.tx(fromId, { kind: 'transfer', direction: 'out', amount, date, description, groupId }, opts);
      const inn = await fx.tx(toId, { kind: 'transfer', direction: 'in', amount, date, description, groupId }, {
        ...opts,
        values: {},
      });
      return { out, in: inn, groupId };
    },
    async voidTx(id, reason = 'Error') {
      await exec.run("UPDATE transactions SET status = 'voided', voided_at = ?, void_reason = ? WHERE id = ?", [
        NOW,
        reason,
        id,
      ]);
    },
    async batch(ws, b) {
      const id = ids.next();
      await exec.run(
        insertSql('batches'),
        recordValues('batches', {
          id,
          workspace_id: ws,
          account_id: b.accountId ?? null,
          source: b.source ?? 'capture',
          label: b.label ?? 'Lote',
          control_total_minor: b.control ?? null,
          control_mismatch_accepted: b.accepted ? 1 : 0,
          meta: null,
          created_at: NOW,
        }),
      );
      return id;
    },
    async setting(key, value, scopeId = '') {
      await exec.run(
        'INSERT INTO settings (scope_id, key, value, updated_at) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT (scope_id, key) DO UPDATE SET value = excluded.value',
        [scopeId, key, JSON.stringify(value), NOW],
      );
    },
  };
  return fx;
}

/** PRNG determinista (mulberry32) para casos aleatorios reproducibles. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
