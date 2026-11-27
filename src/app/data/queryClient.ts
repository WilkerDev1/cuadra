import { QueryClient } from '@tanstack/react-query';

/** Los datos solo cambian por eventos propios; los errores de dominio no se reintentan; no hay red. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, retry: 0, networkMode: 'always', refetchOnWindowFocus: false },
      mutations: { retry: 0, networkMode: 'always' },
    },
  });
}

export const queryClient = createQueryClient();
