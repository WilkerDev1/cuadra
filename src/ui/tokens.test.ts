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

  describe('contraste AA (calculado sobre los tokens reales)', () => {
    const vars = (b: string) => Object.fromEntries([...b.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
    const light = vars(css.slice(css.indexOf(':root {'), css.indexOf(':root[data-theme="light"]')));
    const dark = { ...light, ...vars(blockAfter(':root[data-theme="dark"] {')) };
    const rgb = (v: string): number[] => {
      const m = v.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
      if (m === null) throw new Error(`No es oklch: ${v}`);
      const [L, C, h] = [Number(m[1]), Number(m[2]), (Number(m[3]) * Math.PI) / 180];
      const a = C * Math.cos(h);
      const b = C * Math.sin(h);
      const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
      const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
      const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
      return [4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s].map((x) => Math.min(1, Math.max(0, x)));
    };
    const lum = (raw: string, map: Record<string, string>) => {
      let v = raw;
      for (let m = v.match(/^var\((--[\w-]+)\)$/); m !== null; m = v.match(/^var\((--[\w-]+)\)$/)) v = map[m[1]!]!;
      const [r, g, b] = rgb(v);
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const ratio = (map: Record<string, string>, fg: string, bg: string) => {
      const a = lum(map[fg]!, map) + 0.05;
      const b = lum(map[bg]!, map) + 0.05;
      return Math.max(a, b) / Math.min(a, b);
    };
    for (const [name, map] of [['claro', light], ['oscuro', dark]] as const) {
      it(`texto ≥4.5:1 en ${name}`, () => {
        for (const fg of ['--ink', '--ink-2', '--ink-3', '--accent-ink', '--in', '--out', '--xfer', '--warn-ink']) {
          for (const bg of ['--bg', '--surface', '--surface-2', '--sunken']) expect(ratio(map, fg, bg), `${fg} sobre ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
        for (const [fg, bg] of [['--in', '--in-wash'], ['--out', '--out-wash'], ['--xfer', '--xfer-wash'], ['--warn-ink', '--warn-wash'], ['--on-forest', '--forest'], ['--on-forest-2', '--forest'], ['--on-lime', '--lime']] as const) {
          expect(ratio(map, fg, bg), `${fg} sobre ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
      });
      it(`bordes de control, ejes y gráficos ≥3:1 en ${name}`, () => {
        for (const bg of ['--bg', '--surface', '--sunken']) expect(ratio(map, '--control', bg), `--control sobre ${bg}`).toBeGreaterThanOrEqual(3);
        for (const fg of ['--rule-strong', '--in', '--out', '--xfer', '--ink', '--focus-ring', '--tint-1', '--tint-2', '--tint-3', '--tint-4', '--tint-5', '--tint-6', '--tint-7', '--tint-8']) {
          expect(ratio(map, fg, '--surface'), `${fg} sobre --surface`).toBeGreaterThanOrEqual(3);
        }
      });
    }
  });
});
