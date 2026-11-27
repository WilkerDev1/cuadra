import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { Cuadra, DomainError, TableName } from '../../core';
import { useCuadra } from './CuadraProvider';

export interface CuadraQueryOptions<T> {
  /** `['transactions.list', wsId, filter]`: el segundo elemento es el espacio. */
  key: readonly unknown[];
  /** De qué tablas depende: se guarda en `meta.tables` para la invalidación por eventos. */
  tables: TableName[];
  fn: (c: Cuadra) => Promise<T>;
  enabled?: boolean;
}

export function useCuadraQuery<T>(opts: CuadraQueryOptions<T>): UseQueryResult<T, DomainError> {
  const cuadra = useCuadra();
  return useQuery<T, DomainError>({
    queryKey: opts.key,
    queryFn: () => opts.fn(cuadra),
    meta: { tables: opts.tables },
    enabled: opts.enabled ?? true,
  });
}
