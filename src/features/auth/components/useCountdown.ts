import { useEffect, useState } from 'react';
import { remainingMs } from '../logic/lock';

/** Milisegundos que faltan hasta `retryAt`, actualizado cada medio segundo mientras quede espera. */
export function useCountdown(retryAt: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  const left = remainingMs(retryAt, now);
  useEffect(() => {
    if (remainingMs(retryAt, Date.now()) <= 0) return;
    setNow(Date.now());
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (remainingMs(retryAt, t) <= 0) clearInterval(id);
    }, 500);
    return () => clearInterval(id);
  }, [retryAt]);
  return left;
}
