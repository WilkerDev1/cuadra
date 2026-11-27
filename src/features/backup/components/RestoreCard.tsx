import { FolderOpen, KeyRound, Lock } from 'lucide-react';
import { useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useCuadra } from '../../../app/data/CuadraProvider';
import { errorMessage } from '../../../app/data/errorMessage';
import { useUiStore } from '../../../app/state/uiStore';
import type { BackupInspection } from '../../../core';
import { useT } from '../../../i18n';
import { formatDate, getLocale } from '../../../i18n/format';
import { Banner, Button, Card, Dialog, EmptyState, Field, InfoTip, Input, Stamp } from '../../../ui';
import { localIsoDate, MAX_BACKUP_BYTES } from '../logic';

type View =
  | { kind: 'idle' }
  | { kind: 'reading'; name: string }
  | { kind: 'locked'; name: string; text: string; error: string | null }
  | { kind: 'ready'; name: string; text: string; password: string | undefined; info: BackupInspection }
  | { kind: 'failed'; name: string; message: string }
  | { kind: 'restored'; workspaces: number; transactions: number; copyName: string; storedIn: 'external' | 'database' };

interface Added {
  wsId: string;
  name: string;
}

/** Restaurar: elegir archivo, ver qué trae, y reemplazar todo o sumar un espacio. */
export function RestoreCard() {
  const t = useT();
  const cuadra = useCuadra();
  const toast = useUiStore((s) => s.pushToast);
  const ids = useId();
  const picker = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<View>({ kind: 'idle' });
  const [password, setPassword] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState<'restore' | string | null>(null);
  const [added, setAdded] = useState<Record<string, Added>>({});

  const fail = (error: unknown) =>
    toast({ message: 'common.error.toast', params: { message: errorMessage(error, t) }, tone: 'warn' });

  const inspect = async (name: string, text: string, pw?: string) => {
    const info = await cuadra.backup.inspect(text, pw === undefined ? undefined : { password: pw });
    if (info.ok) {
      setView({ kind: 'ready', name, text, password: pw, info });
      setPassword('');
      return;
    }
    const code = info.error ?? 'backup_invalid';
    if (code === 'password_required' || code === 'wrong_password') {
      setView({ kind: 'locked', name, text, error: pw === undefined ? null : t(`errors.${code}`) });
      return;
    }
    setView({ kind: 'failed', name, message: t(`errors.${code}`) });
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file === undefined) return;
    setAdded({});
    if (file.size > MAX_BACKUP_BYTES) {
      setView({ kind: 'failed', name: file.name, message: t('errors.backup_invalid') });
      return;
    }
    setView({ kind: 'reading', name: file.name });
    try {
      await inspect(file.name, await file.text());
    } catch (error) {
      setView({ kind: 'failed', name: file.name, message: errorMessage(error, t) });
    }
  };

  const unlock = async (e: FormEvent) => {
    e.preventDefault();
    if (view.kind !== 'locked' || password === '') return;
    try {
      await inspect(view.name, view.text, password);
    } catch (error) {
      fail(error);
    }
  };

  const restoreAll = async () => {
    if (view.kind !== 'ready') return;
    setBusy('restore');
    try {
      const out = await cuadra.backup.restoreAll(view.text, { confirm: true, ...(view.password === undefined ? {} : { password: view.password }) });
      setConfirmOpen(false);
      setView({ kind: 'restored', workspaces: out.workspaces, transactions: out.transactions, copyName: out.autoCopy.name, storedIn: out.autoCopy.storedIn });
      toast({ message: 'backup.restore.done' });
    } catch (error) {
      setConfirmOpen(false);
      fail(error);
    } finally {
      setBusy(null);
    }
  };

  const addWorkspace = async (id: string, name: string) => {
    if (view.kind !== 'ready') return;
    setBusy(id);
    try {
      const out = await cuadra.backup.importWorkspace(view.text, id, view.password === undefined ? undefined : { password: view.password });
      setAdded((a) => ({ ...a, [id]: { wsId: out.value.id, name: out.value.name } }));
      toast({ message: 'backup.restore.added', params: { name } });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  };

  const summary = (info: BackupInspection): string => {
    const date = localIsoDate(info.createdAt);
    return t('backup.restore.summary', {
      ws: info.workspaces.length,
      acc: info.counts.accounts ?? 0,
      tx: info.counts.transactions ?? 0,
      date: date === null ? '—' : formatDate(date, getLocale()),
    });
  };

  const ready = view.kind === 'ready' ? view : null;

  return (
    <Card as="section" aria-labelledby={`${ids}-h`} className="bk-card">
      <div className="bk-cardhead">
        <h2 id={`${ids}-h`} className="bk-h2">
          {t('backup.restore.title')}
        </h2>
        <InfoTip>{t('backup.restore.tip')}</InfoTip>
      </div>

      <input
        ref={picker}
        type="file"
        className="visually-hidden"
        accept=".json,.cuadra,application/json,text/plain"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="restore-file"
        onChange={(e) => void onFile(e)}
      />

      {view.kind === 'idle' ? (
        <EmptyState message={t('backup.restore.empty')} rows={3} action={<PickButton onClick={() => picker.current?.click()} label={t('backup.restore.pick')} />} />
      ) : null}

      {view.kind === 'reading' ? (
        <p className="bk-note" role="status">
          {t('backup.restore.reading')}
        </p>
      ) : null}

      {view.kind === 'failed' ? (
        <div className="bk-stack">
          <Banner tone="warn" title={view.name}>
            {view.message}
          </Banner>
          <div>
            <PickButton onClick={() => picker.current?.click()} label={t('backup.restore.pickAnother')} />
          </div>
        </div>
      ) : null}

      {view.kind === 'locked' ? (
        <form className="bk-stack" onSubmit={(e) => void unlock(e)} noValidate>
          <p className="bk-file">
            <Lock aria-hidden="true" /> <span className="bk-file__name">{view.name}</span>
          </p>
          <p className="bk-note">{t('backup.restore.protected')}</p>
          <Field label={t('backup.restore.password')} error={view.error ?? undefined}>
            <Input type="password" name="restore-password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <div className="bk-actions">
            <Button type="submit" variant="secondary" icon={KeyRound} disabled={password === ''}>
              {t('backup.restore.unlock')}
            </Button>
            <PickButton onClick={() => picker.current?.click()} label={t('backup.restore.pickAnother')} ghost />
          </div>
        </form>
      ) : null}

      {ready !== null ? (
        <div className="bk-stack">
          <p className="bk-file">
            <span className="bk-file__name">{ready.name}</span>
            {ready.info.encrypted ? (
              <span className="bk-tag">
                <Lock aria-hidden="true" /> {t('backup.restore.encryptedTag')}
              </span>
            ) : null}
          </p>
          <p className="bk-summary num" data-testid="restore-summary">
            {summary(ready.info)}
          </p>
          {ready.info.needsUpgrade ? <p className="bk-note">{t('backup.restore.upgrade')}</p> : null}

          <ul role="list" className="bk-spaces" aria-label={t('backup.restore.spaces')}>
            {ready.info.workspaces.map((w) => {
              const done = added[w.id];
              return (
                <li key={w.id} className="bk-space">
                  <span className="bk-space__name">{w.name}</span>
                  <span className="bk-space__meta num">
                    {t('backup.restore.spaceMeta', { acc: w.accounts, tx: w.transactions })}
                  </span>
                  <span className="bk-space__act">
                    {done === undefined ? (
                      <Button variant="secondary" loading={busy === w.id} aria-label={t('backup.restore.addLabel', { name: w.name })} onClick={() => void addWorkspace(w.id, w.name)}>
                        {t('backup.restore.add')}
                      </Button>
                    ) : (
                      <Link className="bk-linkbtn" to={`/e/${done.wsId}`}>
                        {t('backup.restore.openSpace')}
                      </Link>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>

          <div className="bk-actions">
            {ready.info.scope === 'all' ? (
              <Button variant="danger" onClick={() => setConfirmOpen(true)}>
                {t('backup.restore.all')}
              </Button>
            ) : (
              <p className="bk-note">{t('backup.restore.single')}</p>
            )}
            <PickButton onClick={() => picker.current?.click()} label={t('backup.restore.pickAnother')} ghost />
          </div>

          <Dialog
            open={confirmOpen}
            onClose={() => setConfirmOpen(false)}
            variant="destructive"
            title={t('backup.restore.confirmTitle')}
            description={t('backup.restore.confirmBody', { summary: summary(ready.info) })}
            confirmLabel={t('backup.restore.confirmAction')}
            confirmLoading={busy === 'restore'}
            onConfirm={() => void restoreAll()}
          />
        </div>
      ) : null}

      {view.kind === 'restored' ? (
        <div className="bk-done" role="status">
          <Stamp animate size="3.5rem" />
          <div className="bk-done__text">
            <p className="bk-done__title">{t('backup.restore.done')}</p>
            <p className="bk-note">{t('backup.restore.doneBody', { ws: view.workspaces, tx: view.transactions })}</p>
            <p className="bk-note">
              {t('backup.restore.doneCopy', { name: view.copyName })} · {t(`backup.restore.doneIn.${view.storedIn}`)}
            </p>
            <PickButton onClick={() => picker.current?.click()} label={t('backup.restore.pickAnother')} ghost />
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function PickButton({ onClick, label, ghost = false }: { onClick: () => void; label: string; ghost?: boolean }) {
  return (
    <Button variant={ghost ? 'ghost' : 'secondary'} icon={FolderOpen} onClick={onClick}>
      {label}
    </Button>
  );
}
