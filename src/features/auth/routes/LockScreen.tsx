import { CircleCheck, Lock } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useCuadra } from '../../../app/data/CuadraProvider';
import { useAuth, usePushToast } from '../../../app/data/hooks';
import { errorMessage } from '../../../app/data/errorMessage';
import type { LockScreenProps } from '../../../app/registry/types';
import { isValidRecoveryKey } from '../../../core';
import { useT } from '../../../i18n';
import { Button, DoubleRule, Field, Input } from '../../../ui';
import { PasswordField } from '../components/PasswordField';
import { useCountdown } from '../components/useCountdown';
import { attemptsLeft, classifyUnlockError, formatCountdown, laterRetryAt, type UnlockFailure } from '../logic/lock';
import { firstErrorField, validateNewPassword, type NewPasswordErrors } from '../logic/password';
import '../auth.css';

type Mode = 'password' | 'recovery';

/** Pantalla de bloqueo a pantalla completa (la pone el shell con LockGate cuando hay contraseña y la sesión está cerrada). */
export function Component({ busy }: LockScreenProps) {
  const t = useT();
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>('password');
  const profileName = auth.status?.profileName ?? null;

  return (
    <div className="auth-lock">
      <div className="auth-lock__paper" aria-hidden="true">
        <div className="auth-lock__cols">
          <span>{t('auth.paper.date')}</span>
          <span>{t('auth.paper.concept')}</span>
          <span className="auth-lock__col-num">{t('auth.paper.in')}</span>
          <span className="auth-lock__col-num">{t('auth.paper.out')}</span>
          <span className="auth-lock__col-num">{t('auth.paper.balance')}</span>
        </div>
      </div>
      <div className="auth-lock__inner">
        <div className="auth-lock__brand">
          <p className="auth-lock__mark">
            {t('common.appName')}
            <span className="auth-lock__dot" aria-hidden="true" />
          </p>
          <DoubleRule className="auth-lock__rule" />
        </div>
        <section className="auth-lock__card" aria-labelledby="auth-lock-title">
          <p className="auth-lock__status">
            <Lock aria-hidden="true" />
            <span>{t('auth.lock.locked')}</span>
          </p>
          <h1 id="auth-lock-title" className="auth-lock__name">
            {profileName ?? t('auth.lock.title')}
            {profileName === null ? null : <span className="visually-hidden"> · {t('auth.lock.title')}</span>}
          </h1>
          {mode === 'password' ? (
            <PasswordForm busy={busy} profileName={profileName} onForgot={() => setMode('recovery')} />
          ) : (
            <RecoveryForm busy={busy} onBack={() => setMode('password')} />
          )}
        </section>
      </div>
    </div>
  );
}

/** Espera vigente: la del último error o la que diga el servicio, la más tardía. */
function useWait(failure: UnlockFailure | null) {
  const auth = useAuth();
  const fromError = failure !== null && 'retryAt' in failure ? failure.retryAt : null;
  const retryAt = laterRetryAt(fromError, auth.status?.retryAt ?? null);
  const left = useCountdown(retryAt);
  return { waiting: left > 0, clock: formatCountdown(left) };
}

const WAIT_ID = 'auth-lock-wait';

function WaitNotice({ clock }: { clock: string }) {
  const t = useT();
  return (
    <p id={WAIT_ID} className="auth-lock__wait">
      <span role="status">{t('auth.lock.waitReason')}</span>
      {/* role=timer no se anuncia en cada segundo (aria-live implícito off). */}
      <span role="timer" className="auth-lock__clock num">
        {t('auth.lock.waitShort', { time: clock })}
      </span>
    </p>
  );
}

function PasswordForm({ busy, profileName, onForgot }: { busy: boolean; profileName: string | null; onForgot: () => void }) {
  const t = useT();
  const auth = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<UnlockFailure | null>(null);
  const { waiting, clock } = useWait(failure);

  // Al terminar la espera, el cursor vuelve al campo.
  const wasWaiting = useRef(waiting);
  useEffect(() => {
    if (wasWaiting.current && !waiting) input.current?.focus();
    wasWaiting.current = waiting;
  }, [waiting]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (waiting || pending) return;
    if (password.length === 0) {
      input.current?.focus();
      return;
    }
    setPending(true);
    try {
      await auth.unlock(password);
      // Éxito: el shell retira esta pantalla.
    } catch (error) {
      setFailure(classifyUnlockError(error));
      input.current?.focus();
      input.current?.select();
    } finally {
      setPending(false);
    }
  };

  let error: string | undefined;
  let hint: string | null = null;
  if (failure?.kind === 'wrong') {
    error = t('auth.lock.wrong');
    const left = attemptsLeft(failure.failedAttempts);
    if (left > 0) hint = t('auth.lock.attemptsLeft', { count: left });
  } else if (failure?.kind === 'other') {
    error = errorMessage(failure.error, t);
  }

  return (
    <form className="auth-form" onSubmit={(e) => void submit(e)} noValidate>
      {/* Para que el gestor de contraseñas asocie la contraseña al perfil. */}
      <input type="text" name="username" autoComplete="username" value={profileName ?? ''} readOnly hidden />
      <PasswordField
        ref={input}
        id="current-password"
        label={t('auth.lock.passwordLabel')}
        value={password}
        onChange={(v) => {
          setPassword(v);
          if (failure?.kind === 'other') setFailure(null);
        }}
        autoComplete="current-password"
        autoFocus
        enterKeyHint="go"
        error={error}
        help={hint ?? undefined}
      />
      {waiting ? <WaitNotice clock={clock} /> : null}
      <Button
        type="submit"
        variant="primary"
        fullWidth
        loading={pending || busy}
        disabled={waiting}
        aria-describedby={waiting ? WAIT_ID : undefined}
      >
        {pending ? t('auth.lock.checking') : t('auth.lock.submit')}
      </Button>
      <Button variant="ghost" className="auth-lock__link" onClick={onForgot}>
        {t('auth.lock.forgot')}
      </Button>
    </form>
  );
}

type RecoveryField = 'key' | 'password' | 'confirm';

function RecoveryForm({ busy, onBack }: { busy: boolean; onBack: () => void }) {
  const t = useT();
  const cuadra = useCuadra();
  const pushToast = usePushToast();
  const refs = {
    key: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    confirm: useRef<HTMLInputElement>(null),
  };
  const [key, setKey] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<NewPasswordErrors & { key?: string }>({});
  const [failure, setFailure] = useState<UnlockFailure | null>(null);
  const [pending, setPending] = useState(false);
  const { waiting, clock } = useWait(failure);
  const keyOk = isValidRecoveryKey(key);

  useEffect(() => {
    refs.key.current?.focus(); // solo al entrar en este modo
  }, [refs.key]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (waiting || pending) return;
    const next: NewPasswordErrors & { key?: string } = { ...validateNewPassword({ password, confirm }) };
    if (key.trim().length === 0) next.key = 'auth.recovery.keyRequired';
    else if (!keyOk) next.key = 'auth.recovery.checksum';
    setErrors(next);
    const first = firstErrorField<RecoveryField>(next, ['key', 'password', 'confirm']);
    if (first !== null) {
      refs[first].current?.focus();
      return;
    }
    setPending(true);
    try {
      await cuadra.auth.unlockWithRecoveryKey(key, password);
      pushToast({ message: 'auth.recovery.done' });
    } catch (error) {
      const f = classifyUnlockError(error);
      setFailure(f);
      if (f.kind === 'checksum' || f.kind === 'wrongKey') {
        setErrors({ key: f.kind === 'checksum' ? 'auth.recovery.checksum' : 'auth.recovery.wrongKey' });
        refs.key.current?.focus();
        refs.key.current?.select();
      }
    } finally {
      setPending(false);
    }
  };

  const otherError = failure?.kind === 'other' ? errorMessage(failure.error, t) : null;

  return (
    <form className="auth-form" onSubmit={(e) => void submit(e)} noValidate>
      <h2 className="auth-form__title">{t('auth.recovery.useTitle')}</h2>
      <Field
        id="recovery-key"
        label={t('auth.recovery.keyLabel')}
        help={
          keyOk ? (
            <span className="auth-ok">
              <CircleCheck aria-hidden="true" />
              {t('auth.recovery.keyComplete')}
            </span>
          ) : (
            t('auth.recovery.keyHint')
          )
        }
        error={errors.key === undefined ? undefined : t(errors.key)}
      >
        <Input
          ref={refs.key}
          name="recovery-key"
          className="auth-key-input"
          value={key}
          onChange={(e) => {
            setKey(e.currentTarget.value);
            if (errors.key !== undefined) {
              setErrors(({ key: _drop, ...rest }) => rest);
            }
          }}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          required
          maxLength={64}
        />
      </Field>
      <PasswordField
        ref={refs.password}
        id="new-password"
        label={t('auth.recovery.newPasswordLabel')}
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        meter
        enterKeyHint="next"
        error={errors.password === undefined ? undefined : t(errors.password)}
      />
      <PasswordField
        ref={refs.confirm}
        id="confirm-password"
        label={t('auth.setup.confirmLabel')}
        value={confirm}
        onChange={setConfirm}
        autoComplete="new-password"
        enterKeyHint="go"
        error={errors.confirm === undefined ? undefined : t(errors.confirm)}
      />
      {otherError === null ? null : (
        <p className="auth-form__error" role="alert">
          {otherError}
        </p>
      )}
      {waiting ? <WaitNotice clock={clock} /> : null}
      <Button
        type="submit"
        variant="primary"
        fullWidth
        loading={pending || busy}
        disabled={waiting}
        aria-describedby={waiting ? WAIT_ID : undefined}
      >
        {t('auth.recovery.submit')}
      </Button>
      <Button variant="ghost" className="auth-lock__link" onClick={onBack}>
        {t('auth.recovery.back')}
      </Button>
    </form>
  );
}
