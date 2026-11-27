import { CircleAlert, Download, Share2 } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useAuth, useSetting, useWorkspaces } from '../../../app/data/hooks';
import { useCuadra } from '../../../app/data/CuadraProvider';
import { errorMessage } from '../../../app/data/errorMessage';
import { useUiStore } from '../../../app/state/uiStore';
import { isCryptoAvailable, type BackupScope } from '../../../core';
import { formatDate, getLocale } from '../../../i18n/format';
import { useT } from '../../../i18n';
import { Button, Card, Field, InfoTip, Segmented, Select, Switch } from '../../../ui';
import { canShareFile, saveTextFile, shareFile } from '../files';
import { backupAge, formatBytes, localIsoDate, sealBackup } from '../logic';

interface ExportResult {
  name: string;
  bytes: number;
  encrypted: boolean;
  text: string;
}

/** Estado del último respaldo + descarga: la acción principal de la pantalla. */
export function ExportCard() {
  const t = useT();
  const cuadra = useCuadra();
  const auth = useAuth();
  const toast = useUiStore((s) => s.pushToast);
  const [lastAt] = useSetting('backup.lastVerifiedAt');
  const [reminder] = useSetting('backup.reminderDays');
  const workspaces = useWorkspaces();
  const ids = useId();

  const [scope, setScope] = useState<'all' | 'workspace'>('all');
  const [wsId, setWsId] = useState('');
  // Con la contraseña activada, el respaldo sale cifrado con ella salvo que la persona lo apague a propósito.
  const [encrypt, setEncrypt] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);

  const list = workspaces.data ?? [];
  useEffect(() => {
    if (wsId === '' || !list.some((w) => w.id === wsId)) setWsId(list[0]?.id ?? '');
  }, [list, wsId]);

  const canEncrypt = auth.enabled;
  const cryptoOk = useMemo(() => isCryptoAvailable(), []);
  const reminderDays = reminder ?? 30;
  const loadingLast = lastAt === undefined;
  const age = backupAge(lastAt ?? null, new Date(), reminderDays);
  const showWarn = age.overdue && !loadingLast;
  const lastDate = lastAt === null || lastAt === undefined ? null : localIsoDate(lastAt);

  const ageText = loadingLast
    ? '—'
    : age.kind === 'never'
      ? t('backup.last.never')
      : age.kind === 'today'
        ? t('backup.age.today')
        : t(`backup.age.${age.kind}`, { n: age.n });

  const noSpaces = scope === 'workspace' && list.length === 0;
  const withPassword = encrypt && canEncrypt && cryptoOk;
  const plainOnPurpose = canEncrypt && cryptoOk && !encrypt;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || noSpaces) return;
    setBusy(true);
    setResult(null);
    try {
      const target: BackupScope = scope === 'all' ? { scope: 'all' } : { scope: 'workspace', workspaceId: wsId };
      // El núcleo exporta en claro y lo verifica; si toca, se cifra con la contraseña de la sesión (cuadra.auth).
      const out = await cuadra.backup.export(target);
      const sealed = await sealBackup(out, withPassword ? cuadra.auth : null, localIsoDate(new Date().toISOString()) ?? '');
      const saved = await saveTextFile({ name: sealed.name, text: sealed.text, description: t('backup.export.download') });
      if (saved === 'cancelled') {
        toast({ message: 'backup.export.cancelled' });
        return;
      }
      await cuadra.backup.markVerified();
      setResult({ name: sealed.name, bytes: sealed.bytes, encrypted: sealed.encrypted, text: sealed.text });
      toast({ message: 'backup.export.saved' });
    } catch (error) {
      toast({ message: 'common.error.toast', params: { message: errorMessage(error, t) }, tone: 'warn' });
    } finally {
      setBusy(false);
    }
  };

  const shareFileObj = result === null ? null : new File([result.text], result.name, { type: 'application/json' });
  const share = async () => {
    if (shareFileObj === null) return;
    try {
      await shareFile(shareFileObj, t('backup.nav'));
    } catch (error) {
      toast({ message: 'common.error.toast', params: { message: errorMessage(error, t) }, tone: 'warn' });
    }
  };

  return (
    <Card as="section" aria-labelledby={`${ids}-h`} className="bk-card">
      <h2 id={`${ids}-h`} className="visually-hidden">
        {t('backup.export.download')}
      </h2>
      <div className="bk-status">
        <p className="bk-status__label">{t('backup.last.label')}</p>
        <p className={showWarn ? 'bk-age bk-age--warn' : 'bk-age'} data-testid="backup-age">
          {showWarn ? <CircleAlert aria-hidden="true" /> : null}
          <span>{ageText}</span>
          {showWarn ? (
            <InfoTip tone="warn" label={t('backup.last.overdueLink')}>
              {t('backup.last.overdue', { n: reminderDays })} <Link to="/ajustes">{t('backup.last.overdueLink')}</Link>
            </InfoTip>
          ) : null}
        </p>
        <p className="bk-status__meta">{loadingLast ? '' : lastDate === null ? t('backup.last.neverDesc') : t('backup.last.on', { date: formatDate(lastDate, getLocale()) })}</p>
      </div>

      <form className="bk-form" onSubmit={(e) => void onSubmit(e)} noValidate>
        <div className="bk-scope">
          <Segmented
            label={t('backup.export.scope')}
            value={scope}
            onChange={setScope}
            options={[
              { value: 'all', label: t('backup.export.all') },
              { value: 'workspace', label: t('backup.export.one') },
            ]}
          />
          {!canEncrypt ? <InfoTip label={t('backup.export.encrypt')}>{t('backup.export.plainTip')}</InfoTip> : null}
        </div>

        {scope === 'workspace' ? (
          list.length === 0 ? (
            <p className="bk-note">{t('backup.export.noSpaces')}</p>
          ) : (
            <Field label={t('backup.export.space')}>
              <Select options={list.map((w) => ({ value: w.id, label: w.name }))} value={wsId} onChange={setWsId} />
            </Field>
          )
        ) : null}

        {canEncrypt ? (
          <div className="bk-encrypt">
            <Switch
              label={t('backup.export.encrypt')}
              description={cryptoOk ? t('backup.export.encryptDesc') : t('backup.export.noCrypto')}
              checked={withPassword}
              disabled={!cryptoOk}
              onChange={setEncrypt}
            />
            {plainOnPurpose ? (
              <p className="bk-plainwarn" data-testid="backup-plain-warn">
                <CircleAlert aria-hidden="true" />
                <span>{t('backup.export.plainWarn')}</span>
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="bk-actions">
          <Button type="submit" variant="primary" icon={Download} loading={busy} disabled={noSpaces}>
            {busy ? t('backup.export.preparing') : plainOnPurpose ? t('backup.export.downloadPlain') : t('backup.export.download')}
          </Button>
          {result !== null && shareFileObj !== null && canShareFile(shareFileObj) ? (
            <Button variant="secondary" icon={Share2} onClick={() => void share()}>
              {t('backup.share')}
            </Button>
          ) : null}
        </div>
        {result === null ? null : (
          <p className="bk-result" role="status">
            {t('backup.export.result', { name: result.name, size: formatBytes(result.bytes, getLocale()) })} ·{' '}
            {result.encrypted ? t('backup.export.encryptedTag') : t('backup.export.plainTag')}
          </p>
        )}
      </form>
    </Card>
  );
}
