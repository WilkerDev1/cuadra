// Lista ordenada de migraciones. El SQL se empaqueta como texto ('?raw') y su sha-256 se guarda en
// schema_migrations: una migración aplicada NO se edita nunca; los cambios van en una nueva.
import init001 from './001_init.sql?raw';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export const MIGRATIONS: readonly Migration[] = [{ version: 1, name: 'init', sql: init001 }];

/** Versión de esquema que espera esta compilación de la app. */
export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);
