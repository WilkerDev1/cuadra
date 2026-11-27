// Reglas puras de la Transferencia (DESIGN §10.7): par de cuentas por defecto, invertir y saldos resultantes.
import type { AccountWithBalance, Id, Minor } from '../../../core';

export interface TransferPair {
  fromId: Id | null;
  toId: Id | null;
}

/** Desde = la preferida (o la primera activa); Hacia = la siguiente activa distinta. */
export function defaultPair(accounts: readonly AccountWithBalance[], preferredFrom: Id | null, preferredTo: Id | null = null): TransferPair {
  const active = accounts.filter((a) => a.archivedAt === null);
  const fromId = active.find((a) => a.id === preferredFrom)?.id ?? active[0]?.id ?? null;
  const toId =
    active.find((a) => a.id === preferredTo && a.id !== fromId)?.id ?? active.find((a) => a.id !== fromId)?.id ?? null;
  return { fromId, toId };
}

/** Elegir una cuenta en un lado: si coincide con la del otro lado, se intercambian. */
export function choose(pair: TransferPair, side: 'from' | 'to', id: Id): TransferPair {
  if (side === 'from') return id === pair.toId ? { fromId: id, toId: pair.fromId } : { ...pair, fromId: id };
  return id === pair.fromId ? { fromId: pair.toId, toId: id } : { ...pair, toId: id };
}

export function swap(pair: TransferPair): TransferPair {
  return { fromId: pair.toId, toId: pair.fromId };
}

export interface BalanceLine {
  accountId: Id;
  name: string;
  beforeMinor: Minor;
  afterMinor: Minor;
}

/**
 * `Caja RD$12,400.00 → RD$9,400.00` / `Banco RD$3,100.00 → RD$6,100.00`. Al editar una transferencia ya guardada,
 * `previousMinor` es su monto actual: el saldo de hoy ya lo incluye y solo se aplica la diferencia.
 */
export function previewBalances(
  accounts: readonly AccountWithBalance[],
  pair: TransferPair,
  amountMinor: Minor,
  previousMinor: Minor = 0,
): BalanceLine[] {
  const from = accounts.find((a) => a.id === pair.fromId);
  const to = accounts.find((a) => a.id === pair.toId);
  if (from === undefined || to === undefined || from.id === to.id) return [];
  const delta = amountMinor - previousMinor;
  const lines: BalanceLine[] = [
    { accountId: from.id, name: from.name, beforeMinor: from.balanceMinor, afterMinor: from.balanceMinor - delta },
    { accountId: to.id, name: to.name, beforeMinor: to.balanceMinor, afterMinor: to.balanceMinor + delta },
  ];
  return lines.every((l) => Number.isSafeInteger(l.afterMinor)) ? lines : [];
}

export type TransferError = 'amount' | 'from' | 'to' | 'same';

export function validateTransfer(pair: TransferPair, amountMinor: Minor | null): TransferError[] {
  const errors: TransferError[] = [];
  if (amountMinor === null || amountMinor <= 0) errors.push('amount');
  if (pair.fromId === null) errors.push('from');
  if (pair.toId === null) errors.push('to');
  if (pair.fromId !== null && pair.fromId === pair.toId) errors.push('same');
  return errors;
}
