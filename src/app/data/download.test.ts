import { afterEach, describe, expect, it } from 'vitest';
import { saveFile, saveTextFile, setNativeSaver } from './download';

afterEach(() => setNativeSaver(null));

describe('saveFile con el diálogo nativo (Tauri)', () => {
  it('pasa nombre y bytes, y devuelve saved con una ruta', async () => {
    const calls: Array<{ name: string; text: string }> = [];
    setNativeSaver(async (name, data) => {
      calls.push({ name, text: new TextDecoder().decode(data) });
      return `/home/x/${name}`;
    });
    expect(await saveTextFile('ñandú,1', 'a.csv', 'text/csv')).toBe('saved');
    expect(calls).toEqual([{ name: 'a.csv', text: 'ñandú,1' }]);
  });

  it('devuelve cancelled si se cierra el diálogo sin guardar', async () => {
    setNativeSaver(async () => null);
    expect(await saveFile(new Blob(['x']), 'b.json')).toBe('cancelled');
  });
});
