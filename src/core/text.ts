// Texto para búsqueda (ARCHITECTURE.md 2.1): minúsculas, sin tildes, espacios colapsados.
// "cafe" encuentra "Café" porque transactions.search_text se guarda con normalizeSearch.

/** Minúsculas, sin marcas diacríticas (ñ → n), espacios colapsados y recortados. */
export function normalizeSearch(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Valor de transactions.search_text: descripción + notas normalizadas. */
export function buildSearchText(description: string, notes: string): string {
  return normalizeSearch(`${description} ${notes}`);
}

/** Palabras normalizadas de una búsqueda (cada una debe aparecer: AND). */
export function searchTerms(input: string): string[] {
  const normalized = normalizeSearch(input);
  return normalized === '' ? [] : normalized.split(' ');
}

/** Escapa % _ y \ para usar con `LIKE ? ESCAPE '\'`. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Distancia de Levenshtein (similarOptions, F-35). Pensada para etiquetas cortas. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr.push(Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost));
    }
    prev = curr;
  }
  return prev[b.length] ?? 0;
}
