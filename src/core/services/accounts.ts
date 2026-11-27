// Cuentas (ARCHITECTURE.md 3.5). Stub de la Oleada 1: firma completa, lo implementa la Oleada 2 (2B).
import { notImplemented } from '../errors';
import type { Account, AccountType, AccountWithBalance, Direction, Id, IsoDate, Minor, Mutation } from '../types';
import type { CoreDeps } from '../uow';

export interface OpeningInput {
  amountMinor: Minor;
  direction: Direction;
  date: IsoDate;
}

export interface AccountsService {
  list(workspaceId: Id, opts?: { includeArchived?: boolean; asOf?: IsoDate }): Promise<AccountWithBalance[]>;
  get(id: Id): Promise<AccountWithBalance>;
  create(input: {
    workspaceId: Id;
    name: string;
    type?: AccountType;
    color?: string;
    icon?: string;
    opening?: OpeningInput;
  }): Promise<Mutation<Account>>; // opening con 0 → no se crea
  update(id: Id, patch: Partial<Pick<Account, 'name' | 'type' | 'color' | 'icon'>>): Promise<Mutation<Account>>;
  reorder(workspaceId: Id, ids: Id[]): Promise<void>;
  archive(id: Id): Promise<Mutation<Account>>; // conserva movimientos; rechaza nuevos
  unarchive(id: Id): Promise<Mutation<Account>>;
}

export function createAccountsService(_deps: CoreDeps): AccountsService {
  return {
    list: async () => notImplemented('accounts.list'),
    get: async () => notImplemented('accounts.get'),
    create: async () => notImplemented('accounts.create'),
    update: async () => notImplemented('accounts.update'),
    reorder: async () => notImplemented('accounts.reorder'),
    archive: async () => notImplemented('accounts.archive'),
    unarchive: async () => notImplemented('accounts.unarchive'),
  };
}
