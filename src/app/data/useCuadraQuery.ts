import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { Cuadra, DomainError, TableName } from '../../core';
import { useCuadra } from './CuadraProvider';

export interface CuadraQueryOptions<T, R = T> {
  /** `['transactions.list', wsId, filter]`: el segundo elemento es el espacio (`undefined` si es global). */
  key: readonly unknown[];
  /** De qué tablas depende: se guarda en `meta.tables` para la invalidación por eventos. */
  tables: TableName[];
  fn: (c: Cuadra) => Promise<T>;
  enabled?: boolean;
  /** Deriva otra forma del resultado sin otra consulta (misma caché que la consulta base). */
  select?: (data: T) => R;
  /** Mientras llega la nueva respuesta se sigue mostrando la anterior (filtros, páginas): sin parpadeo. */
  keepPrevious?: boolean;
}

/** Definición de una consulta lista para `useCuadraQuery` (la usan los hooks y las pruebas). */
export interface QueryDef<T> {
  key: readonly unknown[];
  tables: TableName[];
  fn: (c: Cuadra) => Promise<T>;
}

export function useCuadraQuery<T, R = T>(opts: CuadraQueryOptions<T, R>): UseQueryResult<R, DomainError> {
  const cuadra = useCuadra();
  return useQuery<T, DomainError, R>({
    queryKey: opts.key,
    queryFn: () => opts.fn(cuadra),
    meta: { tables: opts.tables },
    enabled: opts.enabled ?? true,
    ...(opts.select === undefined ? {} : { select: opts.select }),
    ...(opts.keepPrevious === true ? { placeholderData: keepPreviousData } : {}),
  });
}
