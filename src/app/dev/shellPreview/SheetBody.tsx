import { useState } from 'react';
import { useT } from '../../../i18n';
import { Button, Field, Input } from '../../../ui';
import { useCuadraMutation } from '../../data/useCuadraMutation';
import { useSheet } from '../../registry/sheet';

/** Cuerpo de una ruta `presentation: 'sheet'`: usa `useSheet()` para avisar de cambios sin guardar y cerrar. */
export function Component() {
  const t = useT();
  const sheet = useSheet();
  const [text, setText] = useState('');
  // Un error de dominio real (espacio inexistente) para ver el aviso traducido que muestra useCuadraMutation.
  const failing = useCuadraMutation((c) => c.workspaces.archive('no-existe'));
  return (
    <div className="shell-page">
      <Field label={t('common.dev.nota')}>
        <Input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            sheet.setDirty(e.target.value !== '');
          }}
        />
      </Field>
      <Button variant="primary" onClick={sheet.close}>
        {t('common.dev.guardar')}
      </Button>
      <Button data-testid="fail" onClick={() => failing.mutate(undefined as never)}>
        {t('common.dev.error')}
      </Button>
    </div>
  );
}
