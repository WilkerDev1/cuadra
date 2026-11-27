import { ArrowLeft, KeyRound, Lock, LockOpen, ShieldCheck, ShieldOff } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useCuadra } from '../../../app/data/CuadraProvider';
import { useAuth, usePushToast, useReturnToWorkspace } from '../../../app/data/hooks';
import { errorMessage } from '../../../app/data/errorMessage';
import { isCryptoAvailable, type AuthStatus } from '../../../core';
import { useT } from '../../../i18n';
import { formatDate } from '../../../i18n/format';
import { Banner, Button, Field, Input, Skeleton } from '../../../ui';
import { PasswordField } from '../components/PasswordField';
import { RecoveryKeyReveal } from '../components/RecoveryKeyReveal';
import { useCountdown } from '../components/useCountdown';
import { autoLockOptions, classifyUnlockError, formatCountdown, laterRetryAt } from '../logic/lock';
import {
  firstErrorField,
  MAX_PROFILE_NAME_LENGTH,
  validateNewPassword,
  validateSetup,
  type SetupErrors,
} from '../logic/password';
import { localIsoDate } from '../logic/recoveryFile';
import '../auth.css';

type Reveal = { recoveryKey: string; profileName: string | null; doneToast: string };

/** /seguridad: activar la contraseña, clave de recuperación, bloqueo automático, cambiar y quitar. */
export function Component() {
  const t = useT();
  const auth = useAuth();
  const back = useReturnToWorkspace();
  const [loadError, setLoadError] = useState(false);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const pushToast = usePushToast();
  const crypto = isCryptoAvailable();

  const load = () => {
    setLoadError(false);
    auth.refresh().catch(() => setLoadError(true));
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Si se bloquea con la clave a la vista, se olvida: tras desbloquear no vuelve a aparecer.
  useEffect(() => {
    if (auth.locked) setReveal(null);
  }, [auth.locked]);

  const status = auth.status;
  let body: ReactNode;
  if (loadError && status === null) {
    body = (
      <Banner tone="warn" action={<Button onClick={load}>{t('auth.settings.retry')}</Button>}>
        {t('auth.settings.error')}
      </Banner>
    );
  } else if (status === null) {
    body = <Skeleton label={t('auth.settings.loading')} rows={4} />;
  } else if (reveal !== null) {
    body = (
      <RecoveryKeyReveal
        recoveryKey={reveal.recoveryKey}
        profileName={reveal.profileName}
        onDone={() => {
          pushToast({ message: reveal.doneToast });
          setReveal(null);
        }}
      />
    );
  } else {
    body = (
      <div className="auth-sec__grid">
        <div className="auth-sec__main">
          {status.enabled ? (
            <EnabledPanel status={status} onReveal={setReveal} />
          ) : crypto ? (
            <SetupForm onReveal={setReveal} />
          ) : (
            <p className="auth-sec__nocrypto">
              <ShieldOff aria-hidden="true" />
              <span>{t('auth.notice.cryptoUnavailable')}</span>
            </p>
          )}
        </div>
        <ScopeLedger />
      </div>
    );
  }

  return (
    <div className="auth-sec">
      <header className="auth-sec__head">
        <Link to={back.to} className="auth-back">
          <ArrowLeft aria-hidden="true" />
          {back.name ?? t('auth.back')}
        </Link>
        <h1 className="auth-sec__title">{t('auth.settings.title')}</h1>
        {status === null ? null : <StatusLine status={status} />}
      </header>
      {body}
    </div>
  );
}

function StatusLine({ status }: { status: AuthStatus }) {
  const t = useT();
  const changed = status.passwordChangedAt === null ? null : formatDate(localIsoDate(new Date(status.passwordChangedAt)));
  return (
    <p className="auth-sec__status" data-on={status.enabled || undefined}>
      {status.enabled ? <ShieldCheck aria-hidden="true" /> : <LockOpen aria-hidden="true" />}
      <span className="auth-sec__status-main">{status.enabled ? t('auth.settings.statusOn') : t('auth.settings.statusOff')}</span>
      {status.enabled ? (
        <span className="auth-sec__status-meta">
          {[
            status.profileName === null ? null : t('auth.settings.profile', { name: status.profileName }),
            changed === null ? null : t('auth.settings.passwordChangedAt', { date: changed }),
          ]
            .filter((x) => x !== null)
            .join(' · ')}
        </span>
      ) : null}
    </p>
  );
}

/** Qué protege la contraseña, como un renglón de libro: honesto y en tres filas. */
function ScopeLedger() {
  const t = useT();
  const rows = [
    { label: t('auth.scope.entry'), value: t('auth.scope.entryValue'), icon: Lock, tone: 'on' },
    { label: t('auth.scope.backups'), value: t('auth.scope.backupsValue'), icon: ShieldCheck, tone: 'on' },
    { label: t('auth.scope.device'), value: t('auth.scope.deviceValue'), icon: ShieldOff, tone: 'off' },
  ] as const;
  return (
    <section className="auth-scope" aria-labelledby="auth-scope-title">
      <h2 id="auth-scope-title" className="auth-scope__title">
        {t('auth.scope.title')}
      </h2>
      <dl className="auth-scope__list">
        {rows.map(({ label, value, icon: Icon, tone }) => (
          <div key={label} className="auth-scope__row" data-tone={tone}>
            <dt>{label}</dt>
            <dd>
              <Icon aria-hidden="true" />
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="auth-scope__note">{t('auth.scope.deviceNote')}</p>
    </section>
  );
}

// ── Alta ──────────────────────────────────────────────────────────────────────────────

type SetupField = 'profileName' | 'password' | 'confirm';

function SetupForm({ onReveal }: { onReveal: (r: Reveal) => void }) {
  const t = useT();
  const cuadra = useCuadra();
  const refs = {
    profileName: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    confirm: useRef<HTMLInputElement>(null),
  };
  const [profileName, setProfileName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<SetupErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const next = validateSetup({ profileName, password, confirm });
    setErrors(next);
    setServerError(null);
    const first = firstErrorField<SetupField>(next, ['profileName', 'password', 'confirm']);
    if (first !== null) {
      refs[first].current?.focus();
      return;
    }
    setPending(true);
    try {
      const { recoveryKey } = await cuadra.auth.setup({ profileName, password });
      onReveal({ recoveryKey, profileName: profileName.trim(), doneToast: 'auth.setup.done' });
    } catch (error) {
      setServerError(errorMessage(error, t));
    } finally {
      setPending(false);
    }
  };

  const err = (k: keyof SetupErrors) => (errors[k] === undefined ? undefined : t(errors[k]));

  return (
    <form className="auth-form auth-sec__form" onSubmit={(e) => void submit(e)} noValidate>
      <h2 className="auth-form__title">{t('auth.setup.title')}</h2>
      <Field id="profile-name" label={t('auth.setup.profileNameLabel')} help={t('auth.setup.profileNameHint')} error={err('profileName')}>
        <Input
          ref={refs.profileName}
          name="username"
          value={profileName}
          onChange={(e) => setProfileName(e.currentTarget.value)}
          autoComplete="username"
          spellCheck={false}
          autoCorrect="off"
          enterKeyHint="next"
          maxLength={MAX_PROFILE_NAME_LENGTH + 20}
          required
        />
      </Field>
      <PasswordField
        ref={refs.password}
        id="new-password"
        label={t('auth.setup.passwordLabel')}
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        meter
        enterKeyHint="next"
        error={err('password')}
      />
      <PasswordField
        ref={refs.confirm}
        id="confirm-password"
        label={t('auth.setup.confirmLabel')}
        value={confirm}
        onChange={setConfirm}
        autoComplete="new-password"
        enterKeyHint="done"
        error={err('confirm')}
      />
      {serverError === null ? null : (
        <p className="auth-form__error" role="alert">
          {serverError}
        </p>
      )}
      <p className="auth-form__note">{t('auth.notice.noRecovery')}</p>
      <div className="auth-form__actions">
        <Button type="submit" variant="primary" icon={ShieldCheck} loading={pending}>
          {t('auth.setup.submit')}
        </Button>
      </div>
    </form>
  );
}

// ── Activada ──────────────────────────────────────────────────────────────────────────

function EnabledPanel({ status, onReveal }: { status: AuthStatus; onReveal: (r: Reveal) => void }) {
  const t = useT();
  const auth = useAuth();
  return (
    <div className="auth-sec__stack">
      <div className="auth-sec__lockrow">
        <Button icon={Lock} onClick={() => auth.lock()}>
          {t('auth.lock.lockNow')}
        </Button>
      </div>
      <AutoLockChoice current={status.autoLockMinutes} />
      <div className="auth-acts">
        <ActionDetails title={t('auth.settings.change')} icon={KeyRound}>
          <ChangePasswordForm status={status} />
        </ActionDetails>
        <ActionDetails title={t('auth.recovery.regenerate')} icon={KeyRound}>
          <RegenerateForm status={status} onReveal={onReveal} />
        </ActionDetails>
        <ActionDetails title={t('auth.settings.disable')} icon={LockOpen} tone="danger">
          <DisableForm status={status} />
        </ActionDetails>
      </div>
    </div>
  );
}

function ActionDetails({ title, icon: Icon, tone, children }: { title: string; icon: typeof Lock; tone?: 'danger'; children: ReactNode }) {
  return (
    <details name="auth-action" className="auth-act" data-tone={tone}>
      <summary className="auth-act__summary">
        <Icon aria-hidden="true" />
        <span>{title}</span>
      </summary>
      <div className="auth-act__body">{children}</div>
    </details>
  );
}

function minutesLabel(t: ReturnType<typeof useT>, m: number): string {
  if (m === 0) return t('auth.settings.autoLockNever');
  if (m >= 60 && m % 60 === 0) return t('auth.settings.autoLockHours', { count: m / 60 });
  return t('auth.settings.autoLockMinutes', { count: m });
}

function AutoLockChoice({ current }: { current: number }) {
  const t = useT();
  const cuadra = useCuadra();
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const options = autoLockOptions(current);
  const change = async (m: number) => {
    setError(null);
    setSaved(null);
    try {
      await cuadra.auth.setAutoLock(m);
      setSaved(t('auth.settings.autoLockSaved', { value: minutesLabel(t, m) }));
    } catch (e) {
      setError(errorMessage(e, t));
    }
  };
  return (
    <fieldset className="auth-auto">
      <legend className="auth-auto__legend">{t('auth.settings.autoLockLabel')}</legend>
      <div className="auth-auto__opts">
        {options.map((m) => (
          <label key={m} className="auth-auto__opt">
            <input type="radio" name="auto-lock" value={m} checked={current === m} onChange={() => void change(m)} />
            <span>{minutesLabel(t, m)}</span>
          </label>
        ))}
      </div>
      <p className="auth-auto__status" role="status">
        {error ?? saved ?? ''}
      </p>
    </fieldset>
  );
}

/** Estado común de los formularios que piden la contraseña actual (cuentan como intento fallido). */
function useCurrentPasswordForm(status: AuthStatus) {
  const t = useT();
  const [failureRetry, setFailureRetry] = useState<string | null>(null);
  const left = useCountdown(laterRetryAt(failureRetry, status.retryAt));
  const handle = (error: unknown): { current?: string; general?: string } => {
    const f = classifyUnlockError(error);
    if (f.kind === 'wrong') {
      setFailureRetry(f.retryAt);
      return { current: t('auth.form.wrongCurrent') };
    }
    if (f.kind === 'wait') {
      setFailureRetry(f.retryAt);
      return {};
    }
    return { general: errorMessage(error, t) };
  };
  return { waiting: left > 0, clock: formatCountdown(left), handle };
}

function WaitLine({ clock }: { clock: string }) {
  const t = useT();
  return (
    <p className="auth-form__wait">
      <span role="status">{t('auth.lock.waitReason')}</span>{' '}
      <span role="timer" className="num">
        {t('auth.lock.waitShort', { time: clock })}
      </span>
    </p>
  );
}

function ChangePasswordForm({ status }: { status: AuthStatus }) {
  const t = useT();
  const cuadra = useCuadra();
  const pushToast = usePushToast();
  const refs = {
    current: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    confirm: useRef<HTMLInputElement>(null),
  };
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ current?: string; password?: string; confirm?: string; general?: string }>({});
  const [pending, setPending] = useState(false);
  const { waiting, clock, handle } = useCurrentPasswordForm(status);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending || waiting) return;
    const v = validateNewPassword({ password, confirm });
    const next = {
      ...(current.length === 0 ? { current: t('auth.settings.changePasswordFirst') } : {}),
      ...(v.password === undefined ? {} : { password: t(v.password) }),
      ...(v.confirm === undefined ? {} : { confirm: t(v.confirm) }),
    };
    setErrors(next);
    const first = firstErrorField<'current' | 'password' | 'confirm'>(next, ['current', 'password', 'confirm']);
    if (first !== null) {
      refs[first].current?.focus();
      return;
    }
    setPending(true);
    try {
      await cuadra.auth.changePassword(current, password);
      setCurrent('');
      setPassword('');
      setConfirm('');
      pushToast({ message: 'auth.settings.changeDone' });
    } catch (error) {
      const r = handle(error);
      setErrors(r);
      if (r.current !== undefined) {
        refs.current.current?.focus();
        refs.current.current?.select();
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={(e) => void submit(e)} noValidate>
      <input type="text" name="username" autoComplete="username" value={status.profileName ?? ''} readOnly hidden />
      <PasswordField
        ref={refs.current}
        id="change-current-password"
        label={t('auth.settings.currentPasswordLabel')}
        value={current}
        onChange={setCurrent}
        autoComplete="current-password"
        enterKeyHint="next"
        error={errors.current}
      />
      <PasswordField
        ref={refs.password}
        id="change-new-password"
        label={t('auth.settings.newPasswordLabel')}
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        meter
        enterKeyHint="next"
        error={errors.password}
      />
      <PasswordField
        ref={refs.confirm}
        id="change-confirm-password"
        label={t('auth.setup.confirmLabel')}
        value={confirm}
        onChange={setConfirm}
        autoComplete="new-password"
        enterKeyHint="done"
        error={errors.confirm}
      />
      {errors.general === undefined ? null : (
        <p className="auth-form__error" role="alert">
          {errors.general}
        </p>
      )}
      <p className="auth-form__note">{t('auth.notice.oldBackups')}</p>
      {waiting ? <WaitLine clock={clock} /> : null}
      <div className="auth-form__actions">
        <Button type="submit" loading={pending} disabled={waiting} disabledReason={t('auth.lock.waitReason')}>
          {t('auth.settings.changeSubmit')}
        </Button>
      </div>
    </form>
  );
}

function SinglePasswordForm({
  status,
  id,
  note,
  submitLabel,
  danger,
  onSubmit,
}: {
  status: AuthStatus;
  id: string;
  note: string;
  submitLabel: string;
  danger?: boolean;
  onSubmit: (password: string) => Promise<void>;
}) {
  const t = useT();
  const ref = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ current?: string; general?: string }>({});
  const [pending, setPending] = useState(false);
  const { waiting, clock, handle } = useCurrentPasswordForm(status);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending || waiting) return;
    if (password.length === 0) {
      setErrors({ current: t('auth.settings.changePasswordFirst') });
      ref.current?.focus();
      return;
    }
    setPending(true);
    try {
      await onSubmit(password);
    } catch (error) {
      const r = handle(error);
      setErrors(r);
      ref.current?.focus();
      ref.current?.select();
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={(e) => void submit(e)} noValidate>
      <p className="auth-form__note">{note}</p>
      <input type="text" name="username" autoComplete="username" value={status.profileName ?? ''} readOnly hidden />
      <PasswordField
        ref={ref}
        id={id}
        label={t('auth.settings.currentPasswordLabel')}
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
        enterKeyHint="done"
        error={errors.current}
      />
      {errors.general === undefined ? null : (
        <p className="auth-form__error" role="alert">
          {errors.general}
        </p>
      )}
      {waiting ? <WaitLine clock={clock} /> : null}
      <div className="auth-form__actions">
        <Button type="submit" variant={danger === true ? 'danger' : 'secondary'} loading={pending} disabled={waiting} disabledReason={t('auth.lock.waitReason')}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function RegenerateForm({ status, onReveal }: { status: AuthStatus; onReveal: (r: Reveal) => void }) {
  const t = useT();
  const cuadra = useCuadra();
  return (
    <SinglePasswordForm
      status={status}
      id="regen-current-password"
      note={t('auth.recovery.regenerateBody')}
      submitLabel={t('auth.settings.regenerateSubmit')}
      onSubmit={async (password) => {
        const { recoveryKey } = await cuadra.auth.regenerateRecoveryKey(password);
        onReveal({ recoveryKey, profileName: status.profileName, doneToast: 'auth.recovery.created' });
      }}
    />
  );
}

function DisableForm({ status }: { status: AuthStatus }) {
  const t = useT();
  const cuadra = useCuadra();
  const pushToast = usePushToast();
  return (
    <SinglePasswordForm
      status={status}
      id="disable-current-password"
      note={t('auth.settings.disableBody')}
      submitLabel={t('auth.settings.disableSubmit')}
      danger
      onSubmit={async (password) => {
        await cuadra.auth.disable(password);
        pushToast({ message: 'auth.settings.disableDone' });
      }}
    />
  );
}
