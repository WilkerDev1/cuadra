import { Monitor, Moon, Sun } from 'lucide-react';
import { useT } from '../../i18n';
import { IconButton, Segmented } from '../../ui';
import { nextTheme } from '../state/theme';
import { useUiStore, type ThemeChoice } from '../state/uiStore';

const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

/** Sistema | Claro | Oscuro (página «Más»). La elección se guarda y se aplica al instante. */
export function ThemeSegmented() {
  const t = useT();
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const options = (['system', 'light', 'dark'] as const).map((value) => ({
    value,
    label: t(`common.theme.${value}`),
    icon: ICONS[value],
  }));
  return <Segmented<ThemeChoice> label={t('common.theme.label')} options={options} value={theme} onChange={setTheme} fullWidth />;
}

/** Botón compacto que recorre sistema → claro → oscuro (barra lateral). */
export function ThemeButton({ variant = 'on-forest' }: { variant?: 'ghost' | 'on-forest' }) {
  const t = useT();
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  return (
    <IconButton
      variant={variant}
      icon={ICONS[theme]}
      label={t('common.theme.cycle', { name: t(`common.theme.${theme}`) })}
      onClick={() => setTheme(nextTheme(theme))}
    />
  );
}
