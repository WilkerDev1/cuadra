import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import type { Cuadra, DomainError, Mutation } from '../../core';
import { useUiStore } from '../state/uiStore';
import { useCuadra } from './CuadraProvider';

export interface CuadraMutationOptions<O> {
  /** Clave i18n del aviso, o función que la calcula a partir del resultado. */
  successToast?: string | ((o: O) => string);
  /** Si existe, el aviso lleva «Deshacer» (por ejemplo, anular lo recién creado). */
  undo?: (c: Cuadra, o: O) => Promise<unknown>;
}

export function useCuadraMutation<I, O>(
  fn: (c: Cuadra, input: I) => Promise<Mutation<O>>,
  opts?: CuadraMutationOptions<O>,
): UseMutationResult<Mutation<O>, DomainError, I> {
  const cuadra = useCuadra();
  const pushToast = useUiStore((s) => s.pushToast);
  return useMutation<Mutation<O>, DomainError, I>({
    mutationFn: (input) => fn(cuadra, input),
    onSuccess: (result) => {
      const toast = opts?.successToast;
      if (toast === undefined) return;
      const message = typeof toast === 'function' ? toast(result.value) : toast;
      const undo = opts?.undo;
      pushToast({
        message,
        ...(undo === undefined ? {} : { undo: () => void undo(cuadra, result.value) }),
      });
    },
  });
}
