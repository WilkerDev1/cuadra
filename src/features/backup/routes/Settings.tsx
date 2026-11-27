import { Monitor, Moon, Sun } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useBootInfo, useSetting } from '../../../app/data/hooks';
import { errorMessage } from '../../../app/data/errorMessage';
import { useUiStore, type ThemeChoice } from '../../../app/state/uiStore';
import { useT } from '../../../i18n';
import { setLocale } from '../../../i18n/format';
import { Button, Card, Field, InfoTip, Input, Segmented, Select, Switch } from '../../../ui';
import { Page } from '../components/Page';

const LOCALES = ['es-DO', 'es-MX', 'es-ES', 'es-US'] as const;
const THEME_ICON = { system: Monitor, light: Sun, dark: Moon } as const;

function sample(locale: string): string {
  try {
    const money = new Intl.NumberFormat(locale, { style: 'currency', currency: 'DOP' }).format(12400.5);
    const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(2026, 10, 26));
    return `${money} · ${date}`;
  } catch {
    return '';
  }
}

/** P-15 · Ajustes de instalación: apariencia, formato regional, recordatorio de respaldo y datos del motor. */
export function Component() {
  const t = useT();
  const toast = useUiStore((s) => s.pushToast);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const [locale, saveLocale] = useSetting('locale');
  const [reminder, saveReminder] = useSetting('backup.reminderDays');
  const [systemKeyboard, saveSystemKeyboard] = useSetting('capture.systemKeyboard');
  const boot = useBootInfo();
  const ids = useId();

  const [draft, setDraft] = useState<string | null>(null);
  const [reminderError, setReminderError] = useState(false);

  const reminderValue = draft ?? (reminder === undefined ? '' : String(reminder));
  const dirty = draft !== null && reminder !== undefined && draft !== String(reminder);

  const onLocale = async (value: string) => {
    try {
      await saveLocale(value);
      setLocale(value);
      toast({ message: 'backup.settings.saved' });
    } catch (error) {
      toast({ message: 'common.error.toast', params: { message: errorMessage(error, t) }, tone: 'warn' });
    }
  };

  const onReminder = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number(reminderValue);
    if (!/^\d+$/.test(reminderValue.trim()) || n < 1 || n > 365) {
      setReminderError(true);
      return;
    }
    try {
      await saveReminder(n);
      setReminderError(false);
      setDraft(null);
      toast({ message: 'backup.settings.saved' });
    } catch (error) {
      toast({ message: 'common.error.toast', params: { message: errorMessage(error, t) }, tone: 'warn' });
    }
  };

  const themeOptions = (['system', 'light', 'dark'] as const).map((value) => ({
    value,
    label: t(`common.theme.${value}`),
    icon: THEME_ICON[value],
  }));
  const currentLocale = locale ?? 'es-DO';
  const version = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? '—';

  const sections = [
    { id: 'appearance', label: t('backup.settings.appearance') },
    { id: 'regional', label: t('backup.settings.regional') },
    { id: 'reminder', label: t('backup.settings.reminder') },
    { id: 'engine', label: t('backup.settings.engine') },
  ];

  return (
    <Page title={t('backup.settings.title')}>
      <div className="bk-settings">
        <nav className="bk-index" aria-label={t('backup.settings.title')}>
          <ul role="list">
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${ids}-${s.id}`} onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(`${ids}-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}>
                  {s.label}
                </a>
              </li>
            ))}
            <li className="bk-index__sep">
              <Link to="/respaldo">{t('backup.nav')}</Link>
            </li>
            <li>
              <Link to="/plantillas">{t('backup.templates.nav')}</Link>
            </li>
          </ul>
        </nav>

        <div className="bk-col">
          <Card as="section" id={`${ids}-appearance`} aria-labelledby={`${ids}-appearance-h`} className="bk-card">
            <h2 id={`${ids}-appearance-h`} className="bk-h2">
              {sections[0]?.label}
            </h2>
            <Segmented<ThemeChoice> label={t('common.theme.label')} options={themeOptions} value={theme} onChange={setTheme} />
            <Switch
              label={t('backup.settings.systemKeyboard')}
              checked={systemKeyboard === true}
              disabled={systemKeyboard === undefined}
              onChange={(checked) => void saveSystemKeyboard(checked).catch((error: unknown) => toast({ message: 'common.error.toast', params: { message: errorMessage(error, t) }, tone: 'warn' }))}
            />
          </Card>

          <Card as="section" id={`${ids}-regional`} aria-labelledby={`${ids}-regional-h`} className="bk-card">
            <div className="bk-cardhead">
              <h2 id={`${ids}-regional-h`} className="bk-h2">
                {sections[1]?.label}
              </h2>
              <InfoTip>{t('backup.settings.localeTip')}</InfoTip>
            </div>
            <Field label={t('backup.settings.locale')} help={t('backup.settings.sample', { sample: sample(currentLocale) })}>
              <Select
                options={LOCALES.map((l) => ({ value: l, label: `${t(`backup.settings.locale.${l}`)} (${l})` }))}
                value={currentLocale}
                onChange={(v) => void onLocale(v)}
                disabled={locale === undefined}
              />
            </Field>
          </Card>

          <Card as="section" id={`${ids}-reminder`} aria-labelledby={`${ids}-reminder-h`} className="bk-card">
            <h2 id={`${ids}-reminder-h`} className="bk-h2">
              {sections[2]?.label}
            </h2>
            <form className="bk-inline" onSubmit={(e) => void onReminder(e)} noValidate>
              <Field
                label={t('backup.settings.reminderLabel')}
                help={t('backup.settings.reminderHelp')}
                error={reminderError ? t('backup.settings.reminderInvalid') : undefined}
              >
                {/* Campo y botón en la misma fila; la ayuda y el error debajo, a lo ancho. */}
                <div className="bk-inline__row">
                  <Input
                    type="text"
                    inputMode="numeric"
                    name="reminder-days"
                    enterKeyHint="done"
                    autoComplete="off"
                    className="num"
                    value={reminderValue}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      setReminderError(false);
                    }}
                  />
                  <Button type="submit" variant="secondary" disabled={!dirty}>
                    {t('backup.settings.saveReminder')}
                  </Button>
                </div>
              </Field>
            </form>
          </Card>

          <Card as="section" id={`${ids}-engine`} aria-labelledby={`${ids}-engine-h`} className="bk-card">
            <h2 id={`${ids}-engine-h`} className="bk-h2">
              {sections[3]?.label}
            </h2>
            <dl className="bk-facts">
              <dt>{t('backup.settings.version')}</dt>
              <dd className="num">{version}</dd>
              <dt>{t('backup.storage.where')}</dt>
              <dd>{t(`backup.storage.kind.${boot.storage.persistent ? boot.storage.kind : 'memory'}`)}</dd>
              <dt>{t('backup.settings.sqlite')}</dt>
              <dd className="num">{boot.sqliteVersion}</dd>
              <dt>{t('backup.settings.schema')}</dt>
              <dd className="num">
                {t('backup.settings.schemaValue', { n: boot.schema.to })} · {t('backup.settings.migrations')}: {boot.schema.applied.length}
              </dd>
              <dt>{t('backup.settings.tabLock')}</dt>
              <dd>{boot.storage.tabLock ? t('backup.settings.yes') : t('backup.settings.no')}</dd>
              {boot.storage.restored ? (
                <>
                  <dt>{t('backup.settings.restored')}</dt>
                  <dd>{t('backup.settings.yes')}</dd>
                </>
              ) : null}
            </dl>
          </Card>
        </div>
      </div>
    </Page>
  );
}
