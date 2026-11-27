import { FolderOpen, KeyRound, Lock } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../../app/data/hooks';
import { useCuadra } from '../../../app/data/CuadraProvider';
import { errorMessage } from '../../../app/data/errorMessage';
import { useUiStore } from '../../../app/state/uiStore';
import type { BackupInspection } from '../../../core';
import { useT } from '../../../i18n';
import { formatDate, getLocale } from '../../../i18n/format';
import { Banner, Button, Card, Dialog, EmptyState, Field, InfoTip, Input, Stamp } from '../../../ui';
import { isCryptoAvailable } from '../../../core';
import { lastVerifiedAfterRestore, localIsoDate, MAX_BACKUP_BYTES, openBackupText } from '../logic';

type View =
  | { kind: 'idle' }
  | { kind: 'reading'; name: string }
  | { kind: 'locked'; name: string; triedSession: boolean; error: string | null }
  | { kind: 'ready'; name: string; encrypted: boolean; info: BackupInspection }
  | { kind: 'failed'; name: string; message: string }
  | { kind: 'restored'; workspaces: number; transactions: number; copyName: string; storedIn: 'external' | 'database' };

interface Added {
  wsId: string;
  name: string;
}

/**
 * Lo que hace falta para restaurar, fuera del estado de React (no llega al DOM ni a las herramientas de React) y
 * borrado al terminar, al elegir otro archivo o al bloquearse la sesión: el texto que entiende el núcleo (el
 * original, o ya descifrado con la sesión) y, solo si el respaldo se hizo con otra contraseña, esa contraseña.
 */
interface Secret {
  text: string;
  password?: string;
}

/** Restaurar: elegir archivo, ver qué trae, y reemplazar todo o sumar un espacio. */
export function RestoreCard() {
  const t = useT();
  const cuadra = useCuadra();
  const toast = useUiStore((s) => s.pushToast);
  const ids = useId();
  const picker = useRef<HTMLInputElement>(null);
  const auth = useAuth();
  const [view, setView] = useState<View>({ kind: 'idle' });
  const secret = useRef<Secret | null>(null);
  // Campo no controlado: la contraseña no pasa por el estado de React ni queda en el atributo value.
  const pwInput = useRef<HTMLInputElement>(null);
  const [hasPassword, setHasPassword] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState<'restore' | string | null>(null);
  const [added, setAdded] = useState<Record<string, Added>>({});

  const fail = (error: unknown) =>
    toast({ message: 'common.error.toast', params: { message: errorMessage(error, t) }, tone: 'warn' });

  const forget = () => {
    secret.current = null;
    if (pwInput.current !== null) pwInput.current.value = '';
    setHasPassword(false);
  };

  // Al bloquearse la sesión no queda nada del respaldo abierto: ni el texto descifrado ni la contraseña.
  useEffect(() => {
    if (!auth.locked) return;
    forget();
    setConfirmOpen(false);
    setView((v) => (v.kind === 'locked' || v.kind === 'ready' ? { kind: 'idle' } : v));
  }, [auth.locked]);

  const inspect = async (name: string, next: Secret, encrypted: boolean, triedSession: boolean) => {
    const info = await cuadra.backup.inspect(next.text, next.password === undefined ? undefined : { password: next.password });
    if (info.ok) {
      secret.current = next;
      if (pwInput.current !== null) pwInput.current.value = '';
      setHasPassword(false);
      setView({ kind: 'ready', name, encrypted: encrypted || info.encrypted, info });
      return;
    }
    const code = info.error ?? 'backup_invalid';
    if (code === 'password_required' || code === 'wrong_password') {
      secret.current = { text: next.text };
      setView({ kind: 'locked', name, triedSession, error: next.password === undefined ? null : t(`errors.${code}`) });
      return;
    }
    forget();
    setView({ kind: 'failed', name, message: t(`errors.${code}`) });
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file === undefined) return;
    setAdded({});
    forget();
    if (file.size > MAX_BACKUP_BYTES) {
      setView({ kind: 'failed', name: file.name, message: t('errors.backup_invalid') });
      return;
    }
    setView({ kind: 'reading', name: file.name });
    try {
      const text = await file.text();
      // Con la contraseña activada se prueba primero la de la sesión: lo normal es que el respaldo sea de aquí.
      const session = auth.enabled && !auth.locked && isCryptoAvailable() ? cuadra.auth : null;
      const opened = await openBackupText(text, session);
      if (opened.kind === 'open') await inspect(file.name, { text: opened.text }, opened.encrypted, false);
      else {
        secret.current = { text };
        setView({ kind: 'locked', name: file.name, triedSession: opened.triedSession, error: null });
      }
    } catch (error) {
      setView({ kind: 'failed', name: file.name, message: errorMessage(error, t) });
    }
  };

  const unlock = async (e: FormEvent) => {
    e.preventDefault();
    const password = pwInput.current?.value ?? '';
    if (view.kind !== 'locked' || password === '' || secret.current === null) return;
    try {
      await inspect(view.name, { text: secret.current.text, password }, true, view.triedSession);
    } catch (error) {
      fail(error);
    }
  };

  const restoreAll = async () => {
    const sec = secret.current;
    if (view.kind !== 'ready' || sec === null) return;
    setBusy('restore');
    try {
      const localBefore = await cuadra.settings.get('backup.lastVerifiedAt');
      const out = await cuadra.backup.restoreAll(sec.text, { confirm: true, ...(sec.password === undefined ? {} : { password: sec.password }) });
      // La marca «Último respaldo» viaja en el archivo y el núcleo la repone: se queda la más reciente.
      const keep = lastVerifiedAfterRestore(localBefore, view.info.createdAt);
      if (keep !== null) await cuadra.backup.markVerified(keep);
      forget();
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
    const sec = secret.current;
    if (view.kind !== 'ready' || sec === null) return;
    setBusy(id);
    try {
      const out = await cuadra.backup.importWorkspace(sec.text, id, sec.password === undefined ? undefined : { password: sec.password });
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
          <p className="bk-note">{t(view.triedSession ? 'backup.restore.protectedOther' : 'backup.restore.protected')}</p>
          <Field label={t('backup.restore.password')} error={view.error ?? undefined}>
            <Input
              ref={pwInput}
              type="password"
              name="restore-password"
              autoComplete="off"
              autoFocus
              defaultValue=""
              onInput={(e) => setHasPassword(e.currentTarget.value !== '')}
            />
          </Field>
          <div className="bk-actions">
            <Button type="submit" variant="secondary" icon={KeyRound} disabled={!hasPassword}>
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
            {ready.encrypted ? (
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
