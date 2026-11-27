-- src/data/migrations/001_init.sql
-- Requiere SQLite >= 3.45 (STRICT, RETURNING, ->>, json_valid). PRAGMA foreign_keys lo pone el adaptador.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  checksum    TEXT NOT NULL,              -- sha-256 hex del .sql aplicado
  applied_at  TEXT NOT NULL
) STRICT;

-- Ajustes de instalación (scope_id = '') y por espacio (scope_id = workspaces.id).
-- Va primero porque los triggers consultan sys.maintenance.
CREATE TABLE settings (
  scope_id    TEXT NOT NULL DEFAULT '',
  key         TEXT NOT NULL CHECK (length(key) BETWEEN 1 AND 100),
  value       TEXT NOT NULL CHECK (json_valid(value)),
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (scope_id, key)
) STRICT, WITHOUT ROWID;

CREATE TABLE workspaces (
  id               TEXT PRIMARY KEY NOT NULL,
  name             TEXT NOT NULL CHECK (length(trim(name)) > 0),
  owner_name       TEXT NOT NULL DEFAULT '',          -- negocio o persona (aparece en informes)
  template_id      TEXT,                              -- 'negocio', 'despacho'... solo informativo
  currency_code    TEXT NOT NULL DEFAULT 'DOP' CHECK (length(currency_code) = 3),
  currency_symbol  TEXT,                              -- NULL: el que da Intl para el locale
  minor_digits     INTEGER NOT NULL DEFAULT 2 CHECK (minor_digits IN (0, 2, 3)),
  logo_data_url    TEXT CHECK (logo_data_url IS NULL OR logo_data_url LIKE 'data:image/%'),
  color            TEXT,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  is_demo          INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
  archived_at      TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
) STRICT;
CREATE INDEX workspaces_order ON workspaces (archived_at, sort_order);

CREATE TABLE accounts (
  id            TEXT PRIMARY KEY NOT NULL,
  workspace_id  TEXT NOT NULL REFERENCES workspaces (id),
  name          TEXT NOT NULL CHECK (length(trim(name)) > 0),
  type          TEXT NOT NULL DEFAULT 'cash'
                CHECK (type IN ('cash', 'bank', 'card', 'savings', 'wallet', 'other')),
  color         TEXT,
  icon          TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  next_seq      INTEGER NOT NULL DEFAULT 1 CHECK (next_seq >= 1),
  archived_at   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
) STRICT;
CREATE INDEX accounts_ws_order ON accounts (workspace_id, sort_order);
CREATE UNIQUE INDEX accounts_ws_name_active
  ON accounts (workspace_id, name COLLATE NOCASE) WHERE archived_at IS NULL;

CREATE TABLE batches (
  id                         TEXT PRIMARY KEY NOT NULL,
  workspace_id               TEXT NOT NULL REFERENCES workspaces (id),
  account_id                 TEXT REFERENCES accounts (id),   -- NULL en lotes multi-cuenta (demo, plantilla)
  source                     TEXT NOT NULL CHECK (source IN ('capture', 'import', 'template', 'demo')),
  label                      TEXT NOT NULL DEFAULT '',
  control_total_minor        INTEGER CHECK (control_total_minor IS NULL OR control_total_minor >= 0),
  control_mismatch_accepted  INTEGER NOT NULL DEFAULT 0 CHECK (control_mismatch_accepted IN (0, 1)),
  meta                       TEXT CHECK (meta IS NULL OR json_valid(meta)),  -- import: archivo, mapeo
  created_at                 TEXT NOT NULL
) STRICT;
CREATE INDEX batches_ws ON batches (workspace_id, created_at);

CREATE TABLE fields (
  id              TEXT PRIMARY KEY NOT NULL,
  workspace_id    TEXT NOT NULL REFERENCES workspaces (id),
  key             TEXT NOT NULL CHECK (key GLOB '[a-z]*' AND key NOT GLOB '*[^a-z0-9_]*'),
  label           TEXT NOT NULL CHECK (length(trim(label)) > 0),
  type            TEXT NOT NULL CHECK (type IN ('text', 'number', 'date', 'list', 'bool')),
  role            TEXT CHECK (role IS NULL OR role IN
                    ('category', 'contact', 'fund', 'cost_center', 'payment_method', 'reference', 'reconciled')),
  applies_to      TEXT NOT NULL DEFAULT 'both' CHECK (applies_to IN ('both', 'in', 'out')),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  show_in_list    INTEGER NOT NULL DEFAULT 0 CHECK (show_in_list IN (0, 1)),
  deactivated_at  TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (workspace_id, key)
) STRICT;
CREATE INDEX fields_ws_order ON fields (workspace_id, sort_order);

CREATE TABLE field_options (
  id              TEXT PRIMARY KEY NOT NULL,
  field_id        TEXT NOT NULL REFERENCES fields (id),
  key             TEXT,                                  -- clave estable de plantilla (opcional)
  label           TEXT NOT NULL CHECK (length(trim(label)) > 0),
  color           TEXT,
  applies_to      TEXT NOT NULL DEFAULT 'both' CHECK (applies_to IN ('both', 'in', 'out')),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  deactivated_at  TEXT,
  merged_into_id  TEXT REFERENCES field_options (id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  CHECK (merged_into_id IS NULL OR deactivated_at IS NOT NULL),
  CHECK (merged_into_id IS NULL OR merged_into_id <> id)
) STRICT;
CREATE INDEX field_options_field ON field_options (field_id, sort_order);
CREATE UNIQUE INDEX field_options_label_active
  ON field_options (field_id, label COLLATE NOCASE) WHERE deactivated_at IS NULL;

CREATE TABLE transactions (
  id                 TEXT PRIMARY KEY NOT NULL,
  workspace_id       TEXT NOT NULL REFERENCES workspaces (id),
  account_id         TEXT NOT NULL REFERENCES accounts (id),
  seq                INTEGER NOT NULL CHECK (seq >= 1),
  kind               TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'transfer', 'opening')),
  direction          TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  amount_minor       INTEGER NOT NULL CHECK (amount_minor BETWEEN 0 AND 9007199254740991),
  date               TEXT NOT NULL CHECK (date GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
  description        TEXT NOT NULL CHECK (length(trim(description)) > 0),
  notes              TEXT NOT NULL DEFAULT '',
  search_text        TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'voided')),
  void_reason        TEXT,
  voided_at          TEXT,
  voided_with_batch  INTEGER NOT NULL DEFAULT 0 CHECK (voided_with_batch IN (0, 1)),
  batch_id           TEXT REFERENCES batches (id),
  transfer_group_id  TEXT,
  recorded_at        TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE (account_id, seq),
  CHECK ((kind = 'income'  AND direction = 'in')
      OR (kind = 'expense' AND direction = 'out')
      OR kind IN ('transfer', 'opening')),
  CHECK ((kind = 'transfer') = (transfer_group_id IS NOT NULL)),
  CHECK ((status = 'voided') = (voided_at IS NOT NULL)),
  CHECK (status = 'voided' OR (void_reason IS NULL AND voided_with_batch = 0))
) STRICT;
-- Un único saldo inicial por cuenta, en toda su vida (se edita, se anula y se restaura; no se duplica).
CREATE UNIQUE INDEX tx_one_opening_per_account ON transactions (account_id) WHERE kind = 'opening';
-- Una transferencia tiene exactamente un lado 'out' y uno 'in'.
CREATE UNIQUE INDEX tx_transfer_sides ON transactions (transfer_group_id, direction)
  WHERE transfer_group_id IS NOT NULL;
CREATE INDEX tx_ws_date      ON transactions (workspace_id, date, account_id, seq);
CREATE INDEX tx_account_date ON transactions (account_id, date, seq);
CREATE INDEX tx_ws_status    ON transactions (workspace_id, status, kind, date);
CREATE INDEX tx_batch        ON transactions (batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX tx_ws_desc      ON transactions (workspace_id, description COLLATE NOCASE);

CREATE TABLE transaction_field_values (
  transaction_id   TEXT NOT NULL REFERENCES transactions (id),
  field_id         TEXT NOT NULL REFERENCES fields (id),
  value_text       TEXT,
  value_number     REAL,
  value_date       TEXT CHECK (value_date IS NULL OR value_date GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
  value_option_id  TEXT REFERENCES field_options (id),
  value_bool       INTEGER CHECK (value_bool IS NULL OR value_bool IN (0, 1)),
  PRIMARY KEY (transaction_id, field_id),
  CHECK ((value_text IS NOT NULL) + (value_number IS NOT NULL) + (value_date IS NOT NULL)
       + (value_option_id IS NOT NULL) + (value_bool IS NOT NULL) = 1)
) STRICT, WITHOUT ROWID;
CREATE INDEX tfv_field_option ON transaction_field_values (field_id, value_option_id);
CREATE INDEX tfv_option ON transaction_field_values (value_option_id) WHERE value_option_id IS NOT NULL;

-- Filtros, resúmenes e informes guardados como recetas (JSON versionado, ver ViewRecipe).
CREATE TABLE saved_views (
  id              TEXT PRIMARY KEY NOT NULL,
  workspace_id    TEXT NOT NULL REFERENCES workspaces (id),
  kind            TEXT NOT NULL CHECK (kind IN ('filter', 'summary', 'report')),
  name            TEXT NOT NULL CHECK (length(trim(name)) > 0),
  recipe          TEXT NOT NULL CHECK (json_valid(recipe)),
  recipe_version  INTEGER NOT NULL DEFAULT 1,
  pinned          INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  source          TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'template')),
  deleted_at      TEXT,                                -- "borrar" una vista = ocultarla (queda en historial)
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
) STRICT;
CREATE INDEX saved_views_ws_kind ON saved_views (workspace_id, kind, sort_order) WHERE deleted_at IS NULL;

-- Historial solo-añadir. Una fila = una acción del usuario; sus líneas en audit_log_changes.
CREATE TABLE audit_log (
  id            TEXT PRIMARY KEY NOT NULL,           -- uuidv7: ordena por tiempo
  workspace_id  TEXT REFERENCES workspaces (id),     -- NULL = acción de instalación (restaurar, ajustes)
  at            TEXT NOT NULL,
  action        TEXT NOT NULL CHECK (action IN (
                  'create', 'edit', 'void', 'restore', 'batch_create', 'batch_void', 'batch_restore',
                  'import', 'merge', 'config', 'archive', 'unarchive', 'template_apply',
                  'demo_seed', 'backup_restore', 'workspace_import')),
  entity_type   TEXT NOT NULL CHECK (entity_type IN (
                  'workspace', 'account', 'transaction', 'transfer', 'batch', 'field', 'option',
                  'view', 'settings', 'installation')),
  entity_id     TEXT,
  account_id    TEXT,                                -- para filtrar por cuenta (P-12); sin FK a propósito
  batch_id      TEXT,
  message       TEXT NOT NULL,                       -- clave i18n: 'audit.tx.edit', 'audit.option.merge'...
  params        TEXT CHECK (params IS NULL OR json_valid(params)),  -- parámetros del mensaje
  meta          TEXT CHECK (meta IS NULL OR json_valid(meta))       -- p. ej. ids afectados por una fusión
) STRICT;
CREATE INDEX audit_ws_at    ON audit_log (workspace_id, at);
CREATE INDEX audit_entity   ON audit_log (entity_type, entity_id, at);
CREATE INDEX audit_account  ON audit_log (account_id, at) WHERE account_id IS NOT NULL;
CREATE INDEX audit_action   ON audit_log (workspace_id, action, at);

CREATE TABLE audit_log_changes (
  action_id  TEXT NOT NULL REFERENCES audit_log (id),
  ord        INTEGER NOT NULL,
  entity_id  TEXT,                 -- lado concreto en transferencias, opción en fusiones...
  path       TEXT NOT NULL,        -- 'amount_minor' | 'date' | 'description' | 'notes' | 'kind' | 'status'
                                   -- | 'field:<fieldId>' | 'label' | '*' (instantánea al crear)
  old_value  TEXT CHECK (old_value IS NULL OR json_valid(old_value)),
  new_value  TEXT CHECK (new_value IS NULL OR json_valid(new_value)),
  PRIMARY KEY (action_id, ord)
) STRICT, WITHOUT ROWID;
CREATE INDEX audit_changes_entity ON audit_log_changes (entity_id) WHERE entity_id IS NOT NULL;

-- ───────────── Triggers de integridad ─────────────
-- Condición de mantenimiento reutilizada (texto literal en cada trigger):
--   NOT EXISTS (SELECT 1 FROM settings WHERE scope_id = '' AND key = 'sys.maintenance')

-- Movimiento y cuenta deben ser del mismo espacio (F-02, F-21).
CREATE TRIGGER tx_same_workspace BEFORE INSERT ON transactions
WHEN NEW.workspace_id IS NOT (SELECT workspace_id FROM accounts WHERE id = NEW.account_id)
BEGIN SELECT RAISE(ABORT, 'workspace_mismatch'); END;

-- seq = el número recién reservado en accounts.next_seq (sin huecos).
CREATE TRIGGER tx_seq_reserved BEFORE INSERT ON transactions
WHEN NEW.seq <> (SELECT next_seq - 1 FROM accounts WHERE id = NEW.account_id)
 AND NOT EXISTS (SELECT 1 FROM settings WHERE scope_id = '' AND key = 'sys.maintenance')
BEGIN SELECT RAISE(ABORT, 'seq_not_reserved'); END;

CREATE TRIGGER accounts_next_seq_monotonic BEFORE UPDATE OF next_seq ON accounts
WHEN NEW.next_seq < OLD.next_seq
BEGIN SELECT RAISE(ABORT, 'seq_decrease'); END;

-- Columnas inmutables del movimiento.
CREATE TRIGGER tx_immutable BEFORE UPDATE ON transactions
WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id
  OR NEW.account_id IS NOT OLD.account_id OR NEW.seq IS NOT OLD.seq
  OR NEW.recorded_at IS NOT OLD.recorded_at OR NEW.batch_id IS NOT OLD.batch_id
  OR NEW.transfer_group_id IS NOT OLD.transfer_group_id
  OR (NEW.kind IS NOT OLD.kind AND (OLD.kind IN ('transfer', 'opening') OR NEW.kind IN ('transfer', 'opening')))
BEGIN SELECT RAISE(ABORT, 'immutable_column'); END;

CREATE TRIGGER fields_type_immutable BEFORE UPDATE OF type ON fields
WHEN NEW.type IS NOT OLD.type
BEGIN SELECT RAISE(ABORT, 'field_type_immutable'); END;

CREATE TRIGGER options_only_on_list BEFORE INSERT ON field_options
WHEN (SELECT type FROM fields WHERE id = NEW.field_id) IS NOT 'list'
BEGIN SELECT RAISE(ABORT, 'options_require_list_field'); END;

-- El valor usa la columna de su tipo y, si es opción, pertenece al campo.
CREATE TRIGGER tfv_type_check_ins BEFORE INSERT ON transaction_field_values
WHEN CASE (SELECT type FROM fields WHERE id = NEW.field_id)
       WHEN 'text'   THEN NEW.value_text IS NULL
       WHEN 'number' THEN NEW.value_number IS NULL
       WHEN 'date'   THEN NEW.value_date IS NULL
       WHEN 'bool'   THEN NEW.value_bool IS NULL
       WHEN 'list'   THEN NEW.value_option_id IS NULL
            OR (SELECT field_id FROM field_options WHERE id = NEW.value_option_id) IS NOT NEW.field_id
       ELSE 1 END
BEGIN SELECT RAISE(ABORT, 'field_value_type_mismatch'); END;

CREATE TRIGGER tfv_type_check_upd BEFORE UPDATE ON transaction_field_values
WHEN NEW.field_id IS NOT OLD.field_id OR NEW.transaction_id IS NOT OLD.transaction_id
  OR CASE (SELECT type FROM fields WHERE id = NEW.field_id)
       WHEN 'text'   THEN NEW.value_text IS NULL
       WHEN 'number' THEN NEW.value_number IS NULL
       WHEN 'date'   THEN NEW.value_date IS NULL
       WHEN 'bool'   THEN NEW.value_bool IS NULL
       WHEN 'list'   THEN NEW.value_option_id IS NULL
            OR (SELECT field_id FROM field_options WHERE id = NEW.value_option_id) IS NOT NEW.field_id
       ELSE 1 END
BEGIN SELECT RAISE(ABORT, 'field_value_type_mismatch'); END;

-- Nada se borra fuera del modo mantenimiento.
CREATE TRIGGER no_delete_workspaces BEFORE DELETE ON workspaces
WHEN NOT EXISTS (SELECT 1 FROM settings WHERE scope_id = '' AND key = 'sys.maintenance')
BEGIN SELECT RAISE(ABORT, 'delete_forbidden'); END;
CREATE TRIGGER no_delete_accounts BEFORE DELETE ON accounts
WHEN NOT EXISTS (SELECT 1 FROM settings WHERE scope_id = '' AND key = 'sys.maintenance')
BEGIN SELECT RAISE(ABORT, 'delete_forbidden'); END;
CREATE TRIGGER no_delete_transactions BEFORE DELETE ON transactions
WHEN NOT EXISTS (SELECT 1 FROM settings WHERE scope_id = '' AND key = 'sys.maintenance')
BEGIN SELECT RAISE(ABORT, 'delete_forbidden'); END;
CREATE TRIGGER no_delete_batches BEFORE DELETE ON batches
WHEN NOT EXISTS (SELECT 1 FROM settings WHERE scope_id = '' AND key = 'sys.maintenance')
BEGIN SELECT RAISE(ABORT, 'delete_forbidden'); END;

-- Historial: solo crece.
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_append_only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log
WHEN NOT EXISTS (SELECT 1 FROM settings WHERE scope_id = '' AND key = 'sys.maintenance')
BEGIN SELECT RAISE(ABORT, 'audit_append_only'); END;
CREATE TRIGGER audit_changes_no_update BEFORE UPDATE ON audit_log_changes
BEGIN SELECT RAISE(ABORT, 'audit_append_only'); END;
CREATE TRIGGER audit_changes_no_delete BEFORE DELETE ON audit_log_changes
WHEN NOT EXISTS (SELECT 1 FROM settings WHERE scope_id = '' AND key = 'sys.maintenance')
BEGIN SELECT RAISE(ABORT, 'audit_append_only'); END;
