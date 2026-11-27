import { Download, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';
import { useCuadra } from '../../../app/data/CuadraProvider';
import { useBootInfo } from '../../../app/data/hooks';
import { useCuadraQuery } from '../../../app/data/useCuadraQuery';
import { errorMessage } from '../../../app/data/errorMessage';
import { useUiStore } from '../../../app/state/uiStore';
import { useT } from '../../../i18n';
import { formatDate, getLocale } from '../../../i18n/format';
import { Banner, Button, Card } from '../../../ui';
import { saveTextFile } from '../files';
import { formatBytes, localIsoDate } from '../logic';

interface StorageApi {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
}

function storageApi(): StorageApi | undefined {
  try {
    return typeof navigator === 'undefined' ? undefined : (navigator.storage as StorageApi | undefined);
  } catch {
    return undefined;
  }
}

/** Dónde viven los datos: persistencia, uso del almacenamiento y modo memoria. */
export function StorageCard() {
  const t = useT();
  const { storage } = useBootInfo();
  const toast = useUiStore((s) => s.pushToast);
  const ids = useId();
  const [persisted, setPersisted] = useState<boolean | null>(storage.persistGranted);
  const [usage, setUsage] = useState<{ used: number; quota: number } | null | 'unknown'>(null);
  const [asking, setAsking] = useState(false);

  const refresh = useCallback(async () => {
    const api = storageApi();
    try {
      if (api?.persisted !== undefined) setPersisted(await api.persisted());
      if (api?.estimate !== undefined) {
        const e = await api.estimate();
        setUsage(e.usage === undefined || e.quota === undefined ? 'unknown' : { used: e.usage, quota: e.quota });
      } else setUsage('unknown');
    } catch {
      setUsage('unknown');
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const canPersist = storageApi()?.persist !== undefined;
  const memory = !storage.persistent;

  const ask = async () => {
    setAsking(true);
    try {
      const granted = (await storageApi()?.persist?.()) === true;
      setPersisted(granted);
      toast({ message: granted ? 'backup.storage.persistOk' : 'backup.storage.persistDenied', ...(granted ? {} : { tone: 'warn' as const }) });
    } finally {
      setAsking(false);
    }
  };

  const kind = memory ? 'memory' : storage.kind;
  const usageText =
    usage === null || usage === 'unknown'
      ? t('backup.storage.usageUnknown')
      : t('backup.storage.usageValue', { used: formatBytes(usage.used, getLocale()), quota: formatBytes(usage.quota, getLocale()) });
  const ratio = usage !== null && usage !== 'unknown' && usage.quota > 0 ? Math.min(1, usage.used / usage.quota) : null;

  return (
    <Card as="section" aria-labelledby={`${ids}-h`} className="bk-card">
      <h2 id={`${ids}-h`} className="bk-h2">
        {t('backup.storage.title')}
      </h2>
      {memory ? (
        <Banner tone="warn">
          {t('backup.storage.memoryWarn')}
          {storage.fallbackReason === null ? '' : ` ${t('backup.storage.fallback', { reason: storage.fallbackReason })}`}
        </Banner>
      ) : null}
      <dl className="bk-facts">
        <dt>{t('backup.storage.where')}</dt>
        <dd>{t(`backup.storage.kind.${kind}`)}</dd>
        <dt>{t('backup.storage.persistence')}</dt>
        <dd>
          {persisted === true ? t('backup.storage.persistent') : t('backup.storage.notPersistent')}
          {persisted !== true && canPersist && !memory ? (
            <div>
              <Button variant="secondary" icon={ShieldCheck} loading={asking} onClick={() => void ask()} className="bk-inlinebtn">
                {t('backup.storage.persist')}
              </Button>
            </div>
          ) : null}
        </dd>
        <dt>{t('backup.storage.usage')}</dt>
        <dd>
          <span className="num" data-testid="storage-usage">
            {usageText}
          </span>
          {ratio === null ? null : (
            <span className="bk-meter" role="img" aria-label={`${Math.round(ratio * 100)} %`}>
              <span style={{ inlineSize: `${Math.max(1, ratio * 100)}%` }} />
            </span>
          )}
        </dd>
      </dl>
    </Card>
  );
}

/** Última copia automática guardada dentro de la base (la externa vive en el dispositivo y no se lista aquí). */
export function AutoCopyCard() {
  const t = useT();
  const cuadra = useCuadra();
  const toast = useUiStore((s) => s.pushToast);
  const copy = useCuadraQuery({
    key: ['backup.lastAutoCopy', undefined],
    tables: ['settings'],
    fn: (c) => c.backup.lastAutoCopy(),
  });
  const ids = useId();
  if (copy.data === null || copy.data === undefined) return null;
  const data = copy.data;
  const date = localIsoDate(data.createdAt);

  const download = async () => {
    try {
      const latest = (await cuadra.backup.lastAutoCopy()) ?? data;
      await saveTextFile({ name: latest.name, text: latest.json, description: t('backup.auto.label') });
    } catch (error) {
      toast({ message: 'common.error.toast', params: { message: errorMessage(error, t) }, tone: 'warn' });
    }
  };

  return (
    <Card as="section" aria-labelledby={`${ids}-h`} className="bk-card">
      <h2 id={`${ids}-h`} className="bk-h2">
        {t('backup.auto.label')}
      </h2>
      <p className="bk-note">{t('backup.auto.when', { name: data.name, date: date === null ? '—' : formatDate(date, getLocale()) })}</p>
      <div>
        <Button variant="secondary" icon={Download} onClick={() => void download()}>
          {t('backup.auto.download')}
        </Button>
      </div>
    </Card>
  );
}
