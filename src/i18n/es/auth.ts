// Cadenas del inicio de sesión local (dueño: núcleo, servicio auth). Prefijo `auth.`.
// Los mensajes de sus códigos de error viven en src/i18n/es/errors.ts (errors.<codigo>).
export default {
  // ── Avisos honestos: qué protege la contraseña y qué no ──
  'auth.notice.scope': 'La contraseña protege el acceso y cifra tus respaldos. Los datos guardados en este dispositivo no se cifran.',
  'auth.notice.device':
    'Quien tenga acceso a este dispositivo y sepa lo suficiente podría leer los datos sin pasar por esta pantalla.',
  'auth.notice.oldBackups':
    'Si cambias la contraseña, los respaldos anteriores se siguen abriendo con la contraseña con la que se hicieron.',
  'auth.notice.noRecovery':
    'Si olvidas la contraseña y pierdes la clave de recuperación, no hay forma de entrar ni de abrir tus respaldos cifrados.',
  'auth.notice.cryptoUnavailable':
    'Este navegador no permite cifrar aquí. Abre Cuadra desde una dirección segura (https) o la aplicación de escritorio.',
  'auth.notice.optional': 'La contraseña es opcional. Sin ella, cualquiera que abra este dispositivo verá tus libros.',

  // ── Pantalla de bloqueo ──
  'auth.lock.title': 'Cuadra está bloqueada',
  'auth.lock.greeting': 'Hola, {name}',
  'auth.lock.passwordLabel': 'Contraseña',
  'auth.lock.submit': 'Entrar',
  'auth.lock.checking': 'Comprobando…',
  'auth.lock.forgot': 'Olvidé la contraseña',
  'auth.lock.wrong': 'Contraseña incorrecta.',
  'auth.lock.attemptsLeft': '{count, plural, one {Te queda # intento} other {Te quedan # intentos}} antes de tener que esperar.',
  'auth.lock.wait': 'Demasiados intentos. Vuelve a intentarlo en {time}.',
  'auth.lock.autoLocked': 'Se bloqueó por inactividad. Tus datos siguen como los dejaste.',
  'auth.lock.lockNow': 'Bloquear ahora',
  'auth.lock.showPassword': 'Mostrar contraseña',
  'auth.lock.hidePassword': 'Ocultar contraseña',

  // ── Alta ──
  'auth.setup.title': 'Proteger con contraseña',
  'auth.setup.intro': 'Pide la contraseña al abrir Cuadra y cifra los respaldos que exportes.',
  'auth.setup.profileNameLabel': 'Tu nombre o el del negocio',
  'auth.setup.profileNameHint': 'Aparece en la pantalla de bloqueo.',
  'auth.setup.passwordLabel': 'Contraseña',
  'auth.setup.passwordHint': 'Al menos {min} caracteres. Una frase de varias palabras es fácil de recordar y difícil de adivinar.',
  'auth.setup.confirmLabel': 'Repite la contraseña',
  'auth.setup.mismatch': 'Las contraseñas no coinciden.',
  'auth.setup.submit': 'Activar contraseña',
  'auth.setup.done': 'Contraseña activada.',

  // ── Clave de recuperación ──
  'auth.recovery.title': 'Guarda tu clave de recuperación',
  'auth.recovery.body':
    'Si olvidas la contraseña, esta clave te deja entrar y poner una nueva. Solo se muestra ahora: anótala en papel o guárdala en tu gestor de contraseñas.',
  'auth.recovery.copy': 'Copiar clave',
  'auth.recovery.copied': 'Clave copiada.',
  'auth.recovery.download': 'Guardar en un archivo',
  'auth.recovery.confirm': 'Ya la guardé',
  'auth.recovery.confirmCheck': 'Entiendo que no se puede volver a mostrar.',
  'auth.recovery.useTitle': 'Entrar con la clave de recuperación',
  'auth.recovery.keyLabel': 'Clave de recuperación',
  'auth.recovery.keyHint': 'Seis grupos de cuatro letras y números. Da igual si usas mayúsculas, espacios o guiones.',
  'auth.recovery.newPasswordLabel': 'Contraseña nueva',
  'auth.recovery.submit': 'Poner contraseña nueva y entrar',
  'auth.recovery.done': 'Contraseña nueva guardada. Tu clave de recuperación sigue valiendo.',
  'auth.recovery.regenerate': 'Crear otra clave de recuperación',
  'auth.recovery.regenerateBody': 'La clave anterior dejará de servir.',
  'auth.recovery.back': 'Volver a la contraseña',

  // ── Ajustes ──
  'auth.settings.title': 'Contraseña y bloqueo',
  'auth.settings.statusOn': 'Contraseña activada',
  'auth.settings.statusOff': 'Sin contraseña',
  'auth.settings.enable': 'Activar contraseña',
  'auth.settings.change': 'Cambiar contraseña',
  'auth.settings.currentPasswordLabel': 'Contraseña actual',
  'auth.settings.newPasswordLabel': 'Contraseña nueva',
  'auth.settings.changeDone': 'Contraseña cambiada.',
  'auth.settings.disable': 'Quitar contraseña',
  'auth.settings.disableBody':
    'Cuadra se abrirá sin pedir nada y los respaldos nuevos no se cifrarán. Los respaldos ya cifrados siguen necesitando su contraseña.',
  'auth.settings.disableConfirm': 'Quitar contraseña',
  'auth.settings.disableDone': 'Contraseña quitada.',
  'auth.settings.autoLockLabel': 'Bloquear tras inactividad',
  'auth.settings.autoLockNever': 'Nunca',
  'auth.settings.autoLockMinutes': '{count} min',
  'auth.settings.autoLockHours': '{count} h',
  'auth.settings.passwordChangedAt': 'Último cambio: {date}',

  // ── Respaldos cifrados ──
  'auth.backup.encrypted': 'Respaldo cifrado con tu contraseña.',
  'auth.backup.notEncrypted': 'Este respaldo no va cifrado: activa una contraseña para cifrar los próximos.',
  'auth.backup.askPassword': 'Este respaldo está cifrado. Escribe la contraseña con la que se hizo.',
  'auth.backup.wrongPassword': 'Esa contraseña no abre este respaldo. Si la cambiaste después, prueba con la anterior.',

  // ── Historial (mensajes de audit_log.message) ──
  'auth.audit.enabled': 'Se activó la contraseña ({profileName})',
  'auth.audit.disabled': 'Se quitó la contraseña',
  'auth.audit.passwordChanged': 'Se cambió la contraseña',
  'auth.audit.recovered': 'Se puso una contraseña nueva con la clave de recuperación',
  'auth.audit.recoveryKeyRegenerated': 'Se creó una clave de recuperación nueva',
  'auth.audit.autoLockChanged': 'Bloqueo por inactividad: {minutes} min',
} as const;
