import { Copy, Download, Printer } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../../i18n';
import { formatDate } from '../../../i18n/format';
import { Button } from '../../../ui';
import { buildRecoveryFile, formatRecoveryKey, localIsoDate, recoveryKeyGroups } from '../logic/recoveryFile';

export interface RecoveryKeyRevealProps {
  recoveryKey: string;
  profileName: string | null;
  /** Se llama cuando la persona marcó «Ya la guardé» y pulsó Listo. Después la clave no se vuelve a ver. */
  onDone: () => void;
}

type Feedback = { key: string; tone: 'ok' | 'warn' } | null;

/**
 * La clave de recuperación se enseña UNA vez: copiar, guardar en archivo, imprimir y casilla «Ya la guardé».
 * Es un paso con su propio encabezado (recibe el foco al aparecer), no un toast ni un diálogo que se cierre solo.
 */
export function RecoveryKeyReveal({ recoveryKey, profileName, onDone }: RecoveryKeyRevealProps) {
  const t = useT();
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [saved, setSaved] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const formatted = formatRecoveryKey(recoveryKey);
  const groups = recoveryKeyGroups(recoveryKey);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // Al imprimir solo sale la hoja de la clave (ver @media print en auth.css).
  useEffect(() => {
    const done = () => document.documentElement.classList.remove('auth-printing');
    window.addEventListener('afterprint', done);
    return () => {
      window.removeEventListener('afterprint', done);
      done();
    };
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatted);
      setFeedback({ key: 'auth.recovery.copied', tone: 'ok' });
    } catch {
      setFeedback({ key: 'auth.recovery.copyFailed', tone: 'warn' });
    }
  };

  const download = () => {
    const now = new Date();
    const iso = localIsoDate(now);
    const file = buildRecoveryFile({ recoveryKey, profileName, dateLabel: formatDate(iso), isoDate: iso, t });
    const url = URL.createObjectURL(new Blob([file.text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.rel = 'noopener';
    a.click();
    // Se revoca en la siguiente vuelta: algunos navegadores leen la URL después del clic.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setFeedback({ key: 'auth.recovery.downloaded', tone: 'ok' });
  };

  const print = () => {
    document.documentElement.classList.add('auth-printing');
    window.print();
  };

  return (
    <section className="auth-key" aria-labelledby={titleId}>
      <h2 id={titleId} ref={headingRef} tabIndex={-1} className="auth-key__title">
        {t('auth.recovery.title')}
      </h2>
      <p className="auth-key__body">{t('auth.recovery.body')}</p>

      <div className="auth-key__sheet">
        <p className="auth-key__print-head" aria-hidden="true">
          {t('auth.file.heading')}
          {profileName === null ? null : ` · ${profileName}`}
        </p>
        <p className="auth-key__value">
          {groups.map((g, i) => (
            <span key={i} className="auth-key__group" aria-hidden="true">
              {g}
            </span>
          ))}
          <span className="visually-hidden">{t('auth.recovery.keyAria', { key: groups.join(' ') })}</span>
        </p>
        <p className="auth-key__print-foot" aria-hidden="true">
          {t('auth.file.howTo')}
        </p>
      </div>

      <div className="auth-key__actions">
        <Button icon={Copy} onClick={() => void copy()}>
          {t('auth.recovery.copy')}
        </Button>
        <Button icon={Download} onClick={download}>
          {t('auth.recovery.download')}
        </Button>
        <Button icon={Printer} onClick={print}>
          {t('auth.recovery.print')}
        </Button>
      </div>
      <p className="auth-key__feedback" role="status" data-tone={feedback?.tone}>
        {feedback === null ? '' : t(feedback.key)}
      </p>

      <div className="auth-key__confirm">
        <label className="auth-check">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.currentTarget.checked)} />
          <span>
            <span className="auth-check__label">{t('auth.recovery.confirm')}</span>
            <span className="auth-check__help">{t('auth.recovery.confirmCheck')}</span>
          </span>
        </label>
        <Button variant="primary" disabled={!saved} disabledReason={t('auth.recovery.mustConfirm')} onClick={onDone}>
          {t('auth.recovery.done2')}
        </Button>
      </div>
    </section>
  );
}
