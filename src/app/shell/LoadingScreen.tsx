import { useT } from '../../i18n';
import { Skeleton } from '../../ui';

/** Arranque en curso: renglones quietos y «Abriendo Cuadra…» si tarda más de 300 ms. */
export function LoadingScreen() {
  const t = useT();
  return (
    <main className="shell-center">
      <Skeleton label={t('common.loading')} rows={3} />
    </main>
  );
}
