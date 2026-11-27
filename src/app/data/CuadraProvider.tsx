import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import type { ChangeEvent, Cuadra, TableName } from '../../core';
import { queryClient as defaultQueryClient } from './queryClient';

const CuadraContext = createContext<Cuadra | null>(null);

export function useCuadra(): Cuadra {
  const cuadra = useContext(CuadraContext);
  if (cuadra === null) throw new Error('useCuadra debe usarse dentro de <CuadraProvider>');
  return cuadra;
}

/** Decide si una consulta (por su meta y su clave) queda afectada por un evento del núcleo. */
export function isAffected(event: ChangeEvent, meta: unknown, queryKey: readonly unknown[]): boolean {
  const tables = ((meta as { tables?: TableName[] } | undefined)?.tables ?? []) as TableName[];
  const ws = queryKey[1];
  return (
    tables.some((t) => event.tables.includes(t)) &&
    (event.workspaceId === null || ws === event.workspaceId || ws === undefined)
  );
}

/** Puente núcleo → caché: cada COMMIT invalida solo las consultas que dependen de las tablas tocadas. */
export function CuadraProvider({
  cuadra,
  queryClient = defaultQueryClient,
  children,
}: {
  cuadra: Cuadra;
  queryClient?: QueryClient;
  children: ReactNode;
}) {
  useEffect(
    () =>
      cuadra.subscribe((event) => {
        void queryClient.invalidateQueries({ predicate: (q) => isAffected(event, q.meta, q.queryKey) });
      }),
    [cuadra, queryClient],
  );
  return (
    <CuadraContext.Provider value={cuadra}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </CuadraContext.Provider>
  );
}
