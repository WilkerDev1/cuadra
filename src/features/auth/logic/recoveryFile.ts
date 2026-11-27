// Archivo de texto con la clave de recuperación («Guardar en un archivo»). Puro: devuelve nombre y contenido.

export interface RecoveryFileInput {
  recoveryKey: string;
  profileName: string | null;
  /** Fecha local ya formateada para mostrar («27 nov 2026»). */
  dateLabel: string;
  /** Fecha ISO local (AAAA-MM-DD) para el nombre del archivo. */
  isoDate: string;
  t: (key: string, params?: Record<string, string | number>) => string;
}

/** Agrupa la clave en bloques de cuatro separados por guion, como la genera el núcleo. */
export function formatRecoveryKey(key: string): string {
  const compact = key.toUpperCase().replace(/[^0-9A-Z]/g, '');
  return (compact.match(/.{1,4}/g) ?? []).join('-');
}

/** Grupos de la clave para pintarlos por separado. */
export function recoveryKeyGroups(key: string): string[] {
  return formatRecoveryKey(key).split('-').filter((g) => g.length > 0);
}

export function recoveryFileName(isoDate: string): string {
  return `cuadra-clave-de-recuperacion-${isoDate}.txt`;
}

export function buildRecoveryFile(input: RecoveryFileInput): { name: string; text: string } {
  const { t } = input;
  const lines = [
    t('auth.file.heading'),
    '',
    formatRecoveryKey(input.recoveryKey),
    '',
    ...(input.profileName === null || input.profileName === '' ? [] : [t('auth.file.profile', { name: input.profileName })]),
    t('auth.file.created', { date: input.dateLabel }),
    '',
    t('auth.file.howTo'),
    t('auth.file.keepAway'),
  ];
  // CRLF: el Bloc de notas antiguo de Windows no parte líneas con LF solo.
  return { name: recoveryFileName(input.isoDate), text: `${lines.join('\r\n')}\r\n` };
}

/** AAAA-MM-DD en la zona local (no UTC: a las 21 h en Santo Domingo ya sería «mañana» en UTC). */
export function localIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
