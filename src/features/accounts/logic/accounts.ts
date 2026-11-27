// Lógica pura de la pantalla de Cuentas: grupos por tipo, orden manual y formulario de saldo inicial.
import { Money, type AccountType, type AccountWithBalance, type Direction, type IsoDate, type Minor, type MoneyParseError, type Result } from '../../../core';

/** Orden de los grupos en móvil (DESIGN §10.4): Efectivo, Banco, Tarjeta y el resto. */
export const TYPE_ORDER: readonly AccountType[] = ['cash', 'bank', 'card', 'savings', 'wallet', 'other'];

export interface AccountGroup {
  type: AccountType;
  accounts: AccountWithBalance[];
  subtotalMinor: Minor;
}

export function splitArchived(accounts: readonly AccountWithBalance[]): { active: AccountWithBalance[]; archived: AccountWithBalance[] } {
  const sorted = [...accounts].sort((a, b) => a.sortOrder - b.sortOrder);
  return { active: sorted.filter((a) => a.archivedAt === null), archived: sorted.filter((a) => a.archivedAt !== null) };
}

export function groupByType(accounts: readonly AccountWithBalance[]): AccountGroup[] {
  return TYPE_ORDER.flatMap((type) => {
    const list = accounts.filter((a) => a.type === type);
    return list.length === 0 ? [] : [{ type, accounts: list, subtotalMinor: Money.sum(list.map((a) => a.balanceMinor)) }];
  });
}

export function totalOf(accounts: readonly AccountWithBalance[]): Minor {
  return Money.sum(accounts.map((a) => a.balanceMinor));
}

/** Mueve `id` una posición (`delta` −1 arriba, +1 abajo). Sin cambio en los bordes. */
export function moveBy(ids: readonly string[], id: string, delta: number): string[] {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return [...ids];
  return moveTo(ids, from, to);
}

/** Saca el elemento de `from` y lo deja en el índice `to` del resultado. */
export function moveTo(ids: readonly string[], from: number, to: number): string[] {
  const next = [...ids];
  const [item] = next.splice(from, 1);
  if (item === undefined) return [...ids];
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

/**
 * Hueco de destino al arrastrar (guía drag-and-drop): antes del primer elemento cuyo punto medio queda por debajo
 * del puntero; al final si no hay ninguno. Devuelve el índice de inserción en la lista original (0…n).
 */
export function dropSlot(midpoints: readonly number[], pointerY: number): number {
  const i = midpoints.findIndex((m) => pointerY < m);
  return i === -1 ? midpoints.length : i;
}

/** Índice final tras soltar en el hueco `slot` el elemento que estaba en `from`. */
export function slotToIndex(from: number, slot: number): number {
  return slot > from ? slot - 1 : slot;
}

/** Orden completo para `accounts.reorder`: las activas en su nuevo orden y detrás las archivadas. */
export function fullOrder(activeIds: readonly string[], archived: readonly AccountWithBalance[]): string[] {
  return [...activeIds, ...archived.map((a) => a.id)];
}

export interface OpeningForm {
  amount: string;
  direction: Direction;
  date: IsoDate;
}

export type OpeningError = MoneyParseError | 'date_required';

/** Valida el formulario de saldo inicial. El monto se escribe siempre positivo; el sentido va aparte. */
export function parseOpening(
  form: OpeningForm,
  parse: (s: string) => Result<Minor, MoneyParseError>,
): Result<{ amountMinor: Minor; direction: Direction; date: IsoDate }, OpeningError> {
  const r = parse(form.amount);
  if (!r.ok) return r;
  if (form.date === '') return { ok: false, error: 'date_required' };
  return { ok: true, value: { amountMinor: r.value, direction: form.direction, date: form.date } };
}

/** Saldo con signo del saldo inicial, para mostrarlo. */
export function signedOpening(amountMinor: Minor, direction: Direction): Minor {
  return Money.signed(amountMinor, direction);
}
