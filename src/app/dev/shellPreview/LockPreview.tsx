import { useState } from 'react';
import { useT } from '../../../i18n';
import { Button, Field, Input } from '../../../ui';
import { useAuth } from '../../data/hooks';
import type { LockScreenProps } from '../../registry/types';

/** Pantalla de bloqueo de ejemplo del banco de pruebas: la real la aporta la feature de autenticación. */
export function Component({ busy }: LockScreenProps) {
  const t = useT();
  const auth = useAuth();
  const [password, setPassword] = useState('');
  return (
    <main className="shell-center">
      <h1 className="shell-title">{t('common.appName')}</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void auth.unlock(password);
        }}
      >
        <Field label={t('common.dev.nota')}>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" loading={busy}>
          {t('common.dev.guardar')}
        </Button>
      </form>
    </main>
  );
}
