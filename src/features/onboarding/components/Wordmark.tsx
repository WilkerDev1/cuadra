import { useT } from '../../../i18n';

/** «Cuadra» con el sello como punto final (DESIGN §10.1): un cuadrado lima con borde de tinta. */
export function Wordmark() {
  const t = useT();
  return (
    <span className="onb-wordmark">
      {t('onboarding.welcome.wordmark')}
      <span className="onb-wordmark__dot" aria-hidden="true" />
    </span>
  );
}
