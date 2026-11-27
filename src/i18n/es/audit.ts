// Mensajes del historial (dueño: núcleo). Cada acción guarda `message` (una de estas claves) y `params`;
// la pantalla de historial los traduce con t(entry.message, params). Los montos viajan en unidad menor
// (amountMinor, sumMinor…) y NO se interpolan aquí: la UI los formatea con Money.format junto al texto.
// Las acciones del inicio de sesión local usan sus propias claves auth.audit.* (src/i18n/es/auth.ts).
export default {
  // ── Movimientos ──
  'audit.tx.create': 'Se anotó el n.º {seq}: {description}',
  'audit.tx.edit': 'Se editó el n.º {seq}: {description}',
  'audit.tx.void': 'Se anuló el n.º {seq}: {description}',
  'audit.tx.restore': 'Se restauró el n.º {seq}: {description}',
  'audit.transfer.create': 'Se anotó la transferencia n.º {seq}: {description}',
  'audit.transfer.edit': 'Se editó la transferencia n.º {seq}: {description}',
  'audit.transfer.void': 'Se anuló la transferencia n.º {seq}: {description}',
  'audit.transfer.restore': 'Se restauró la transferencia n.º {seq}: {description}',
  'audit.opening.create': 'Se puso el saldo inicial al {date}',
  'audit.opening.edit': 'Se cambió el saldo inicial',
  'audit.opening.void': 'Se anuló el saldo inicial',
  'audit.opening.restore': 'Se restauró el saldo inicial',

  // ── Lotes, importación y datos de ejemplo ──
  'audit.batch.capture': '{count, plural, one {Se guardó un lote de # movimiento} other {Se guardó un lote de # movimientos}}',
  'audit.batch.import': '{count, plural, one {Se importó # movimiento} other {Se importaron # movimientos}}',
  'audit.batch.void': '{count, plural, one {Se anuló el lote «{label}» (# movimiento)} other {Se anuló el lote «{label}» (# movimientos)}}',
  'audit.batch.restore': '{count, plural, one {Se restauró el lote «{label}» (# movimiento)} other {Se restauró el lote «{label}» (# movimientos)}}',
  'audit.import.commit': '{imported, plural, one {Se importó # movimiento de «{fileName}»} other {Se importaron # movimientos de «{fileName}»}}',
  'audit.demo.seed': 'Se cargaron los datos de ejemplo «{name}» ({transactions} movimientos)',

  // ── Respaldo ──
  'audit.backup.restore': 'Se restauró un respaldo del {backupCreatedAt}',
  'audit.workspace.import': 'Se importó el espacio «{sourceName}» desde un respaldo como «{name}»',

  // ── Espacios ──
  'audit.workspace.create': 'Se creó el espacio «{name}»',
  'audit.workspace.edit': 'Se cambió la configuración del espacio «{name}»',
  'audit.workspace.rename': 'El espacio ahora se llama «{name}»',
  'audit.workspace.archive': 'Se archivó el espacio «{name}»',
  'audit.workspace.unarchive': 'Se recuperó el espacio «{name}»',
  'audit.workspace.purge': 'Se borró definitivamente el espacio «{name}» ({transactions} movimientos)',
  'audit.template.apply': 'Se creó «{name}» con la plantilla {templateName}',

  // ── Cuentas ──
  'audit.account.create': 'Se creó la cuenta «{name}»',
  'audit.account.edit': 'Se cambió la cuenta «{name}»',
  'audit.account.rename': 'La cuenta «{oldName}» ahora se llama «{name}»',
  'audit.account.archive': 'Se archivó la cuenta «{name}»',
  'audit.account.unarchive': 'Se recuperó la cuenta «{name}»',

  // ── Campos y opciones ──
  'audit.field.create': 'Se creó el campo «{label}»',
  'audit.field.edit': 'Se cambió el campo «{label}»',
  'audit.field.rename': 'El campo «{oldLabel}» ahora se llama «{label}»',
  'audit.field.deactivate': 'Se desactivó el campo «{label}»',
  'audit.field.reactivate': 'Se reactivó el campo «{label}»',
  'audit.field.delete': 'Se borró el campo sin usar «{label}»',
  'audit.option.create': 'Se añadió la opción «{label}» a {fieldLabel}',
  'audit.option.edit': 'Se cambió la opción «{label}»',
  'audit.option.rename': 'La opción «{oldLabel}» ahora se llama «{label}»',
  'audit.option.deactivate': 'Se desactivó la opción «{label}»',
  'audit.option.reactivate': 'Se reactivó la opción «{label}»',
  'audit.option.delete': 'Se borró la opción sin usar «{label}»',
  'audit.option.merge': '{movedCount, plural, =0 {«{sourceLabel}» se fusionó con «{targetLabel}»} one {«{sourceLabel}» se fusionó con «{targetLabel}» (# movimiento)} other {«{sourceLabel}» se fusionó con «{targetLabel}» (# movimientos)}}',

  // ── Vistas guardadas ──
  'audit.view.create': 'Se guardó la vista «{name}»',
  'audit.view.edit': 'Se cambió la vista «{name}»',
  'audit.view.duplicate': 'Se duplicó una vista como «{name}»',
  'audit.view.remove': 'Se quitó la vista «{name}»',

  // ── Ajustes ──
  'audit.settings': 'Se cambiaron los ajustes',
} as const;
