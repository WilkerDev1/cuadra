import { useCallback } from 'react';
import { dictionary as esDictionary, type Dictionary } from './es/index';

export type TranslateParams = Readonly<Record<string, string | number>>;
export type TFunction = (key: string, params?: TranslateParams) => string;

let current: Dictionary = esDictionary;

/** Sustituye el diccionario activo (pruebas o, en el futuro, otro idioma). Devuelve el anterior. */
export function setDictionary(next: Dictionary): Dictionary {
  const previous = current;
  current = next;
  return previous;
}

const pluralRules = new Intl.PluralRules('es');

/** Lee `{...}` balanceado desde `start` (que apunta a `{`). Devuelve el contenido y el índice siguiente. */
function readBlock(text: string, start: number): { body: string; end: number } | undefined {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return { body: text.slice(start + 1, i), end: i + 1 };
    }
  }
  return undefined;
}

function resolvePlural(body: string, params: TranslateParams): string | undefined {
  // body: "n, plural, one {# movimiento} other {# movimientos}"
  const head = /^\s*([\w.]+)\s*,\s*plural\s*,/.exec(body);
  if (head === null) return undefined;
  const name = head[1] ?? '';
  const raw = params[name];
  const n = typeof raw === 'number' ? raw : Number(raw);
  const forms: Record<string, string> = {};
  let i = head[0].length;
  while (i < body.length) {
    const rest = /^\s*(=?\w+)\s*/.exec(body.slice(i));
    if (rest === null) break;
    i += rest[0].length;
    const block = readBlock(body, i);
    if (block === undefined) break;
    forms[rest[1] ?? ''] = block.body;
    i = block.end;
  }
  const chosen = forms[`=${n}`] ?? forms[pluralRules.select(n)] ?? forms['other'] ?? '';
  return chosen.replaceAll('#', new Intl.NumberFormat('es-DO').format(n));
}

export function interpolate(template: string, params?: TranslateParams): string {
  if (params === undefined || !template.includes('{')) return template;
  let out = '';
  let i = 0;
  while (i < template.length) {
    const ch = template[i];
    if (ch !== '{') {
      out += ch;
      i += 1;
      continue;
    }
    const block = readBlock(template, i);
    if (block === undefined) {
      out += template.slice(i);
      break;
    }
    const plural = block.body.includes(',') ? resolvePlural(block.body, params) : undefined;
    if (plural !== undefined) out += interpolate(plural, params);
    else {
      const value = params[block.body.trim()];
      out += value === undefined ? `{${block.body}}` : String(value);
    }
    i = block.end;
  }
  return out;
}

export function t(key: string, params?: TranslateParams): string {
  const text = current[key];
  if (text === undefined) {
    if (import.meta.env.DEV) {
      console.warn(`[i18n] clave inexistente: ${key}`);
      return `⟦${key}⟧`;
    }
    return key;
  }
  return interpolate(text, params);
}

/** `t` con espacio de nombres: busca `${ns}.${key}` y, si no existe, `key` tal cual. */
export function scoped(ns: string): TFunction {
  return (key, params) => {
    const full = `${ns}.${key}`;
    return t(current[full] !== undefined ? full : key, params);
  };
}

export function useT(ns?: string): TFunction {
  return useCallback<TFunction>((key, params) => (ns === undefined ? t(key, params) : scoped(ns)(key, params)), [ns]);
}
