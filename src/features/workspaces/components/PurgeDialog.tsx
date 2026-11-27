import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCuadra } from '../../../app/data/CuadraProvider';
import { errorMessage } from '../../../app/data/errorMessage';
import { useUiStore } from '../../../app/state/uiStore';
import type { WorkspaceSummary } from '../../../core';
import { useT } from '../../../i18n';
import { Button, Dialog, Field, Input } from '../../../ui';
import { downloadText } from '../download';
import { purgeNameMatches } from '../logic';

/** Eliminación definitiva: hay que escribir el nombre exacto (`workspaces.purge`). Ofrece bajar un respaldo antes. */
export function PurgeDialog({ ws, open, onClose }: { ws: WorkspaceSummary | null; open: boolean; onClose: () => void }) {
  const t = useT();
  const cuadra = useCuadra();
  const [typed, setTyped] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backup, setBackup] = useState<'idle' | 'busy' | 'done'>('idle');

  const wsId = ws?.id;
  useEffect(() => {
    if (open) {
      setTyped('');
      setAttempted(false);
      setBusy(false);
      setError(null);
      setBackup('idle');
    }
  }, [open, wsId]);

  if (ws === null) return null;
  const mismatch = attempted && !purgeNameMatches(ws.name, typed);

  const downloadBackup = async () => {
    setBackup('busy');
    setError(null);
    try {
      const out = await cuadra.backup.export({ scope: 'workspace', workspaceId: ws.id });
      downloadText(out.suggestedName, out.text);
      setBackup('done');
    } catch (e) {
      setBackup('idle');
      setError(errorMessage(e, t));
    }
  };

  const confirm = async () => {
    setAttempted(true);
    if (!purgeNameMatches(ws.name, typed)) return;
    setBusy(true);
    setError(null);
    try {
      await cuadra.workspaces.purge(ws.id, ws.name);
      const ui = useUiStore.getState();
      if (ui.lastWorkspaceId === ws.id) ui.setLastWorkspaceId(null);
      ui.pushToast({ message: 'workspaces.toast.purged', params: { name: ws.name } });
      onClose();
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      variant="destructive"
      title={t('workspaces.purge.title', { name: ws.name })}
      description={t('workspaces.purge.body')}
      confirmLabel={t('workspaces.purge.confirm')}
      cancelLabel={t('workspaces.purge.cancel')}
      onConfirm={() => void confirm()}
      confirmLoading={busy}
    >
      <form
        className="wsp-purge"
        onSubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
      >
        <Button
          variant="secondary"
          icon={Download}
          loading={backup === 'busy'}
          onClick={() => void downloadBackup()}
        >
          {backup === 'done' ? t('workspaces.purge.backupDone') : t('workspaces.purge.backup')}
        </Button>
        <Field label={t('workspaces.purge.field')} help={ws.name} error={mismatch ? t('workspaces.purge.mismatch') : (error ?? undefined)}>
          <Input
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              setAttempted(false);
            }}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
