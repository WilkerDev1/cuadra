import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8');

/** Declaraciones `--x: valor` de un bloque, normalizadas (orden, espacios). */
function declarations(block: string): string[] {
  return block
    .split(';')
    .map((d) => d.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim())
    .filter((d) => d !== '');
}

function blockAfter(marker: string): string {
  const start = css.lastIndexOf(marker);
  if (start < 0) throw new Error(`No está el bloque ${marker}`);
  const open = css.indexOf('{', start + marker.length - 1);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error('Bloque sin cerrar');
}

describe('tokens.css', () => {
  it('el tema oscuro manual y el del sistema son idénticos', () => {
    const manual = declarations(blockAfter(':root[data-theme="dark"] {'));
    const system = declarations(blockAfter(':root:not([data-theme="light"]) {'));
    expect(manual.length).toBeGreaterThan(20);
    expect(system).toEqual(manual);
  });

  it('define los tokens base de DESIGN.md', () => {
    for (const name of ['--bg', '--surface', '--ink', '--lime', '--on-lime', '--in', '--out', '--xfer', '--fila', '--key', '--t-hero', '--r-3', '--d-stamp']) {
      expect(css).toContain(`${name}:`);
    }
  });

  it('no usa negro ni blanco puros', () => {
    expect(css).not.toMatch(/#000\b|#fff\b|#ffffff|#000000/i);
  });
});
