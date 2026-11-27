import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import type { Cuadra, DomainError, Mutation } from '../../core';
import { t } from '../../i18n';
import { useUiStore } from '../state/uiStore';
import { useCuadra } from './CuadraProvider';
import { errorMessage } from './errorMessage';

/** Clave i18n del aviso, o la clave con parámetros. */
export type ToastSpec = string | { key: string; params?: Record<string, string | number> };

export interface CuadraMutationOptions<I, O> {
  /** Clave i18n del aviso, o función que la calcula a partir del resultado. */
  successToast?: ToastSpec | ((o: O, input: I) => ToastSpec);
  /** Si existe, el aviso lleva «Deshacer» (por ejemplo, anular lo recién creado). */
  undo?: (c: Cuadra, o: O) => Promise<unknown>;
  /**
   * Los errores salen en un aviso traducido (`errors.<código>`). Pon `false` si el formulario los muestra en
   * línea (campo con error): la promesa de `mutateAsync` igualmente rechaza.
   */
  errorToast?: boolean;
}

function resolve(spec: ToastSpec): { message: string; params?: Record<string, string | number> } {
  return typeof spec === 'string' ? { message: spec } : { message: spec.key, ...(spec.params === undefined ? {} : { params: spec.params }) };
}

export function useCuadraMutation<I, O>(
  fn: (c: Cuadra, input: I) => Promise<Mutation<O>>,
  opts?: CuadraMutationOptions<I, O>,
): UseMutationResult<Mutation<O>, DomainError, I> {
  const cuadra = useCuadra();
  const pushToast = useUiStore((s) => s.pushToast);
  return useMutation<Mutation<O>, DomainError, I>({
    mutationFn: (input) => fn(cuadra, input),
    onSuccess: (result, input) => {
      const toast = opts?.successToast;
      if (toast === undefined) return;
      const spec = resolve(typeof toast === 'function' ? toast(result.value, input) : toast);
      const undo = opts?.undo;
      pushToast({
        ...spec,
        ...(undo === undefined ? {} : { undo: () => void undo(cuadra, result.value) }),
      });
    },
    onError: (error) => {
      if (opts?.errorToast === false) return;
      // El mensaje se traduce aquí (el toast guarda una clave): se usa una clave sintética que `t` devuelve tal cual.
      pushToast({ message: 'common.error.toast', params: { message: errorMessage(error, t) }, tone: 'warn' });
    },
  });
}
