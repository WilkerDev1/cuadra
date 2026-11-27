# Arquitectura de Cuadra

**Estado:** contrato técnico de la demo. Las firmas y el DDL de este documento son el punto de partida obligatorio para los implementadores. Si el código discrepa y el cambio es mejor, se corrige este documento en el mismo commit.

**Lectura previa:** [PLAN.md](PLAN.md) (alcance) y [DESIGN.md](DESIGN.md) (dirección visual). Este documento no define colores ni tipografías.

**Convenciones:** documentación e interfaz en español; código, identificadores, tablas y columnas en inglés. Las rutas de la URL van en español porque el usuario las ve.

---

## 0. Resumen en una pantalla

```
                ┌──────────────────────────────────────────────────────────┐
  React 19      │ src/features/<x>   (pantallas, una carpeta por área)     │
                │      │ usa                                               │
                │ src/app/data  (hooks TanStack Query + eventos)           │
                │ src/app/registry (tipos para registrarse en el shell)    │
                │ src/ui (sistema de diseño)   src/i18n (cadenas, formato) │
                └──────┼───────────────────────────────────────────────────┘
                       ▼ llama a la fachada `Cuadra`
  TS puro       ┌──────────────────────────────────────────────────────────┐
                │ src/core  dominio: tipos, Money, reglas, servicios, SQL  │
                │           depende solo del puerto SqlDriver (core/ports) │
                └──────┼───────────────────────────────────────────────────┘
                       ▼ implementa el puerto
  Adaptadores   ┌──────────────────────────────────────────────────────────┐
                │ src/data  migraciones .sql + runner                      │
                │   wasm/  sqlite-wasm + opfs-sahpool en Worker (+ candado)│
                │   wasm/  respaldo :memory: + IndexedDB si no hay OPFS    │
                │   node/  node:sqlite (solo pruebas)                      │
                │   tauri/ invoke → rusqlite (escritorio)                  │
                └──────────────────────────────────────────────────────────┘
  Rust          src-tauri: cáscara fina, 6 comandos db_* + diálogos/fs
```

Un solo dialecto SQL (SQLite ≥ 3.45, en la práctica 3.54.1 en WASM y en Node 26). El núcleo escribe ese SQL una vez y los tres adaptadores lo ejecutan sin traducir.

---

## 1. Estructura de carpetas

Un solo paquete pnpm. Nada de monorepo: la separación se hace con carpetas y con una prueba de dependencias (ver 1.3).

```
cuadra/
├── package.json                 # "type": "module"; scripts dev/build/test/lint/tauri
├── pnpm-lock.yaml
├── index.html                   # <div id="root">, meta theme-color, manifest lo inyecta vite-plugin-pwa
├── vite.config.ts               # react, pwa, worker format 'es', optimizeDeps.exclude sqlite-wasm, base './'
├── vitest.config.ts             # environment 'node', include src/**/*.test.ts, setupFiles src/test/setup.ts
├── tsconfig.json                # referencias a los dos de abajo; noEmit
├── tsconfig.app.json            # src/** excepto src/data/node/** y *.test.ts; lib DOM, WebWorker; sin @types/node
├── tsconfig.node.json           # vite/vitest config, src/data/node/**, **/*.test.ts, src/test/**; @types/node
├── playwright.config.ts         # e2e en Ola 4
├── public/                      # iconos PWA generados (192, 512, maskable-512), favicon.svg
├── docs/                        # PLAN, ARCHITECTURE, DESIGN, RESEARCH, LICENSES
├── e2e/                         # pruebas Playwright (Ola 4)
├── scripts/
│   └── gen-icons.ts             # @vite-pwa/assets-generator
├── src-tauri/                   # cáscara Rust (sección 7.3)
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/default.json
│   └── src/{main.rs, lib.rs, db.rs}
└── src/
    ├── main.tsx                 # arranque: boot() → <App/>
    ├── vite-env.d.ts
    ├── core/                    # DOMINIO PURO. Sin React, sin DOM, sin node:*
    │   ├── index.ts             # export createCuadra + tipos públicos (la única entrada que usa la UI)
    │   ├── ports.ts             # SqlDriver, SqlExecutor, Clock, IdGen  (el puerto vive en el núcleo)
    │   ├── types.ts             # tipos de dominio
    │   ├── errors.ts            # DomainError + códigos
    │   ├── result.ts            # Result<T,E>
    │   ├── money.ts             # Money: parse/format/sum/allocate sin flotantes
    │   ├── dates.ts             # IsoDate, periodos relativos, rangos (date-fns)
    │   ├── ids.ts               # uuidv7 + IdGen por defecto
    │   ├── text.ts              # normalizeSearch (minúsculas, sin tildes)
    │   ├── events.ts            # ChangeEvent, EventBus
    │   ├── uow.ts               # unidad de trabajo: transacción + auditoría + eventos
    │   ├── recipes.ts           # TxFilter, GroupBy, ViewRecipe (v1) + validación/resolución
    │   ├── sql/                 # SQL compartido (fragmentos y compilador de filtros)
    │   │   ├── filter.ts        # compileFilter(TxFilter) → { where, params }
    │   │   └── rows.ts          # mapeo fila SQL ↔ tipo de dominio
    │   ├── services/            # un archivo por servicio; cada uno exporta createXService(deps)
    │   │   ├── workspaces.ts
    │   │   ├── accounts.ts
    │   │   ├── transactions.ts  # create/update/void/restore/duplicate/transfer/opening/createMany
    │   │   ├── batches.ts       # captura en tabla, total de control, anular lote
    │   │   ├── validation.ts    # validaciones duras y suaves
    │   │   ├── fields.ts        # campos y opciones (desactivar, fusionar)
    │   │   ├── queries.ts       # listado, totales, saldos, resumen, inicio
    │   │   ├── reports.ts       # informe resumido/detallado → ReportDocument
    │   │   ├── views.ts         # vistas guardadas (filtros, resúmenes, informes)
    │   │   ├── audit.ts         # AuditWriter (interno) + lectura
    │   │   ├── settings.ts
    │   │   ├── templates.ts     # aplicar plantilla JSON
    │   │   ├── backup.ts        # export/import JSON versionado
    │   │   └── importCsv.ts     # mapeo, vista previa, confirmación
    │   ├── export/              # tablas neutras para CSV/XLSX a partir de ReportDocument
    │   │   └── tabular.ts
    │   └── demo/                # generador determinista de datos de ejemplo
    │       ├── prng.ts
    │       ├── colmado.ts
    │       ├── despacho.ts
    │       └── seed.ts
    ├── data/                    # ADAPTADORES del puerto + esquema
    │   ├── index.ts             # openDatabase(): elige adaptador, migra, devuelve SqlDriver
    │   ├── migrate.ts           # runner de migraciones
    │   ├── migrations/
    │   │   ├── index.ts         # [{ version: 1, name: 'init', sql }] (import '?raw')
    │   │   └── 001_init.sql
    │   ├── mutex.ts             # serializa llamadas y transacciones sobre una conexión
    │   ├── serialDriver.ts      # SqlDriver común: mutex + BEGIN IMMEDIATE/COMMIT/ROLLBACK + errores
    │   ├── errors.ts            # SqlError, DataError (fallos del adaptador), RAISE → DomainError
    │   ├── sha256.ts            # checksum de migraciones en JS puro (crypto.subtle no existe en http://ip-lan)
    │   ├── wasm/
    │   │   ├── db.worker.ts     # sqlite-wasm + opfs-sahpool / :memory:+IDB
    │   │   ├── wasmDriver.ts    # SqlDriver sobre postMessage con ids
    │   │   ├── protocol.ts      # mensajes worker ↔ cliente
    │   │   ├── workerHost.ts    # lógica del worker (probable en Node con MessageChannel)
    │   │   ├── tabLock.ts       # navigator.locks + BroadcastChannel ("usar aquí")
    │   │   └── idbStore.ts      # get/put de bytes en IndexedDB (respaldo y copias automáticas)
    │   ├── node/
    │   │   └── nodeDriver.ts    # node:sqlite DatabaseSync envuelto en Promise (SOLO pruebas)
    │   └── tauri/
    │       └── tauriDriver.ts   # invoke('db_*')
    ├── templates/               # DATOS, no código
    │   ├── schema.ts            # tipo TemplateFile + validador
    │   ├── index.ts             # import.meta.glob('./*.json', { eager: true })
    │   ├── negocio.json
    │   ├── personal.json
    │   ├── despacho.json
    │   ├── organizacion.json
    │   └── blanco.json
    ├── app/                     # SHELL
    │   ├── App.tsx              # providers + RouterProvider
    │   ├── boot.ts              # openDatabase → createCuadra → estado de arranque
    │   ├── router.tsx           # createHashRouter a partir del registro
    │   ├── shell/               # privado del shell: BootView (carga, «abierta en otra pestaña», cedida,
    │   │                        # error), AppShell (+ avisos de solo-memoria y versión nueva), BottomTabs,
    │   │                        # Sidebar, Fab, ToastHost, NotFound, WorkspaceStatus, bootInfo
    │   ├── registry/            # PÚBLICO para features
    │   │   ├── types.ts         # FeatureModule, FeatureRoute, NavEntry, QuickAction, HomeCardDef...
    │   │   ├── collect.ts       # import.meta.glob('../../features/*/index.ts', { eager: true })
    │   │   └── hooks.ts         # useNav(), useQuickActions(), useHomeCards(), useSettingsSections()
    │   ├── data/                # PÚBLICO para features
    │   │   ├── CuadraProvider.tsx
    │   │   ├── queryClient.ts
    │   │   ├── useCuadraQuery.ts
    │   │   ├── useCuadraMutation.ts
    │   │   └── hooks.ts         # useWorkspace, useAccounts, useFields, useBalances, useSetting...
    │   └── state/
    │       └── uiStore.ts       # zustand: tema, hoja abierta, borradores; PÚBLICO (solo lectura de tipos)
    ├── ui/                      # SISTEMA DE DISEÑO
    │   ├── tokens.css           # variables CSS (DESIGN.md)
    │   ├── base.css             # reset, tipografía, utilidades mínimas
    │   ├── index.ts
    │   ├── primitives/          # Button, IconButton, Card, Sheet, Dialog, Segmented, Chip, Input,
    │   │                        # Select (con "+ Crear …"), Switch, DateField, Toast, EmptyState,
    │   │                        # Skeleton, ListRow (acciones al deslizar), InfoTip, Banner, Stack
    │   ├── domain/              # presentacionales con tipos del núcleo: MoneyText, AmountKeypad,
    │   │                        # KindBadge, AccountChip, FieldInput, FilterChips, PeriodPicker
    │   └── charts/              # SVG a mano: Bars, Donut, Line, Sparkline (+ uPlot opcional)
    ├── i18n/
    │   ├── index.ts             # t(), useT(ns), tipos de claves
    │   ├── format.ts            # formatMoney, formatDate, formatRelativeDay, formatPeriod
    │   └── es/
    │       ├── index.ts         # import.meta.glob('./*.ts', { eager: true }) → diccionario
    │       ├── common.ts        # dueño: shell
    │       ├── errors.ts        # mensajes de DomainError y avisos (dueño: núcleo)
    │       └── <feature>.ts     # uno por feature, dueño: esa feature
    ├── features/                # UNA CARPETA POR ÁREA. Cada una exporta `feature` desde index.ts
    │   ├── workspaces/          # P-01 elegir espacio, archivar
    │   ├── onboarding/          # P-02 aviso, plantilla, moneda, saldos iniciales, datos de ejemplo
    │   ├── home/                # P-03 inicio (pinta las HomeCards del registro)
    │   ├── accounts/            # P-04 lista de cuentas, orden, archivo
    │   ├── ledger/              # P-05 libro/movimientos, P-09 detalle + historial, filtros guardados
    │   ├── capture/             # P-06 formulario + teclado, P-07 tabla, P-08 transferencia
    │   ├── insights/            # P-10 resumen configurable con gráficas
    │   ├── reports/             # P-11 informes + exportación
    │   ├── audit/               # P-12 historial general
    │   ├── settings/            # P-13 configuración del espacio: campos, opciones, cuentas, vistas
    │   ├── import/              # P-18 importación CSV
    │   ├── backup/              # P-14 respaldo y restauración + P-15 ajustes de instalación
    │   └── _gallery/            # galería del sistema de diseño (#/_ui), solo en dev
    └── test/
        ├── setup.ts
        ├── harness.ts           # createTestCuadra(): node:sqlite :memory: + migrate + reloj fijo
        └── architecture.test.ts # verifica las reglas de dependencia (1.3)
```

Cada feature sigue la misma forma interna:

```
src/features/<x>/
├── index.ts          # SOLO el descriptor `feature` (rutas lazy, nav, acciones, tarjetas). Liviano.
├── routes/           # componentes de pantalla (cargados con lazy)
├── components/       # piezas privadas de la feature
├── hooks.ts          # hooks privados que componen app/data
└── <x>.css           # estilos propios, solo con tokens
```

### 1.2 Por qué el puerto vive en `src/core/ports.ts`

El encargo pedía el puerto en `src/data`. Lo pongo en el núcleo (inversión de dependencias): los servicios del núcleo dependen del puerto, y si el puerto estuviera en `data`, el núcleo importaría `data`. `src/data/index.ts` reexporta los tipos para quien los busque allí. Los adaptadores importan el tipo desde `core/ports`.

### 1.3 Reglas de dependencia

| Capa | Puede importar | No puede importar |
|---|---|---|
| `core/**` | `core/**`, `date-fns`, `papaparse` (solo en `importCsv.ts`), tipos de `templates/schema.ts` | React, DOM (`window`, `document`), `node:*`, `data/**`, `app/**`, `ui/**`, `features/**` |
| `data/**` | `core/ports`, `core/errors`, `@sqlite.org/sqlite-wasm`, `@tauri-apps/api` | `core/services/**`, `app/**`, `ui/**`, `features/**`. `data/node/**` no lo importa nada fuera de pruebas |
| `templates/**` | `core/types` (solo `import type`) | todo lo demás |
| `i18n/**` | `core/money`, `core/dates`, `core/types` | `app/**`, `features/**` |
| `ui/**` | `core/types`, `core/money`, `core/dates` (puros), `i18n/**`, `lucide-react`, `motion` | `core/services/**`, `core/index` (fachada), `app/**`, `features/**`, `data/**` |
| `app/registry`, `app/data`, `app/state` | `core/index`, `ui/**`, `i18n/**`, `@tanstack/react-query`, `zustand` | `features/**`, `app/shell/**` |
| `app/shell`, `app/router`, `app/App`, `app/boot` | todo lo de arriba + `data/index` | `features/<x>/**` salvo `features/*/index.ts` vía `collect.ts` |
| `features/<x>/**` | `core/index` y módulos puros de `core`, `ui/**`, `i18n/**`, `app/registry`, `app/data`, `app/state` | **otras features**, `app/shell/**`, `data/**`, `core/services/**` directo |

Reglas adicionales:

- La UI nunca escribe SQL ni llama al driver: todo pasa por la fachada `Cuadra`.
- Lo que dos features necesitan compartir se sube a `ui/domain` (si es presentacional) o a `app/data/hooks.ts` (si consulta datos). Nunca se importa de la feature vecina.
- `src/test/architecture.test.ts` recorre los archivos con expresiones regulares de `import` y falla si se viola la tabla. Es barato y evita que la base se degrade con los cambios.

---

## 2. Esquema SQLite (migración 001)

### 2.1 Decisiones del esquema

- **Ids:** `TEXT` con UUIDv7 (orden temporal, mejor localidad en índices, se exporta/importa sin choques). Generados en el núcleo (`IdGen`), nunca por SQLite.
- **Fechas:** `date` como `TEXT 'YYYY-MM-DD'` (sin hora ni zona). Marcas del sistema (`recorded_at`, `updated_at`, `at`) como `TEXT` ISO-8601 UTC con milisegundos (`2026-11-26T23:59:01.123Z`).
- **Dinero:** `amount_minor INTEGER ≥ 0` + `direction 'in'|'out'`. El encargo decía "entero positivo"; uso `≥ 0` porque la especificación (F-48) pide **avisar** del monto cero, no bloquearlo. La validación suave lo marca.
- **Tablas `STRICT`** y `CHECK` en todo lo enumerable; `PRAGMA foreign_keys = ON` lo activa cada adaptador al abrir (no se puede dentro de una transacción).
- **Nada se borra desde el programa:** triggers que abortan `DELETE` en `workspaces`, `accounts`, `transactions`, `batches`, `audit_log`, `audit_log_changes`, y `UPDATE` en el historial. El único escape es el **modo mantenimiento** (fila `sys.maintenance` en `settings`), que solo activan la restauración completa de un respaldo y el borrado definitivo de un espacio, dentro de su propia transacción. Es honestidad contra errores, no contra fraude (F-59).
- **`seq` por cuenta sin huecos ni reutilización:** `accounts.next_seq` se reserva con `UPDATE … RETURNING` en la misma transacción que el `INSERT`; un trigger rechaza cualquier `seq` que no sea el recién reservado y otro impide que `next_seq` baje. Como nunca se borra un movimiento y **la cuenta de un movimiento no se puede cambiar** (ver ADR-5), no hay huecos.
- **Valores de campos personalizables: EAV tipado** (`transaction_field_values` con una columna por tipo), no una columna JSON. Justificación:
  1. **Integridad:** `value_option_id` tiene FK a `field_options`. Renombrar una opción no toca movimientos; fusionar es un `UPDATE` de una columna indexada.
  2. **"¿Se usó alguna vez?"** (F-30) lo responde el propio motor: la FK impide borrar un campo u opción con valores, incluidos los de anulados.
  3. **Selección única** (F-33) la garantiza la clave primaria `(transaction_id, field_id)`.
  4. **Agrupar y filtrar** por cualquier campo es un `LEFT JOIN` con índice `(field_id, value_option_id)`; con JSON sería `json_extract` sin índice útil por campo dinámico.
  5. **Tipos correctos** por columna (`REAL`, `INTEGER 0/1`, fecha ISO) con `CHECK` de "exactamente un valor".
  El coste (una fila por valor, joins) es irrelevante con decenas de miles de movimientos.
- **Campos de tipo número** se guardan en `REAL`: son cantidades (unidades, kilómetros), no dinero. El dinero solo vive en `amount_minor`. Si un día hace falta un campo "monto", se añade el tipo `money` con `INTEGER`.
- **Búsqueda de texto:** columna `search_text` normalizada (minúsculas, sin tildes, descripción + notas) que mantiene el núcleo; `LIKE` sobre ella. "cafe" encuentra "Café". FTS5 queda para después.

### 2.2 DDL completo

```sql
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
```

`fields`, `field_options` y `transaction_field_values` sí admiten `DELETE`: borrar un campo nunca usado (F-30) es legal y la FK lo impide si hay valores; vaciar un valor es una edición auditada.

### 2.3 Consultas canónicas (referencia para `core/services`)

```sql
-- Saldo por cuenta (activos; incluye saldo inicial y transferencias)
SELECT account_id,
       SUM(CASE direction WHEN 'in' THEN amount_minor ELSE -amount_minor END) AS balance_minor
FROM transactions
WHERE workspace_id = ?1 AND status = 'active' AND (?2 IS NULL OR date <= ?2)
GROUP BY account_id;

-- Totales del espacio: transferencias y saldos iniciales fuera de entradas/salidas
SELECT
  SUM(CASE WHEN kind = 'income'  THEN amount_minor ELSE 0 END) AS in_minor,
  SUM(CASE WHEN kind = 'expense' THEN amount_minor ELSE 0 END) AS out_minor,
  SUM(CASE WHEN kind = 'transfer' AND direction = 'in'  THEN amount_minor ELSE 0 END) AS transfers_in_minor,
  SUM(CASE WHEN kind = 'transfer' AND direction = 'out' THEN amount_minor ELSE 0 END) AS transfers_out_minor,
  SUM(CASE WHEN kind = 'opening' THEN CASE direction WHEN 'in' THEN amount_minor ELSE -amount_minor END ELSE 0 END) AS openings_minor,
  COUNT(*) AS count
FROM transactions t
WHERE t.workspace_id = ?1 AND t.status = 'active' /* AND <filtro compilado> */;

-- Agrupar por un campo de lista (incluye "Sin valor")
SELECT o.id AS key, o.label, o.color,
       SUM(CASE WHEN t.kind = 'income'  THEN t.amount_minor ELSE 0 END) AS in_minor,
       SUM(CASE WHEN t.kind = 'expense' THEN t.amount_minor ELSE 0 END) AS out_minor,
       COUNT(*) AS count
FROM transactions t
LEFT JOIN transaction_field_values v ON v.transaction_id = t.id AND v.field_id = ?2
LEFT JOIN field_options o ON o.id = v.value_option_id
WHERE t.workspace_id = ?1 AND t.status = 'active' AND t.kind IN ('income', 'expense')
GROUP BY o.id;

-- Saldo corrido para el listado de una cuenta (respeta orden fecha, seq)
SELECT t.*, SUM(CASE WHEN t.status = 'active' THEN CASE t.direction WHEN 'in' THEN t.amount_minor ELSE -t.amount_minor END ELSE 0 END)
       OVER (ORDER BY t.date, t.seq ROWS UNBOUNDED PRECEDING) AS running_minor
FROM transactions t WHERE t.account_id = ?1;
-- El saldo corrido se calcula sobre TODA la cuenta y luego se filtra en una consulta exterior,
-- para que siga cuadrando con el saldo real aunque haya filtros.
```

---

## 3. API pública del núcleo

### 3.1 Puerto `SqlDriver` e inyección

```ts
// src/core/ports.ts
export type SqlValue = string | number | null | Uint8Array;
export type SqlParams = readonly SqlValue[] | Readonly<Record<string, SqlValue>>;
export type Row = Record<string, SqlValue>;

/** Lo mínimo para ejecutar SQL. Dentro de una transacción se recibe uno de estos. */
export interface SqlExecutor {
  all<T extends Row = Row>(sql: string, params?: SqlParams): Promise<T[]>;
  get<T extends Row = Row>(sql: string, params?: SqlParams): Promise<T | undefined>;
  run(sql: string, params?: SqlParams): Promise<{ changes: number }>;
  /** Mismo SQL con muchas filas de parámetros, en una sola ida al worker. */
  runMany(sql: string, rows: readonly SqlParams[]): Promise<{ changes: number }>;
}

export interface SqlDriverInfo {
  kind: 'wasm-opfs' | 'wasm-memory-idb' | 'node' | 'tauri';
  persistent: boolean;          // OPFS/archivo nativo: true; :memory:+IDB: true con riesgo; :memory: puro: false
  sqliteVersion: string;
}

export interface SqlDriver extends SqlExecutor {
  readonly info: SqlDriverInfo;
  /** Varias sentencias sin parámetros (migraciones). */
  exec(sql: string): Promise<void>;
  /**
   * BEGIN IMMEDIATE … COMMIT, o ROLLBACK si fn lanza. Todas las llamadas de fn van por `tx`.
   * Las llamadas al driver desde fuera esperan (mutex). Anidar: `tx` no tiene transaction();
   * los servicios componen pasando `tx` (ver uow.ts).
   */
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  /** Archivo SQLite completo (copias automáticas antes de migrar/restaurar). */
  exportBytes(): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface Clock {
  now(): Date;                 // marcas del sistema
  today(): IsoDate;            // fecha local del usuario (no UTC)
}
export interface IdGen { next(): string }   // uuidv7
```

Reglas de los adaptadores:

- Al abrir: `PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL` (salvo OPFS: `TRUNCATE`; `:memory:`: `MEMORY`); `PRAGMA busy_timeout = 3000`. Comprobar `sqlite_version() >= '3.45'` o lanzar `DomainError('sqlite_too_old')`.
- Los errores `RAISE(ABORT, 'codigo')` llegan como texto; el adaptador los convierte en `DomainError(codigo)` si el mensaje coincide con un código conocido.
- Ningún adaptador interpreta ni reescribe el SQL.

Inyección:

```ts
// src/core/index.ts
export interface CuadraDeps {
  driver: SqlDriver;
  clock?: Clock;                 // por defecto: reloj del sistema
  ids?: IdGen;                   // por defecto: uuidv7 con crypto.getRandomValues
  locale?: string;               // 'es-DO'
  schemaVersion?: number;        // la da migrate() en boot/harness (el núcleo no ve src/data)
  appVersion?: string;           // se escribe en los respaldos; boot la toma de package.json (define de Vite)
  backupAutoCopy?: AutoCopySink; // copia previa a restaurar (boot: createRestoreCopySink() → IndexedDB);
                                 // sin él, la copia queda dentro de la propia base (sys.backup.autoCopy)
  pbkdf2Iterations?: number;     // contraseña local y respaldos cifrados; 600 000 por defecto, 1 000 en el arnés
}
export function createCuadra(deps: CuadraDeps): Cuadra;

export interface Cuadra {
  readonly workspaces: WorkspacesService;
  readonly accounts: AccountsService;
  readonly transactions: TransactionsService;
  readonly batches: BatchesService;
  readonly fields: FieldsService;
  readonly queries: QueriesService;
  readonly reports: ReportsService;
  readonly views: ViewsService;
  readonly audit: AuditService;
  readonly auth: AuthService;          // inicio de sesión local (3.5, "Inicio de sesión")
  readonly settings: SettingsService;
  readonly templates: TemplatesService;
  readonly backup: BackupService;
  readonly importCsv: ImportCsvService;  // CSV y Excel (.xlsx): el nombre se conserva por compatibilidad
  readonly demo: DemoService;
  /** Se emite tras cada COMMIT con las tablas tocadas. La UI invalida consultas con esto. */
  subscribe(listener: (e: ChangeEvent) => void): () => void;
  readonly info: { driver: SqlDriverInfo; schemaVersion: number };
}
```

```ts
// src/app/boot.ts (shell) — único sitio que conoce adaptadores. Corre fuera de React (main.tsx) para que
// StrictMode no pida el candado dos veces; informa por onState: loading | blocked(takeOver) | ready | released(reopen) | error.
const db = await openDatabase({ onBlocked, onReleaseRequested, onPersistError });  // src/data/index.ts → OpenedDatabase
const cuadra = createCuadra({ driver: db, locale: 'es-DO', schemaVersion: db.schema.to,
  appVersion: import.meta.env.VITE_APP_VERSION, backupAutoCopy: createRestoreCopySink() });
// <App cuadra info={{ storage: db.storage, schema: db.schema, … }}/> → <CuadraProvider> (una QueryClient por fachada)
```

```ts
// src/test/harness.ts
export async function createTestCuadra(opts?: { today?: IsoDate; seed?: number }): Promise<{
  cuadra: Cuadra; driver: SqlDriver; clock: FixedClock; ids: SeqIdGen;
}>;
// node:sqlite ':memory:' + migrate() + FixedClock('2026-06-15T12:00:00Z') + ids deterministas
// + pbkdf2Iterations: 1 000 (las pruebas de contraseña y respaldo cifrado van rápidas)
```

### 3.2 Tipos de dominio

```ts
// src/core/types.ts
export type Id = string;                     // uuidv7
export type IsoDate = string;                // 'YYYY-MM-DD'
export type Timestamp = string;              // ISO-8601 UTC
export type Minor = number;                  // entero seguro en unidad menor (puede ser negativo en saldos)

export type TxKind = 'income' | 'expense' | 'transfer' | 'opening';   // entrada | salida | transferencia | saldo inicial
export type Direction = 'in' | 'out';
export type TxStatus = 'active' | 'voided';
export type AccountType = 'cash' | 'bank' | 'card' | 'savings' | 'wallet' | 'other';
export type FieldType = 'text' | 'number' | 'date' | 'list' | 'bool';
export type FieldRole = 'category' | 'contact' | 'fund' | 'cost_center' | 'payment_method' | 'reference' | 'reconciled';
export type AppliesTo = 'both' | 'in' | 'out';

export interface Currency { code: string; minorDigits: 0 | 2 | 3; symbol?: string }

export interface Workspace {
  id: Id; name: string; ownerName: string; templateId: string | null;
  currency: Currency; logoDataUrl: string | null; color: string | null;
  sortOrder: number; isDemo: boolean; archivedAt: Timestamp | null;
  createdAt: Timestamp; updatedAt: Timestamp;
}
export interface WorkspaceSummary extends Workspace {
  balanceMinor: Minor; accountCount: number; lastMovementDate: IsoDate | null;
}

export interface Account {
  id: Id; workspaceId: Id; name: string; type: AccountType;
  color: string | null; icon: string | null; sortOrder: number;
  archivedAt: Timestamp | null; createdAt: Timestamp; updatedAt: Timestamp;
}
export interface AccountWithBalance extends Account {
  balanceMinor: Minor; lastMovementDate: IsoDate | null; isNegative: boolean;
  openingTransactionId: Id | null;
}

export type FieldValue =
  | { type: 'text'; value: string }
  | { type: 'number'; value: number }
  | { type: 'date'; value: IsoDate }
  | { type: 'list'; optionId: Id }
  | { type: 'bool'; value: boolean };
export type FieldValues = Record<Id /* fieldId */, FieldValue>;

export interface Transaction {
  id: Id; workspaceId: Id; accountId: Id; seq: number;
  kind: TxKind; direction: Direction; amountMinor: Minor;
  date: IsoDate; description: string; notes: string;
  status: TxStatus; voidReason: string | null; voidedAt: Timestamp | null;
  batchId: Id | null; transferGroupId: Id | null;
  /** Solo en transferencias: la cuenta del otro lado y el id del otro movimiento. */
  counterpart: { accountId: Id; transactionId: Id; seq: number } | null;
  recordedAt: Timestamp; updatedAt: Timestamp;
  values: FieldValues;
}
/** Fila de listado: añade saldo corrido cuando el listado es de una sola cuenta. */
export interface TransactionRow extends Transaction { runningMinor: Minor | null }

export interface Field {
  id: Id; workspaceId: Id; key: string; label: string; type: FieldType;
  role: FieldRole | null; appliesTo: AppliesTo; sortOrder: number;
  showInList: boolean; active: boolean; deactivatedAt: Timestamp | null;
  options: FieldOption[];          // solo type 'list'; ordenadas; incluye inactivas
}
export interface FieldOption {
  id: Id; fieldId: Id; key: string | null; label: string; color: string | null;
  appliesTo: AppliesTo; sortOrder: number; active: boolean; mergedIntoId: Id | null;
}

export interface Batch {
  id: Id; workspaceId: Id; accountId: Id | null; source: 'capture' | 'import' | 'template' | 'demo';
  label: string; controlTotalMinor: Minor | null; controlMismatchAccepted: boolean;
  createdAt: Timestamp; activeCount: number; voidedCount: number;
}

export type Warning =
  | { code: 'zero_amount' }
  | { code: 'far_date'; days: number }
  | { code: 'possible_duplicate'; transactionId: Id; seq: number }
  | { code: 'before_opening'; openingDate: IsoDate }
  | { code: 'negative_balance'; accountId: Id; balanceAfterMinor: Minor }
  | { code: 'field_inactive'; fieldId: Id }
  | { code: 'field_missing'; fieldKeyOrId: string }
  | { code: 'option_inactive'; fieldId: Id; optionId: Id };

/** Resultado de toda mutación: lo creado/cambiado + avisos que no bloquearon. */
export interface Mutation<T> { value: T; warnings: Warning[]; auditActionId: Id | null }
```

```ts
// src/core/errors.ts
export type ErrorCode =
  | 'not_found' | 'workspace_archived' | 'account_archived' | 'workspace_mismatch'
  | 'invalid_amount' | 'invalid_date' | 'description_required'
  | 'opening_exists' | 'transfer_same_account' | 'transfer_requires_both_sides'
  | 'kind_change_forbidden' | 'account_change_forbidden'
  | 'already_voided' | 'not_voided'
  | 'field_inactive' | 'option_inactive' | 'field_in_use' | 'option_in_use'
  | 'field_type_immutable' | 'field_value_type_mismatch' | 'duplicate_label' | 'merge_same_option'
  | 'control_total_mismatch' | 'batch_empty'
  | 'backup_invalid' | 'backup_checksum' | 'backup_from_newer_version'
  | 'db_from_newer_version' | 'migration_failed' | 'migration_checksum'
  | 'currency_locked' | 'confirmation_mismatch' | 'sqlite_too_old'
  | 'seq_not_reserved' | 'immutable_column' | 'delete_forbidden' | 'audit_append_only'
  | 'seq_decrease' | 'options_require_list_field'   // los lanzan triggers de 001_init.sql
  | 'invalid_recipe'                                // receta de vista o de plantilla inválida
  // Oleada 2: estructura, ajustes y plantillas
  | 'name_required' | 'template_invalid' | 'invalid_currency' | 'invalid_setting' | 'merge_different_field'
  // Oleada 2: respaldo cifrado e inicio de sesión local
  | 'password_required' | 'wrong_password' | 'wrong_recovery_key' | 'too_many_attempts'
  | 'auth_not_enabled' | 'auth_already_enabled' | 'auth_locked' | 'password_too_short' | 'password_too_long'
  | 'profile_name_required' | 'invalid_auto_lock' | 'crypto_unavailable';
// 'not_implemented' (stubs de la Oleada 1) ya no existe: todos los servicios están implementados.
// Cada código tiene texto en src/i18n/es/errors.ts (prueba en core/errors.test.ts).

export class DomainError extends Error {
  constructor(readonly code: ErrorCode, readonly details?: Record<string, unknown>) { super(code); }
}
```

### 3.3 Money (sin flotantes)

```ts
// src/core/money.ts
export const MAX_MINOR = Number.MAX_SAFE_INTEGER;

export type MoneyParseError =
  | 'empty' | 'not_a_number' | 'too_many_decimals' | 'negative_not_allowed' | 'too_large';

export interface MoneyParseOptions {
  locale: string;               // 'es-DO' → decimal '.', grupo ','; 'es-ES' → decimal ',', grupo '.'
  currency: Currency;
  allowNegative?: boolean;      // solo saldo inicial de tarjeta/deuda
}

export const Money: {
  /**
   * Texto del usuario → unidad menor. Separadores del locale vía Intl.NumberFormat#formatToParts.
   * Ignora símbolo, código y espacios ("RD$ 1,250.50"). Acepta '(' ')' o '-' como negativo.
   * Regla de ambigüedad: si el texto solo tiene el separador de GRUPO del locale y lo siguen 1–2 dígitos
   * finales ("12.5" en es-ES), se interpreta como decimal (lo que la gente teclea en el móvil).
   * Nunca usa parseFloat: separa parte entera y fracción como strings y compone con enteros.
   */
  parse(input: string, opts: MoneyParseOptions): Result<Minor, MoneyParseError>;
  /** Teclado propio: "150+75.50-25" → 20050. Solo + y -, sin precedencias ni paréntesis. */
  parseExpression(input: string, opts: MoneyParseOptions): Result<Minor, MoneyParseError>;
  /** Intl.NumberFormat con style 'currency' y minimumFractionDigits = minorDigits.
   *  El valor se pasa como string decimal ("1234.50"), nunca como división flotante. */
  format(minor: Minor, opts: {
    locale: string; currency: Currency;
    display?: 'symbol' | 'code' | 'none';
    sign?: 'auto' | 'always' | 'never';
    compact?: boolean;                 // "RD$12.5 mil" para tarjetas
  }): string;
  /** "123450" con 2 dígitos → "1234.50". Canónico para CSV/respaldo. */
  toDecimalString(minor: Minor, minorDigits: number): string;
  fromDecimalString(s: string, minorDigits: number): Result<Minor, MoneyParseError>;
  add(a: Minor, b: Minor): Minor;              // lanza RangeError si sale de safe integer
  sub(a: Minor, b: Minor): Minor;
  sum(values: Iterable<Minor>): Minor;
  signed(amount: Minor, direction: Direction): Minor;
  /** Reparto sin perder centavos (patrón dinero.js): el resto va a los primeros. */
  allocate(total: Minor, ratios: readonly number[]): Minor[];
  isValidAmount(n: unknown): n is Minor;       // entero, 0 ≤ n ≤ MAX_MINOR
};

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };  // core/result.ts
```

### 3.4 Recetas: filtros, agrupaciones y vistas guardadas

```ts
// src/core/recipes.ts
export type PeriodPreset =
  | 'today' | 'this_week' | 'this_month' | 'last_month' | 'this_quarter' | 'last_quarter'
  | 'this_year' | 'last_year' | 'last_30_days' | 'last_12_months' | 'all';
export type DateRange = { preset: PeriodPreset } | { from?: IsoDate; to?: IsoDate };   // to inclusive

export type FieldCondition =
  | { fieldId: Id; op: 'any_of'; optionIds: Id[] }           // lista (OR dentro del campo)
  | { fieldId: Id; op: 'empty' }
  | { fieldId: Id; op: 'not_empty' }
  | { fieldId: Id; op: 'is'; value: boolean }                 // sí/no: sin valor = No (F-65)
  | { fieldId: Id; op: 'contains'; value: string }            // texto
  | { fieldId: Id; op: 'between'; min?: number; max?: number }// número
  | { fieldId: Id; op: 'date_between'; from?: IsoDate; to?: IsoDate };

/** Todos los criterios se combinan con AND (F-62, 8.3). */
export interface TxFilter {
  period?: DateRange;
  accountIds?: Id[];
  kinds?: TxKind[];
  amount?: { min?: Minor; max?: Minor };
  text?: string;                         // descripción + notas, normalizado
  status?: 'active' | 'voided' | 'all';  // por defecto 'active'
  batchId?: Id;
  fields?: FieldCondition[];
}

export type GroupBy =
  | { by: 'period'; unit: 'day' | 'week' | 'month' | 'quarter' | 'year' }
  | { by: 'account' }
  | { by: 'kind' }
  | { by: 'field'; fieldId: Id };        // cualquier campo: lista, sí/no, texto, fecha (por mes)

export type ViewRecipe =
  | { v: 1; kind: 'filter'; filter: TxFilter; columns?: Id[]; sort?: TxSort }
  | { v: 1; kind: 'summary'; filter: TxFilter; groupBy: GroupBy; split?: GroupBy;
      measure: 'in' | 'out' | 'both' | 'net'; chart: 'bars' | 'donut' | 'line' | 'table' }
  | { v: 1; kind: 'report'; form: 'summary' | 'detailed' | 'custom'; filter: TxFilter;
      sections: ReportSection[]; groupByFieldIds: Id[]; columns: Id[]; includeVoided: boolean;
      signature: boolean };

export type ReportSection = 'header' | 'statement' | 'by_account' | 'by_field' | 'transfers'
  | 'movements' | 'voided' | 'audit' | 'signature';

export type TxSort = { by: 'date' | 'amount' | 'recorded_at' | 'seq'; dir: 'asc' | 'desc' };

export function resolvePeriod(range: DateRange | undefined, clock: Clock): { from: IsoDate | null; to: IsoDate | null; label: string };
/** Revisa una receta contra los campos actuales: avisa de campos inactivos, quita los inexistentes. */
export function validateRecipe<R extends ViewRecipe>(recipe: R, fields: Field[]): { recipe: R; warnings: Warning[] };
/** Plantillas referencian claves ('categoria', 'categoria.ventas'); en la BD se guardan ids. */
export function resolveTemplateRecipe(recipe: unknown, keyMap: TemplateKeyMap): ViewRecipe;
export function describeFilter(filter: TxFilter, ctx: { fields: Field[]; accounts: Account[] }): string[]; // "Cuenta: Caja", ...

// src/core/sql/filter.ts
export function compileFilter(filter: TxFilter, ctx: { workspaceId: Id; clock: Clock; alias?: string }):
  { where: string; params: Record<string, SqlValue> };   // params con nombre :f0, :f1...
```

### 3.5 Servicios

```ts
// ── Espacios ───────────────────────────────────────────────────────────
export interface WorkspacesService {
  list(opts?: { includeArchived?: boolean }): Promise<WorkspaceSummary[]>;
  get(id: Id): Promise<Workspace>;
  create(input: { name: string; ownerName?: string; currency?: Currency; color?: string }): Promise<Mutation<Workspace>>;
  update(id: Id, patch: Partial<Pick<Workspace, 'name' | 'ownerName' | 'logoDataUrl' | 'color'>> & {
    currency?: Currency;    // minorDigits solo cambia si no hay movimientos → 'currency_locked'
  }): Promise<Mutation<Workspace>>;
  reorder(ids: Id[]): Promise<void>;
  archive(id: Id): Promise<Mutation<Workspace>>;
  unarchive(id: Id): Promise<Mutation<Workspace>>;
  /** F-03: exige escribir el nombre exacto; el llamador hace antes una copia automática. */
  purge(id: Id, confirmName: string): Promise<void>;
}

// ── Cuentas ────────────────────────────────────────────────────────────
export interface OpeningInput { amountMinor: Minor; direction: Direction; date: IsoDate }
export interface AccountsService {
  list(workspaceId: Id, opts?: { includeArchived?: boolean; asOf?: IsoDate }): Promise<AccountWithBalance[]>;
  get(id: Id): Promise<AccountWithBalance>;
  create(input: { workspaceId: Id; name: string; type?: AccountType; color?: string; icon?: string;
                  opening?: OpeningInput }): Promise<Mutation<Account>>;   // opening con 0 → no se crea
  update(id: Id, patch: Partial<Pick<Account, 'name' | 'type' | 'color' | 'icon'>>): Promise<Mutation<Account>>;
  reorder(workspaceId: Id, ids: Id[]): Promise<void>;
  archive(id: Id): Promise<Mutation<Account>>;       // conserva movimientos; rechaza nuevos
  unarchive(id: Id): Promise<Mutation<Account>>;
}

// ── Movimientos ────────────────────────────────────────────────────────
export interface TxDraft {
  accountId: Id;
  kind: 'income' | 'expense';
  amountMinor: Minor;
  date: IsoDate;
  description: string;
  notes?: string;
  values?: FieldValues;
}
export interface TransferDraft {
  fromAccountId: Id; toAccountId: Id; amountMinor: Minor; date: IsoDate;
  description: string; notes?: string; values?: FieldValues;
}
export type TxPatch = Partial<Pick<TxDraft, 'kind' | 'amountMinor' | 'date' | 'description' | 'notes'>> & {
  values?: Record<Id, FieldValue | null>;   // null = vaciar
};

export interface TransactionsService {
  get(id: Id): Promise<Transaction>;
  /** Avisos suaves sin guardar (el formulario los muestra mientras se escribe). */
  check(workspaceId: Id, draft: TxDraft | TransferDraft, opts?: { editingId?: Id }): Promise<Warning[]>;
  create(draft: TxDraft): Promise<Mutation<Transaction>>;
  createTransfer(draft: TransferDraft): Promise<Mutation<{ out: Transaction; in: Transaction }>>;
  /** Crea o edita el único saldo inicial de la cuenta. */
  setOpening(accountId: Id, input: OpeningInput): Promise<Mutation<Transaction>>;
  /** En transferencias aplica a los dos lados (monto, fecha, descripción, notas, valores). */
  update(id: Id, patch: TxPatch): Promise<Mutation<Transaction>>;
  /** 'account_change_forbidden': para mover de cuenta, la UI ofrece "anular y registrar en otra". */
  void(id: Id, reason?: string): Promise<Mutation<Transaction>>;
  restore(id: Id): Promise<Mutation<Transaction>>;
  /** Devuelve un borrador (no guarda, no consume seq) con fecha de hoy y los mismos valores activos. */
  duplicate(id: Id, opts?: { date?: IsoDate }): Promise<TxDraft | TransferDraft>;
  history(id: Id): Promise<AuditEntry[]>;     // incluye el otro lado si es transferencia
  suggestDescriptions(workspaceId: Id, prefix: string, opts?: { kind?: TxKind; limit?: number }):
    Promise<Array<{ description: string; uses: number; lastValues: FieldValues }>>;
  /** Interno-público: inserción masiva en UNA transacción SQL y UNA acción de historial.
   *  Lo usan batches, importCsv y demo. */
  createMany(input: {
    workspaceId: Id;
    batch: { source: Batch['source']; accountId: Id | null; label: string;
             controlTotalMinor?: Minor | null; controlMismatchAccepted?: boolean; meta?: unknown };
    drafts: Array<TxDraft | (TransferDraft & { kind: 'transfer' }) | ({ kind: 'opening'; accountId: Id } & OpeningInput & { description?: string })>;
    voids?: Array<{ index: number; reason: string }>;   // demo: anulados creíbles
    audit: { action: 'batch_create' | 'import' | 'demo_seed'; message: string; params?: unknown };
  }): Promise<Mutation<{ batchId: Id; ids: Id[] }>>;
}

// ── Lotes y captura rápida ─────────────────────────────────────────────
export interface CaptureRow { amount: string | Minor; description: string; notes?: string; values?: FieldValues; date?: IsoDate }
export interface CaptureInput {
  workspaceId: Id; accountId: Id; kind: 'income' | 'expense'; date: IsoDate;
  rows: CaptureRow[]; controlTotalMinor?: Minor | null; acceptControlMismatch?: boolean; label?: string;
}
export type CaptureResult =
  | { status: 'saved'; batchId: Id; savedRowIndexes: number[];
      rowErrors: Array<{ index: number; error: ErrorCode | MoneyParseError }>; warnings: Array<{ index: number; warnings: Warning[] }> }
  | { status: 'control_mismatch'; sumMinor: Minor; controlTotalMinor: Minor; differenceMinor: Minor }  // nada guardado
  | { status: 'nothing_to_save'; rowErrors: Array<{ index: number; error: ErrorCode | MoneyParseError }> };

export interface BatchesService {
  /** F-44/45/46: valida por fila; filas vacías se ignoran; total de control sobre filas válidas. */
  capture(input: CaptureInput): Promise<CaptureResult>;
  /** Calcula suma/diferencia sin guardar (para el pie de la tabla en vivo). */
  previewCapture(input: CaptureInput): Promise<{ sumMinor: Minor; differenceMinor: Minor | null;
    rowErrors: Array<{ index: number; error: string }>; validCount: number }>;
  list(workspaceId: Id, opts?: { source?: Batch['source']; limit?: number }): Promise<Batch[]>;
  get(id: Id): Promise<Batch>;
  /** Anula todos los activos del lote (marca voided_with_batch=1). Una sola acción de historial. */
  void(id: Id, reason?: string): Promise<Mutation<{ voidedCount: number }>>;
  /** Restaura solo los que anuló el lote, no los anulados a mano antes. */
  restore(id: Id): Promise<Mutation<{ restoredCount: number }>>;
}

// ── Campos y opciones ──────────────────────────────────────────────────
export interface FormSchema {        // F-25: lo que el formulario pinta, ya ordenado
  fields: Array<Field & { options: FieldOption[] /* solo activas y aplicables al tipo */ }>;
}
export interface FieldsService {
  list(workspaceId: Id, opts?: { includeInactive?: boolean }): Promise<Field[]>;
  formSchema(workspaceId: Id, kind: 'income' | 'expense' | 'transfer'): Promise<FormSchema>;
  /** Campos disponibles para filtrar/agrupar: incluye inactivos (marcados) para lo histórico. */
  dimensions(workspaceId: Id): Promise<Array<Field & { groupable: boolean; filterable: boolean }>>;
  create(input: { workspaceId: Id; label: string; type: FieldType; key?: string; role?: FieldRole;
                  appliesTo?: AppliesTo; showInList?: boolean;
                  options?: Array<{ label: string; color?: string; appliesTo?: AppliesTo }> }): Promise<Mutation<Field>>;
  /** El tipo NO está en el parche (F-31). */
  update(id: Id, patch: Partial<Pick<Field, 'label' | 'role' | 'appliesTo' | 'showInList'>>): Promise<Mutation<Field>>;
  reorder(workspaceId: Id, ids: Id[]): Promise<void>;
  deactivate(id: Id): Promise<Mutation<Field>>;
  reactivate(id: Id): Promise<Mutation<Field>>;
  usage(id: Id): Promise<{ total: number; active: number; voided: number }>;
  /** Solo si usage.total === 0 (incluye anulados) → si no, 'field_in_use'. */
  delete(id: Id): Promise<void>;

  addOption(fieldId: Id, input: { label: string; color?: string; appliesTo?: AppliesTo }): Promise<Mutation<FieldOption>>;
  updateOption(optionId: Id, patch: Partial<Pick<FieldOption, 'label' | 'color' | 'appliesTo'>>): Promise<Mutation<FieldOption>>;
  reorderOptions(fieldId: Id, ids: Id[]): Promise<void>;
  deactivateOption(optionId: Id): Promise<Mutation<FieldOption>>;
  reactivateOption(optionId: Id): Promise<Mutation<FieldOption>>;
  deleteOption(optionId: Id): Promise<void>;          // solo nunca usada
  /** Opciones parecidas al escribir (F-35 resuelto como "punto medio"): sin tildes, distancia ≤ 2. */
  similarOptions(fieldId: Id, label: string): Promise<FieldOption[]>;
  /** F-36: mueve valores al destino, desactiva el origen con merged_into_id, una acción de historial. */
  mergeOptions(sourceId: Id, targetId: Id): Promise<Mutation<{ movedCount: number }>>;
}
```

**F-35 decidido:** el selector de lista permite "+ Crear «texto»" en el momento, pero antes muestra `similarOptions` ("¿Querías decir *Electricidad*?"). Rápido y sin duplicados; la fusión limpia lo que se escape.

```ts
// ── Consultas ──────────────────────────────────────────────────────────
export interface Totals {
  inMinor: Minor; outMinor: Minor; netMinor: Minor;           // solo income/expense
  transfersInMinor: Minor; transfersOutMinor: Minor;         // aparte (F-20)
  openingsMinor: Minor;                                       // aparte (F-18)
  count: number; voidedCount: number;
}
export interface Page<T> { items: T[]; nextCursor: string | null }

export interface SummaryGroup {
  key: string | null;           // id de opción/cuenta, 'YYYY-MM', 'true'/'false', null = "Sin valor"
  label: string; color: string | null; inactive: boolean;
  inMinor: Minor; outMinor: Minor; netMinor: Minor; count: number;
  split?: SummaryGroup[];       // segunda agrupación
}
export interface SummaryResult {
  groups: SummaryGroup[];       // periodos sin datos se rellenan con 0 dentro del rango
  totals: Totals;               // suma de grupos == totales (prueba)
  period: { from: IsoDate | null; to: IsoDate | null; label: string };
  filtered: boolean; filterDescription: string[]; warnings: Warning[];
}

export interface QueriesService {
  listTransactions(workspaceId: Id, input: { filter: TxFilter; sort?: TxSort; limit?: number; cursor?: string }):
    Promise<Page<TransactionRow> & { totals: Totals }>;          // totales del conjunto filtrado completo
  /** Agrupado por día con subtotal diario, para la lista móvil. */
  listByDay(workspaceId: Id, input: { filter: TxFilter; limit?: number; cursor?: string }):
    Promise<Page<{ date: IsoDate; inMinor: Minor; outMinor: Minor; items: TransactionRow[] }>>;
  totals(workspaceId: Id, filter: TxFilter): Promise<Totals>;
  balances(workspaceId: Id, opts?: { asOf?: IsoDate }): Promise<{ byAccount: Record<Id, Minor>; totalMinor: Minor }>;
  /** Serie de saldo diario/mensual (gráfica de línea). */
  balanceSeries(workspaceId: Id, input: { accountIds?: Id[]; period: DateRange; unit: 'day' | 'month' }):
    Promise<Array<{ key: string; balanceMinor: Minor }>>;
  summarize(workspaceId: Id, input: { filter: TxFilter; groupBy: GroupBy; split?: GroupBy }): Promise<SummaryResult>;
  /** P-03 en una llamada. */
  home(workspaceId: Id, input?: { month?: string /* 'YYYY-MM' */ }): Promise<{
    totalBalanceMinor: Minor; month: Totals; previousMonth: Totals;
    monthly: Array<{ key: string; inMinor: Minor; outMinor: Minor }>;   // últimos 12 meses
    negativeAccounts: AccountWithBalance[]; isEmpty: boolean;
    backup: { lastVerifiedAt: Timestamp | null; reminderDays: number; overdue: boolean };
  }>;
  /** Panel de escritorio completo en una llamada (4 sentencias en una transacción de lectura). */
  dashboard(workspaceId: Id, opts?: DashboardOptions): Promise<DashboardData>;
}
// DashboardOptions: { period?, months? (1–60, 12), seriesUnit? ('day'|'week'|'month'), breakdown?: GroupBy,
//   measure? ('in'|'out'|'net'), topLimit? (5), recentLimit? (8) }
// DashboardData: saldo y KPIs del periodo y del anterior, flujo mensual, series por cuenta, reparto con
//   comparación, top de categorías y contactos, attention { negativeAccounts, unbalancedBatches, backup },
//   recent. Tipos exactos en src/core/services/queries.ts; la fachada exporta además groupFilter() (clic en
//   una barra o categoría → TxFilter) y previousRange().

// ── Informes ───────────────────────────────────────────────────────────
export interface StatementLine {
  periodOpeningMinor: Minor;     // saldo al día anterior a `from` (todo lo activo antes)
  openingsInPeriodMinor: Minor;  // saldos iniciales fechados dentro del periodo (línea propia)
  inMinor: Minor; outMinor: Minor;
  transfersInMinor: Minor; transfersOutMinor: Minor;
  closingMinor: Minor;           // = suma de todo lo anterior con signo (identidad 10.3)
}
export interface ReportDocument {
  meta: { workspaceName: string; ownerName: string; logoDataUrl: string | null; currency: Currency;
          period: { from: IsoDate | null; to: IsoDate | null; label: string };
          generatedAt: Timestamp; form: 'summary' | 'detailed' | 'custom';
          filtered: boolean; filterDescription: string[]; warnings: Warning[]; includeVoided: boolean };
  statement: StatementLine;
  byAccount: Array<{ account: Account } & StatementLine>;
  byField: Array<{ field: Field; groups: SummaryGroup[] }>;
  transfers: Array<{ date: IsoDate; fromAccountId: Id; toAccountId: Id; amountMinor: Minor; description: string }>;
  movements: TransactionRow[] | null;     // detallado
  voided: TransactionRow[] | null;        // si includeVoided
  audit: AuditEntry[] | null;
  signature: boolean;
}
export interface ReportsService {
  build(workspaceId: Id, recipe: Extract<ViewRecipe, { kind: 'report' }>): Promise<ReportDocument>;
  /** Recetas listas: resumido y detallado (10.1). */
  preset(form: 'summary' | 'detailed', period: DateRange): Extract<ViewRecipe, { kind: 'report' }>;
}
// src/core/export/tabular.ts — sin DOM; la feature reports lo pasa a papaparse / write-excel-file
export interface Sheet { name: string; columns: Array<{ header: string; type: 'text' | 'date' | 'money' | 'integer'; width?: number }>;
  rows: Array<Array<string | number | null>> /* dinero en unidad menor; el escritor aplica formato */ }
export function reportToSheets(doc: ReportDocument, t: (key: string, p?: object) => string): Sheet[];
export function transactionsToSheet(rows: TransactionRow[], fields: Field[], ctx: { accounts: Account[]; currency: Currency }, t: Translate): Sheet;

// ── Vistas guardadas ───────────────────────────────────────────────────
export interface SavedView<K extends ViewRecipe['kind'] = ViewRecipe['kind']> {
  id: Id; workspaceId: Id; kind: K; name: string; recipe: Extract<ViewRecipe, { kind: K }>;
  pinned: boolean; sortOrder: number; source: 'user' | 'template'; warnings: Warning[];
}
export interface ViewsService {
  list<K extends ViewRecipe['kind']>(workspaceId: Id, kind: K): Promise<SavedView<K>[]>;
  get(id: Id): Promise<SavedView>;
  save(input: { workspaceId: Id; name: string; recipe: ViewRecipe; pinned?: boolean }): Promise<Mutation<SavedView>>;
  update(id: Id, patch: { name?: string; recipe?: ViewRecipe; pinned?: boolean }): Promise<Mutation<SavedView>>;
  duplicate(id: Id, name?: string): Promise<Mutation<SavedView>>;
  remove(id: Id): Promise<void>;          // deleted_at; auditado
  reorder(workspaceId: Id, kind: ViewRecipe['kind'], ids: Id[]): Promise<void>;
}

// ── Historial ──────────────────────────────────────────────────────────
export type AuditAction = 'create' | 'edit' | 'void' | 'restore' | 'batch_create' | 'batch_void' | 'batch_restore'
  | 'import' | 'merge' | 'config' | 'archive' | 'unarchive' | 'template_apply' | 'demo_seed'
  | 'backup_restore' | 'workspace_import';
export interface AuditEntry {
  id: Id; workspaceId: Id | null; at: Timestamp; action: AuditAction;
  entityType: string; entityId: Id | null; accountId: Id | null; batchId: Id | null;
  message: string; params: Record<string, unknown> | null;
  changes: Array<{ entityId: Id | null; path: string; old: unknown; new: unknown }>;
}
export interface AuditService {
  list(workspaceId: Id, input: { from?: IsoDate; to?: IsoDate; accountId?: Id; actions?: AuditAction[];
                                  entityType?: string; limit?: number; cursor?: string }): Promise<Page<AuditEntry>>;
  forEntity(entityType: string, entityId: Id): Promise<AuditEntry[]>;
}
// Interno (core/services/audit.ts), lo usan todos los servicios dentro de la misma transacción:
export interface AuditWriter {
  record(tx: SqlExecutor, entry: Omit<AuditEntry, 'id' | 'at' | 'changes'> & {
    changes: Array<{ entityId?: Id; path: string; old?: unknown; new?: unknown }>;
  }): Promise<Id>;
}
/** Diff de dos instantáneas → líneas de cambio. Si no hay líneas, el servicio NO escribe acción. */
export function diffTransaction(before: Transaction, after: Transaction): Array<{ path: string; old: unknown; new: unknown }>;

// ── Ajustes ────────────────────────────────────────────────────────────
export interface SettingsMap {   // claves conocidas y su tipo
  'locale': string;                         // 'es-DO'
  'theme': 'system' | 'light' | 'dark';
  'disclaimer.acceptedAt': Timestamp | null;
  'backup.lastVerifiedAt': Timestamp | null;
  'backup.reminderDays': number;            // 30
  'workspace.lastOpened': Id | null;
  'demo.offered': boolean;
}
export interface WorkspaceSettingsMap {
  'capture.lastKind': 'income' | 'expense';
  'capture.lastAccountId': Id | null;
  'home.cards': string[];                   // ids de HomeCardDef visibles y su orden
  'ledger.columns': Id[];
}
export interface SettingsService {
  get<K extends keyof SettingsMap>(key: K): Promise<SettingsMap[K]>;
  set<K extends keyof SettingsMap>(key: K, value: SettingsMap[K]): Promise<void>;
  getWs<K extends keyof WorkspaceSettingsMap>(workspaceId: Id, key: K): Promise<WorkspaceSettingsMap[K]>;
  setWs<K extends keyof WorkspaceSettingsMap>(workspaceId: Id, key: K, value: WorkspaceSettingsMap[K]): Promise<void>;
}

// ── Plantillas ─────────────────────────────────────────────────────────
export type TemplateSource = string /* id empaquetado */ | TemplateFile /* archivo importado */;
export interface ApplyTemplateInput { name: string; ownerName?: string; currency?: Currency; color?: string;
  openingBalances?: Record<string /* account key */, OpeningInput>; isDemo?: boolean }
export interface TemplatesService {
  list(): TemplateFile[];                                    // síncrono: son datos empaquetados
  get(templateId: string): TemplateFile;                     // not_found si no existe
  preview(template: TemplateSource): TemplatePreview;        // lo que se va a crear (Frappe Books)
  apply(template: TemplateSource, input: ApplyTemplateInput): Promise<Mutation<Workspace>>;  // UNA acción template_apply
  applyWithKeys(template: TemplateSource, input: ApplyTemplateInput): Promise<Mutation<AppliedTemplate>>; // + keyMap
  validate(input: unknown): TemplateValidation;              // forma, claves y recetas; todas las incidencias a la vez
  parse(json: string): TemplateValidation;                   // texto de un .cuadra-plantilla.json
  exportFromWorkspace(workspaceId: Id, opts?: ExportTemplateOptions): Promise<TemplateFile>; // solo estructura
  serialize(file: TemplateFile): { json: string; fileName: string };
}
// Formato versionado 'cuadra-template' v1 en src/templates/schema.ts (las cinco plantillas empaquetadas se
// cargan allí porque core solo puede importar templates/schema). apply con forma inválida → template_invalid
// (details.issues); si solo fallan recetas de vistas → invalid_recipe.

// ── Respaldo ───────────────────────────────────────────────────────────
export interface BackupService {
  /** F-81/83/84: arma el archivo, lo vuelve a leer y compara checksum y conteos antes de devolverlo.
   *  Con password, `text` es el sobre cifrado (AES-256-GCM + PBKDF2, src/core/crypto.ts). */
  export(opts: BackupScope & { password?: string }): Promise<{
    file: BackupFile; json: string; text: string; bytes: number; encrypted: boolean; verified: true;
    suggestedName: string }>;                                // cuadra-2026-11-26.cuadra.json
  /** La UI llama esto cuando el archivo ya se guardó/descargó. */
  markVerified(at?: Timestamp): Promise<void>;
  /** Sin escribir nada. Cifrado sin contraseña → ok:false, encrypted:true, error:'password_required'. */
  inspect(text: string, opts?: { password?: string }): Promise<BackupInspection>;
  /** F-87: reemplaza TODO. Antes guarda copia automática (destino externo o, si no hay, dentro de la BD). */
  restoreAll(text: string, opts: { confirm: true; password?: string }): Promise<{ workspaces: number; transactions: number;
    autoCopy: { name: string; storedIn: 'external' | 'database' } }>;
  /** F-88: un espacio del respaldo entra como espacio NUEVO, con ids nuevos. */
  importWorkspace(text: string, sourceWorkspaceId: Id, opts?: { rename?: string; password?: string }): Promise<Mutation<Workspace>>;
  lastAutoCopy(): Promise<{ name: string; createdAt: Timestamp; json: string } | null>;
}
export interface BackupInspection {
  ok: boolean; error?: ErrorCode; encrypted: boolean; formatVersion: number; schemaVersion: number; appVersion: string;
  createdAt: Timestamp; scope: 'all' | 'workspace';
  workspaces: Array<{ id: Id; name: string; transactions: number; accounts: number }>;
  counts: Partial<Record<BackupTable, number>>;
  needsUpgrade: boolean;
}

// ── Importación CSV y Excel ────────────────────────────────────────────
// La UI lee el .xlsx con read-excel-file y pasa las filas a fromRows(); el .csv con decode() + parse().
export type Cell = string | number | boolean | Date | null | undefined;
export interface RawTable { headers: string[]; rows: Cell[][]; delimiter?: string; encoding?: 'utf-8' | 'latin1' }
export type DateFormat = 'auto' | 'dd/MM/yyyy' | 'MM/dd/yyyy' | 'yyyy-MM-dd' | 'dd-MM-yyyy' | 'd/M/yy' | 'excel_serial';
export interface ColumnMapping {
  date: { column: number; format: DateFormat };
  amount:
    | { mode: 'signed'; column: number }                          // negativo = salida
    | { mode: 'split'; inColumn: number; outColumn: number }       // columnas Debe/Haber, Entrada/Salida
    | { mode: 'with_type'; column: number; typeColumn: number; inValues: string[] };
  amountLocale: string | 'auto';                                   // cómo vienen los números en el archivo
  account?: { column: number };                                    // columna de cuenta (por nombre)
  optionMap?: Record<Id /* fieldId */, Record<string, Id>>;        // alias editables texto → opción
  description: { column: number } | { fixed: string };
  notes?: { column: number };
  fields: Record<Id, { column: number }>;                          // listas: el texto se casa con opciones
  createMissingOptions: boolean;
}
export type ImportRowStatus = 'ok' | 'warning' | 'error' | 'duplicate' | 'opening_suspect' | 'empty';
export interface ImportPreviewRow {
  index: number; status: ImportRowStatus; skipByDefault: boolean;
  draft: TxDraft | null; issues: Array<ErrorCode | MoneyParseError | Warning['code'] | 'unparseable_date'>;
  raw: string[];
}
export interface ImportPreview {
  rows: ImportPreviewRow[];
  totals: { inMinor: Minor; outMinor: Minor; count: number };     // solo filas que se importarían
  newOptions: Array<{ fieldId: Id; label: string; rowCount: number }>;
  accountHasOpening: boolean;
}
export interface ImportCsvService {
  parse(text: string, opts?: { delimiter?: string }): RawTable;            // papaparse, detecta delimitador y BOM
  decode(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'latin1' }; // UTF-8 o windows-1252
  fromRows(rows: readonly (readonly Cell[])[], opts?: { headerRow?: number }): RawTable;  // filas de Excel
  detectColumns(raw: RawTable, fields?: Field[]): ColumnGuess[];
  suggestMapping(raw: RawTable, fields: Field[]): Partial<ColumnMapping>;   // "Fecha", "Monto", "Débito", "Concepto"...
  preview(workspaceId: Id, accountId: Id, raw: RawTable, mapping: ColumnMapping,
          opts?: { fileTotalMinor?: Minor; fileTotalInMinor?: Minor; fileTotalOutMinor?: Minor }): Promise<ImportPreviewResult>;
  // ImportPreviewResult = ImportPreview + fileTotals, fileTotalDifference, resolved (formato y locale elegidos);
  // cada fila gana opening, pendingOptions y duplicateOf; newOptions trae `similar`.
  /** Nada se guarda antes de esto. Crea opciones nuevas + un lote 'import'. Nunca toca movimientos existentes. */
  commit(workspaceId: Id, accountId: Id, preview: ImportPreview,
         opts: { include: number[] /* índices de filas */; fileName: string; mapping: ColumnMapping }):
    Promise<Mutation<{ batchId: Id; imported: number; skipped: number; createdOptions: number }>>;
  /** CSV modelo con las columnas de los campos del espacio (Frappe Books). */
  templateCsv(workspaceId: Id): Promise<string>;
  /** Lo mismo como tabla, para escribir un .xlsx con write-excel-file. */
  templateTable(workspaceId: Id): Promise<{ headers: string[]; rows: string[][] }>;
}
// commit crea las opciones nuevas en una transacción propia (sin acción) y luego UN createMany con lote
// 'import' y acción 'import'; si createMany falla, borra esas opciones (nadie las usa). El aviso far_date
// solo salta a más de 90 días en el futuro o más de 10 años atrás.

// ── Inicio de sesión local ─────────────────────────────────────────────
// Persistencia en settings (scope ''), claves auth.*: solo hashes PBKDF2 con sal, nunca la contraseña ni la
// clave de recuperación. La sesión vive en memoria: un reinicio arranca bloqueado. La base local NO se cifra.
export interface AuthStatus { enabled: boolean; locked: boolean; hasRecoveryKey: boolean; autoLockMinutes: number;
  profileName: string | null; failedAttempts: number; retryAt: Timestamp | null; passwordChangedAt: Timestamp | null }
export interface AuthService {
  status(): Promise<AuthStatus>;                 // relee la base y aplica el auto-bloqueo
  snapshot(): AuthStatus | null;                 // síncrono, para useSyncExternalStore
  setup(input: { profileName: string; password: string }): Promise<{ recoveryKey: string }>; // se muestra UNA vez
  unlock(password: string): Promise<void>;       // 5 intentos libres; luego 30 s que se doblan hasta 15 min
  unlockWithRecoveryKey(recoveryKey: string, newPassword: string): Promise<void>;
  lock(): void;
  changePassword(current: string, next: string): Promise<void>;
  regenerateRecoveryKey(password: string): Promise<{ recoveryKey: string }>;
  disable(password: string): Promise<void>;
  setAutoLock(minutes: number): Promise<void>;   // 0 = nunca; 1–1440; 5 por defecto
  touch(): void;                                 // la UI lo llama con cada interacción
  checkIdle(): boolean;                          // la UI lo llama cada ~15 s y en visibilitychange
  encrypt(plaintext: string): Promise<EncryptedEnvelope>;   // con la contraseña de la sesión abierta
  decrypt(envelope: EncryptedEnvelope): Promise<string>;
  subscribe(listener: (s: AuthStatus) => void): () => void;
}
// Sin crypto.subtle (http://ip-de-la-red) todo lanza crypto_unavailable; la UI usa isCryptoAvailable().
// Respaldo: las claves auth.* no salen nunca y restaurar conserva las del equipo (como sys.*).

// ── Datos de ejemplo ───────────────────────────────────────────────────
export type DemoProfileId = 'colmado' | 'despacho' | 'personal';
export interface DemoService {
  profiles(): Array<{ id: DemoProfileId; name: string; description: string; templateId: string }>;
  /** Plan puro, sin escribir (determinismo y vista previa). */
  plan(profile: DemoProfileId, opts?: { seed?: number; months?: number; anchor?: IsoDate }): DemoPlan;
  /** Crea un espacio nuevo is_demo=1 con ~14 meses que terminan en clock.today(). Avisos: saldo negativo FINAL. */
  seed(profile: DemoProfileId, opts?: { seed?: number; months?: number }): Promise<Mutation<{
    workspace: Workspace; transactions: number; batches: number; steps: number }>>;
}
```

### 3.6 Unidad de trabajo y eventos

```ts
// src/core/events.ts
export type TableName = 'workspaces' | 'accounts' | 'transactions' | 'transaction_field_values'
  | 'batches' | 'fields' | 'field_options' | 'saved_views' | 'audit_log' | 'settings';
export interface ChangeEvent { workspaceId: Id | null; tables: TableName[]; reason: string }

// src/core/uow.ts
export interface UowCtx {
  tx: SqlExecutor; clock: Clock; ids: IdGen; audit: AuditWriter;
  touch(...tables: TableName[]): void;
  warn(w: Warning): void;
}
/** Abre transacción, ejecuta fn, hace COMMIT y emite UN ChangeEvent. Todo servicio que escribe pasa por aquí. */
export function mutate<T>(deps: CoreDeps, workspaceId: Id | null, reason: string,
  fn: (ctx: UowCtx) => Promise<T>): Promise<Mutation<T>>;
```

Patrón obligatorio dentro de cada mutación: (1) leer estado previo, (2) validar duro → `DomainError`, (3) escribir, (4) `audit.record` con el diff, (5) `touch(...)`. Si el diff está vacío no hay acción ni evento.

### 3.7 Formato del respaldo (JSON versionado)

```ts
// src/core/services/backup.ts
export interface BackupFile {
  format: 'cuadra-backup';
  formatVersion: 1;                  // forma del sobre
  schemaVersion: number;             // migración de la BD que lo produjo (001 → 1)
  appVersion: string;                // package.json version
  createdAt: Timestamp;
  scope: 'all' | 'workspace';
  workspaceIds: Id[];
  /** sha-256 hex de JSON.stringify(tables) con claves en orden fijo (crypto.subtle). */
  checksum: string;
  counts: Record<BackupTable, number>;
  tables: Record<BackupTable, { columns: string[]; rows: SqlValue[][] }>;
}
export type BackupTable = 'workspaces' | 'accounts' | 'batches' | 'fields' | 'field_options'
  | 'transactions' | 'transaction_field_values' | 'saved_views' | 'audit_log' | 'audit_log_changes' | 'settings';
```

- **Tablas, no objetos de dominio:** el respaldo es un volcado fiel (incluye `seq`, `next_seq`, historial). Legible con cualquier visor JSON (espíritu de Paisa/Ledger).
- **Excluido:** `schema_migrations` y las claves `sys.*` y `auth.*` de `settings` (estado interno y hashes de la contraseña del equipo). Restaurar conserva las de la instalación: un respaldo nunca cambia la contraseña local.
- **Cifrado opcional:** con contraseña, el archivo es un sobre `EncryptedEnvelope` (AES-256-GCM, clave PBKDF2-SHA256, sal e IV nuevos por archivo, cabecera autenticada). Un respaldo hecho antes de cambiar la contraseña se abre solo con la contraseña con la que se hizo.
- **Versiones:** `schemaVersion > actual` → `backup_from_newer_version` ("actualiza Cuadra"). `schemaVersion < actual` → se aplican en memoria los *upgraders* `src/core/services/backup-upgrades/<n>.ts` (uno por cada migración que cambie forma) antes de insertar. 001 no necesita ninguno.
- **Restaurar todo:** `exportBytes()` → copia automática (destino `CuadraDeps.backupAutoCopy`; si falla, no se restaura; sin destino, dentro de la base en `sys.backup.autoCopy`) → transacción: `INSERT sys.maintenance` → `DELETE` de todas las tablas en orden inverso de FK → `INSERT` en orden de FK con `runMany` → `DELETE sys.maintenance` → acción `backup_restore` en historial → `PRAGMA foreign_key_check` vacío o ROLLBACK.
- **Importar un espacio:** se genera un mapa `idViejo → idNuevo` para todas las filas del espacio (incluidos `transfer_group_id`, `merged_into_id`, `params/meta` que contengan ids conocidos) y se inserta en modo mantenimiento (para conservar `seq`).

### 3.8 Notas de la Oleada 2 (donde el código cambió el contrato)

**Migración 002: no se hizo.** `createMany` con 5 000 borradores tarda 415–494 ms en Node (la referencia mínima que impone el trigger, reservar e insertar fila a fila, es 304 ms). Queda para la Oleada 4 medirlo en el navegador real (OPFS); si pasa de ~1,5 s, el diseño propuesto para la 002 es que el trigger exija `seq = MAX(seq) + 1` y `seq < next_seq`, reservar un bloque por cuenta con un solo UPDATE e insertar con `runMany`. Tampoco se añadió el índice de cobertura `tx_ws_agg` que propuso 2C (baja el cubo del panel de ~15 a ~10 ms en Node): necesitaría esa migración.

**Movimientos (2A).**
- Crear con un campo u opción inactivos es error duro (`field_inactive`, `option_inactive`); editar conserva los valores que no cambian y vaciar siempre se permite. Editar un anulado → `already_voided`; `duplicate` de un saldo inicial → `opening_exists`.
- `far_date.days` lleva signo (positivo = futuro). `createMany` solo avisa del saldo final negativo por cuenta; los avisos por fila salen en `batches.capture` o con `computeWarnings` (validation.ts).
- `createMany().ids` trae un id por borrador en orden (transferencia → su lado de salida). `insertBatch(ctx, input)` es `createMany` sin transacción ni historial, para componer un guardado con UNA acción propia (importación, demo).
- Historial: las transferencias son `entityType 'transfer'` con el id del grupo; un alta lleva una línea `'*'` con la instantánea; anular/restaurar un lote escribe una línea `status` por fila; `history`/`forEntity` van de lo más reciente a lo más antiguo e incluyen la acción que creó el lote. `setOpening` sobre un saldo inicial anulado lo edita y restaura en la misma acción.
- Reutilizar el último `seq` choca con UNIQUE (SqlError), no con el trigger; los no reservados o saltados dan `seq_not_reserved`.

**Estructura (2B).** Moneda por espacio con decimales bloqueados si hay movimientos (`currency_locked`). `workspaces.purge(id, nombreExacto)` borra en modo mantenimiento y deja una acción en el historial general. Reordenar y cambiar ajustes no escriben historial (solo evento); desactivar o borrar campos/opciones → `config`; renombrar → `edit` con `audit.*.rename`. `insertOpeningTx` (accounts.ts) crea saldos iniciales al crear cuentas y aplicar plantillas dentro de la transacción del llamador.

**Consultas e informes (2C).** `ReportDocument` gana `recipe`, `accounts` y `fields` (se pinta y exporta sin más consultas). En `Totals` los montos solo suman activos; `count` cuenta el conjunto pedido y `voidedCount` los anulados que cumplen el resto del filtro. Los grupos de un resumen solo cuentan entradas y salidas. En un campo sí/no, "sin valor" cuenta como "No". Vistas: nombre único por tipo sin distinguir mayúsculas (`duplicate_label`), nombre vacío → `name_required`, borrar = acción `archive` con `audit.view.remove`. Cursor o filtro con forma inválida (incluidas fechas inexistentes) → `invalid_recipe`. Exportación tabular en `src/core/export/tabular.ts` (`transactionsToSheet`, `summaryToSheet`, `auditToSheet`, `reportToSheets`, `sheetToRows`; columnas con `key` y tipo `'number'`).

**Respaldo e importación (2D).** Ver 3.5 y 3.7. `APP_VERSION` del núcleo es el valor por defecto; la cáscara pasa la real. Upgraders en `services/backup-upgrades/` (ninguno registrado: la 001 no lo necesita). `suggestMapping` toma Débito/Cargo/Retiro como salida y Crédito/Abono/Depósito como entrada (extracto bancario), pero Debe como entrada y Haber como salida (libro de caja); la UI debe dejar cambiarlo.

**Inicio de sesión (2F).** Ver `AuthService` en 3.5. Contraseña de 8 a 1 024 caracteres (normalizada a NFC); la clave de recuperación (6 grupos de 4 símbolos Crockford, el último de control) sigue sirviendo tras usarla; los intentos fallidos no van al historial; si otra vía reescribe `auth.*`, el servicio relee y bloquea.

**Revisión adversarial (cierre de la Oleada 2).** Pruebas en `src/test/adversarial.test.ts` y `src/test/identity.random.test.ts` (modelo independiente con BigInt sobre operaciones aleatorias deterministas). Cambios de contrato que salieron de ahí:
- *Techo de volumen por espacio:* la suma de `amount_minor` de todos los movimientos del espacio (activos y anulados; una transferencia cuenta sus dos lados) no pasa de `MAX_MINOR` (unos 90 billones de pesos). Lo comprueban `assertWorkspaceCapacity` (validation.ts) al crear y al editar al alza, y `insertOpeningTx`; si no cabe → `invalid_amount` con `details.reason = 'workspace_total_too_large'`. Así ningún saldo, total ni grupo sale de los enteros seguros (antes, dos montos cercanos a 2^53 rompían `Money.add` con un `RangeError` y dejaban el panel sin leer).
- *Captura e importación:* la fila que haría pasar la suma del lote o del archivo de `MAX_MINOR` sale como `too_large` (error de fila), no como `RangeError`.
- *Restaurar e importar un espacio* comprueban, antes de salir del modo mantenimiento, I-7 (`seq` 1..n y `next_seq = n + 1`), I-9 (transferencias de dos lados coherentes), fechas reales (`date(x) = x`) y el techo de volumen; si algo falla → `backup_invalid` con `details.reason = 'integrity'` y ROLLBACK. El checksum no es una firma: un archivo editado a mano con el checksum recalculado llegaba a dejar cuentas inservibles.
- *CSV:* `sheetToRows` antepone `'` a las celdas de texto que empiezan por `= + - @`, tabulador o retorno (inyección de fórmulas); el dinero sale aparte como decimal canónico.
- *Fechas de saldo inicial:* `validateOpening` usa `isStorableDate` (años 1000–2999), como el resto.

**Mensajes del historial.** Cada acción guarda `message` (clave i18n) y `params`; los textos están en `src/i18n/es/audit.ts` (y `auth.audit.*` en `auth.ts`). Los montos viajan en unidad menor y la UI los formatea con `Money.format`; una prueba comprueba que toda clave `audit.*` del núcleo tiene texto.

---

## 4. Invariantes y pruebas (tests-first)

Ningún servicio se da por terminado sin sus pruebas en verde. Todas usan `createTestCuadra()` (node:sqlite en memoria, reloj fijo `2026-06-15`). Los nombres son los textos exactos del `it(...)`.

### 4.1 Invariantes

| # | Invariante |
|---|---|
| I-1 | Saldo de una cuenta = Σ con signo de sus movimientos **activos** de todo tipo |
| I-2 | Saldo del espacio = Σ saldos de sus cuentas (incluidas archivadas) |
| I-3 | Entradas/salidas solo cuentan `income`/`expense`; transferencias y saldo inicial van en líneas propias |
| I-4 | En el espacio, Σ transferencias entrantes = Σ salientes (activas) |
| I-5 | Saldo inicial del periodo + saldos iniciales en el periodo + entradas − salidas + transf. entrantes − transf. salientes = saldo final (por cuenta y total) |
| I-6 | Máximo un saldo inicial por cuenta en toda su vida |
| I-7 | `seq` por cuenta es 1..n sin huecos; nunca se reutiliza ni cambia; los anulados lo conservan |
| I-8 | Anulado ⇒ fuera de saldos, totales, gráficas e informes; visible en listados con estado |
| I-9 | Una transferencia son exactamente dos filas (out/in) del mismo espacio, mismo monto y fecha, mismo estado |
| I-10 | Un guardado = como mucho una acción de historial; el historial nunca se actualiza ni se borra |
| I-11 | Un campo/opción con algún valor (incluidos anulados) no se borra; su tipo no cambia |
| I-12 | Un movimiento tiene como mucho un valor por campo |
| I-13 | La suma de los grupos de cualquier resumen = los totales del mismo filtro |
| I-14 | Nada se escribe en importación ni en captura con total descuadrado sin confirmación explícita |
| I-15 | Exportar → restaurar produce las mismas filas en todas las tablas respaldadas |

### 4.2 Lista de pruebas

**`src/core/money.test.ts`**
1. `parse es-DO "1,234.50" → 123450`
2. `parse es-ES "1.234,50" → 123450`
3. `parse ignora símbolo y espacios "RD$ 1,000" → 100000`
4. `parse "12.5" en es-ES se lee como decimal → 1250`
5. `parse rechaza más decimales que la moneda ("10.555" DOP) → too_many_decimals`
6. `parse moneda sin decimales (minorDigits 0) "1,500" → 1500`
7. `parse rechaza negativo salvo allowNegative`
8. `parse rechaza valores fuera de MAX_SAFE_INTEGER → too_large`
9. `parseExpression "150+75.50-25" → 20050`
10. `format 123450 DOP es-DO usa el símbolo configurado y 2 decimales`
11. `sum de tres 0.10 da exactamente 30 (sin flotantes)`
12. `allocate 1000 en 3 → [334, 333, 333] y suma el total`

**`src/core/dates.test.ts` / `ids.test.ts`**
13. `resolvePeriod last_month con hoy 2026-01-15 → 2025-12-01..2025-12-31`
14. `resolvePeriod this_week empieza en lunes (es-DO)`
15. `uuidv7 es monótono dentro del mismo milisegundo y tiene formato v7`

**`src/data/migrate.test.ts`**
16. `BD vacía aplica 001, deja user_version=1 y fila en schema_migrations`
17. `migrar dos veces no hace nada la segunda`
18. `una migración que falla hace ROLLBACK y user_version no cambia`
19. `BD con user_version mayor que la app → db_from_newer_version`
20. `checksum distinto de una migración aplicada → migration_checksum`
21. `foreign_keys está activo al abrir (PRAGMA foreign_keys = 1)`

**`src/core/services/accounts.test.ts`**
22. `saldo = inicial + entradas − salidas ± transferencias, sin anulados`
23. `saldo del espacio = suma de saldos de cuentas, incluidas archivadas`
24. `una salida que deja la cuenta en negativo se guarda con aviso negative_balance`
25. `cuenta archivada conserva movimientos y rechaza nuevos (account_archived)`
26. `balances asOf excluye movimientos posteriores a la fecha`
27. `crear cuenta con saldo inicial 0 no crea movimiento de saldo inicial`

**`src/core/services/opening.test.ts`**
28. `segundo saldo inicial en la misma cuenta → opening_exists; setOpening edita el existente`
29. `saldo inicial cuenta en el saldo pero no en entradas`
30. `movimiento con fecha anterior al saldo inicial → aviso before_opening`
31. `anular el saldo inicial lo quita del saldo; restaurar lo devuelve`
32. `saldo inicial negativo (direction out) para una tarjeta con deuda`

**`src/core/services/transfers.test.ts`**
33. `transferencia crea dos filas enlazadas, out/in, con seq propio en cada cuenta`
34. `transferencias no cuentan en entradas ni salidas del espacio y salen en su línea`
35. `editar el monto de un lado cambia los dos en una sola acción de historial`
36. `anular un lado anula los dos; restaurar restaura los dos`
37. `transferencia a la misma cuenta → transfer_same_account`
38. `transferencia hacia una cuenta de otro espacio → workspace_mismatch`

**`src/core/services/seq.test.ts`**
39. `seq empieza en 1 y es consecutivo por cuenta`
40. `un anulado conserva su seq y el siguiente recibe seq+1`
41. `UPDATE de seq, account_id o recorded_at lo rechaza la BD (immutable_column)`
42. `DELETE de un movimiento lo rechaza la BD (delete_forbidden)`
43. `un INSERT con seq no reservado lo rechaza la BD (seq_not_reserved)`
44. `createMany de 50 filas deja seq 1..50 sin huecos; si falla una, no queda ninguna`
45. `cambiar la cuenta de un movimiento → account_change_forbidden`

**`src/core/services/void-edit-audit.test.ts`**
46. `anulado queda fuera de saldo, totales, resumen e informe, y aparece con status voided`
47. `anular guarda el motivo y lo registra en el historial`
48. `editar tres campos en un guardado produce una acción con tres líneas (F-57)`
49. `editar sin cambios reales no escribe historial ni emite evento`
50. `UPDATE y DELETE sobre audit_log los rechaza la BD`
51. `renombrar cuenta, desactivar campo y fusionar opciones quedan en el historial (F-58)`
52. `historial general filtra por cuenta y por tipo de acción`
53. `cambiar income↔expense está permitido; a transfer u opening no (kind_change_forbidden)`

**`src/core/services/fields.test.ts`**
54. `campo nuevo aparece en formSchema, en dimensions y se puede agrupar`
55. `campo desactivado sale de formSchema pero conserva valores y sigue filtrable`
56. `crear un movimiento con valor en un campo inactivo → field_inactive; editar uno viejo lo conserva`
57. `borrar un campo nunca usado funciona; con un valor en un anulado → field_in_use`
58. `update no acepta type y el trigger impide cambiarlo por SQL`
59. `un movimiento no puede tener dos opciones del mismo campo`
60. `renombrar una opción se refleja en todos los movimientos sin tocarlos`
61. `fusionar opciones mueve los valores, desactiva el origen con merged_into_id y escribe una sola acción`
62. `filtro sí/no "No" incluye los movimientos sin valor (F-65)`
63. `campo creado con datos existentes: los viejos agrupan en "Sin valor"`
64. `similarOptions encuentra "Electricidad" al escribir "electrisidad"`
65. `valor de lista con opción de otro campo lo rechaza la BD (field_value_type_mismatch)`

**`src/core/services/queries.test.ts`**
66. `filtros combinados (cuenta + periodo + tipo + campo + texto + monto) son AND`
67. `los totales se recalculan sobre lo filtrado`
68. `búsqueda de texto ignora mayúsculas y tildes ("cafe" encuentra "Café")`
69. `resumen por mes rellena con cero los meses sin datos del rango`
70. `resumen por campo incluye "Sin valor" y la suma de grupos = totales`
71. `resumen excluye transferencias y saldos iniciales de entradas/salidas`
72. `saldo corrido en el listado de una cuenta coincide con el saldo real aunque haya filtros`
73. `vista guardada que usa un campo desactivado funciona y avisa field_inactive`

**`src/core/services/reports.test.ts`**
74. `identidad del estado: inicial + iniciales del periodo + entradas − salidas + transf. = final, por cuenta y total`
75. `informe detallado lista anulados aparte solo si includeVoided`
76. `informe con filtros marca filtered y describe los filtros`
77. `reportToSheets produce columnas de dinero en unidad menor y tipos correctos`

**`src/core/services/batches.test.ts`**
78. `captura guarda las filas válidas en un lote y devuelve los errores de las inválidas`
79. `total de control que no cuadra devuelve control_mismatch y no guarda nada`
80. `total de control descuadrado aceptado se guarda con control_mismatch_accepted`
81. `anular un lote anula sus activos en una acción; restaurar no revive los anulados a mano`
82. `duplicate devuelve borrador con fecha de hoy y no consume seq`

**`src/core/services/validation.test.ts`**
83. `monto cero → aviso zero_amount, se guarda`
84. `fecha a más de 90 días de hoy → aviso far_date`
85. `mismo monto, cuenta y descripción parecida en ±3 días → aviso possible_duplicate`

**`src/templates/templates.test.ts`**
86. `todas las plantillas JSON cumplen el esquema y sus claves son únicas`
87. `aplicar "negocio" crea cuentas, campos, opciones y vistas con una acción template_apply`
88. `las recetas de plantilla se resuelven de claves a ids`
89. `aplicar con saldos iniciales crea movimientos de saldo inicial y omite los cero`

**`src/core/services/backup.test.ts`**
90. `exportar y restaurar deja las mismas filas en todas las tablas respaldadas`
91. `checksum alterado → backup_checksum`
92. `respaldo con schemaVersion mayor → backup_from_newer_version`
93. `importar un espacio suelto crea ids nuevos, conserva seq y no toca los existentes`
94. `restaurar todo guarda antes una copia automática y escribe backup_restore`

**`src/core/services/importCsv.test.ts`**
95. `suggestMapping reconoce Fecha, Monto/Importe, Débito/Crédito y Concepto/Descripción`
96. `preview lee fechas dd/MM/yyyy y montos "1.234,50" según el formato elegido`
97. `modo split (Entrada/Salida) produce income y expense`
98. `preview marca filas ilegibles y no escribe nada en la BD`
99. `preview marca duplicados de movimientos existentes y los salta por defecto`
100. `fila que parece saldo inicial se marca opening_suspect y se salta si la cuenta ya tiene saldo inicial`
101. `commit crea un lote import; anular el lote deshace la importación sin tocar lo previo`
102. `opciones nuevas se crean una sola vez sin distinguir mayúsculas ni tildes`
103. `total del archivo distinto del total a importar se informa en fileTotalDifferenceMinor`

**`src/core/demo/demo.test.ts`**
104. `misma semilla y misma fecha ancla → mismo plan (hash idéntico)`
105. `colmado cubre 14 meses, tiene transferencias, lotes y anulados, y cumple I-1..I-9`

Además (Oleada 2): las demás pruebas de `demo.test.ts` (cuentas negativa y archivada, campos fusionados/renombrados/desactivados, historial fechado, vistas y panel, despacho y personal con los cinco tipos de campo e importación), `core/services/structure-errors.test.ts` (códigos nuevos), `i18n/audit.test.ts` (textos del historial), `data/restoreCopies.test.ts` (copia previa a restaurar), `app/data/auth.test.ts` (auto-bloqueo) y la de `backup.test.ts` que comprueba que `auth.*` no sale en el respaldo.

**`src/test/architecture.test.ts`**
106. `core no importa react, DOM, node:* ni otras capas`
107. `ninguna feature importa otra feature ni app/shell`

---

## 5. Capa de UI

### 5.1 Lectura y mutación: TanStack Query + eventos del núcleo

**Elección: `@tanstack/react-query` 5.108.4** para datos y **`zustand` 5.1.0** solo para estado de interfaz (tema, hoja abierta, borradores de captura, filtros en edición).

Por qué no un almacén propio: el problema real es caché + estados de carga/error + deduplicación + invalidación selectiva + reintentos sobre llamadas asíncronas al worker. TanStack Query ya lo resuelve y está probado en este stack; un almacén propio acabaría reimplementándolo peor. El núcleo aporta lo que falta: **eventos por tabla tras cada COMMIT**, así que nadie invalida a mano.

```ts
// src/app/data/useCuadraQuery.ts
export function useCuadraQuery<T>(opts: {
  key: readonly unknown[];            // ['transactions.list', wsId, filter]
  tables: TableName[];                // de qué tablas depende → meta.tables
  fn: (c: Cuadra) => Promise<T>;
  enabled?: boolean;
}): UseQueryResult<T, DomainError>;

// src/app/data/useCuadraMutation.ts
export function useCuadraMutation<I, O>(fn: (c: Cuadra, input: I) => Promise<Mutation<O>>, opts?: {
  successToast?: string | ((o: O) => string);   // clave i18n
  undo?: (c: Cuadra, o: O) => Promise<unknown>; // toast "Deshacer" (p. ej. anular lo recién creado)
}): UseMutationResult<Mutation<O>, DomainError, I>;

// src/app/data/CuadraProvider.tsx — puente núcleo → caché
cuadra.subscribe((e) => {
  queryClient.invalidateQueries({
    predicate: (q) => {
      const tables = (q.meta?.tables ?? []) as TableName[];
      const ws = q.queryKey[1];
      return tables.some((t) => e.tables.includes(t)) && (e.workspaceId === null || ws === e.workspaceId || ws === undefined);
    },
  });
});
```

Configuración del `QueryClient`: `staleTime: Infinity` (los datos solo cambian por eventos propios), `retry: 0` (los errores de dominio no se reintentan), `networkMode: 'always'` (no hay red).

Hooks compartidos (`src/app/data/hooks.ts`, dueños: shell), los únicos que varias features usan:

```ts
// Las definiciones puras (clave, tablas, llamada) viven en src/app/data/queryDefs.ts; clave =
// [nombre, workspaceId | undefined, ...parámetros] (undefined = consulta global, la afecta cualquier espacio).
export function useWorkspaceId(): Id;                       // de la ruta /e/:wsId
export function useOptionalWorkspaceId(): Id | undefined;
export function useWorkspaces(opts?: { includeArchived?: boolean }): UseQueryResult<WorkspaceSummary[]>;
export function useWorkspace(id?: Id): UseQueryResult<Workspace>;
export function useAccounts(opts?: { includeArchived?: boolean; asOf?: IsoDate }): UseQueryResult<AccountWithBalance[]>;
export function useBalances(opts?: { asOf?: IsoDate }); export function useBalanceSeries(input);
export function useFields(opts?: { includeInactive?: boolean }): UseQueryResult<Field[]>;
export function useFieldOptions(fieldId, opts?); export function useFormSchema(kind: 'income' | 'expense' | 'transfer');
export function useTransactions(filter, page?); export function useInfiniteTransactions(filter, opts?);
export function useTransactionsByDay(filter, page?); export function useTransaction(id); export function useTransactionHistory(id);
export function useTotals(filter); export function useSummary(input); export function useHome(month?);
export function useDashboard(opts?: DashboardOptions): UseQueryResult<DashboardData>;   // conserva el anterior al cambiar
export function useViews<K extends ViewRecipe['kind']>(kind: K): UseQueryResult<SavedView<K>[]>;
export function useAudit(input?); export function useWorkspaceSetting(key);
export function useSetting<K extends keyof SettingsMap>(key: K): [SettingsMap[K] | undefined, (v: SettingsMap[K]) => Promise<void>];
export function useMoneyFormat(): (minor: Minor, o?: { sign?: 'auto' | 'always'; compact?: boolean }) => string;
export function useMoneyParse(): (s: string, o?: { allowNegative?: boolean }) => Result<Minor, MoneyParseError>;
export function useBootInfo(): BootInfo;                    // almacenamiento, esquema, versión de SQLite
export function useAuth(): { ready; enabled; locked; mustLock; status: AuthStatus | null;
  unlock(password): Promise<void>; lock(): void; refresh(): Promise<void> };   // useSyncExternalStore sobre cuadra.auth
// src/app/data/auth.ts también exporta attachIdleLock(auth): el pulso del auto-bloqueo (touch con cada
// interacción, checkIdle cada 15 s y en visibilitychange). Lo engancha UNA vez el shell (LockGate).
```

Optimismo: no hace falta. Una escritura local tarda < 10 ms; la UI espera la promesa y anima el resultado.

### 5.2 Registro de features (añadir una no toca el shell)

```ts
// src/app/registry/types.ts
export type Scope = 'root' | 'workspace';          // workspace → montado bajo /e/:wsId
export interface FeatureRoute {
  path: string;                                    // relativo al scope: 'cuentas/:accountId'
  scope: Scope;
  lazy: () => Promise<{ Component: React.ComponentType }>;
  presentation?: 'page' | 'sheet';                 // sheet: hoja inferior en móvil, panel lateral en escritorio
  titleKey?: string;
}
export interface NavEntry {
  id: string; scope: Scope; to: string; labelKey: string; icon: LucideIcon;
  placement: 'primary' | 'more' | 'settings';     // primary: barra inferior/lateral (máx. 4)
  order: number;
}
export interface QuickAction {                      // lo que ofrece el botón "+" (FAB)
  id: string; labelKey: string; icon: LucideIcon; tone: 'in' | 'out' | 'neutral';
  to: string; order: number; shortcut?: string;     // 'e' entrada, 's' salida, 't' transferencia
}
export interface HomeCardDef {                      // tarjetas del inicio (P-03), configurables
  id: string; titleKey: string; order: number; size: 'full' | 'half'; defaultVisible: boolean;
  lazy: () => Promise<{ Component: React.ComponentType<{ workspaceId: Id }> }>;
}
export interface SettingsSectionDef {
  id: string; scope: Scope; labelKey: string; icon: LucideIcon; to: string; order: number;
}
export interface FeatureModule {
  id: string;
  routes?: FeatureRoute[]; nav?: NavEntry[]; quickActions?: QuickAction[];
  homeCards?: HomeCardDef[]; settingsSections?: SettingsSectionDef[];
  /** Feature desactivable por espacio en el futuro (modelo de módulos de Akaunting). */
  flag?: string;
}

// src/app/registry/collect.ts
const mods = import.meta.glob<{ feature: FeatureModule }>('../../features/*/index.ts', { eager: true });
export const features: FeatureModule[] = Object.values(mods).map((m) => m.feature)
  .filter((f) => import.meta.env.DEV || !f.id.startsWith('_'));
```

Ejemplo de descriptor (lo único que una feature expone):

```ts
// src/features/capture/index.ts
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Rows3 } from 'lucide-react';
import type { FeatureModule } from '../../app/registry/types';
export const feature: FeatureModule = {
  id: 'capture',
  routes: [
    { path: 'nuevo', scope: 'workspace', presentation: 'sheet', lazy: () => import('./routes/QuickEntry') },
    { path: 'captura', scope: 'workspace', lazy: () => import('./routes/TableCapture') },
    { path: 'transferencia', scope: 'workspace', presentation: 'sheet', lazy: () => import('./routes/Transfer') },
  ],
  quickActions: [
    { id: 'in', labelKey: 'capture.in', icon: ArrowDownLeft, tone: 'in', to: 'nuevo?tipo=entrada', order: 1, shortcut: 'e' },
    { id: 'out', labelKey: 'capture.out', icon: ArrowUpRight, tone: 'out', to: 'nuevo?tipo=salida', order: 2, shortcut: 's' },
    { id: 'transfer', labelKey: 'capture.transfer', icon: ArrowLeftRight, tone: 'neutral', to: 'transferencia', order: 3, shortcut: 't' },
    { id: 'table', labelKey: 'capture.table', icon: Rows3, tone: 'neutral', to: 'captura', order: 4 },
  ],
};
```

Las tarjetas del inicio (saldo, flujo mensual, cuentas, recordatorio de respaldo, cuentas en negativo) las aportan `home`, `insights`, `accounts` y `backup` por el registro; `home` solo las pinta en el orden guardado en `home.cards`. Así el "resumen configurable" del inicio crece sin tocar `home`.

**Añadidos de la Oleada 2 al registro** (`src/app/registry/types.ts`, cuya cabecera trae un ejemplo completo):

- `NavEntry.group` y `NavEntry.goKey` (atajo `g` + letra).
- `lockScreen?: LockScreenDef` en `FeatureModule` (`{ lazy: () => import(...) }` con `Component(props: LockScreenProps)`). Solo la feature `auth` debería registrarla; el shell (`LockGate`) la muestra a pantalla completa cuando `auth.mustLock`, oculta la app sin desmontarla y engancha el auto-bloqueo. Sin `lockScreen` registrada no se bloquea nada.
- `InspectorPanel` (`app/registry/inspector`): portal al inspector fijo desde 1280 px, hoja lateral o inferior en anchos menores. `useSheet()` (`app/registry/sheet`) da `close` y `setDirty` a las rutas `presentation: 'sheet'`.
- `findRegistryProblems` avisa en desarrollo de ids o atajos repetidos.

Atajos del shell: `Ctrl+K` paleta, `n` anotar, `e`/`s`/`t` entrada/salida/transferencia, `g` + letra para ir, `/` buscar, `?` ayuda. No actúan al escribir ni con un diálogo modal abierto. Las features no renderizan `<main>` (lo pone el shell) ni usan `position: fixed` dentro de sus páginas.

### 5.3 Enrutado

`createHashRouter` (react-router 8.5.3, modo librería): funciona en GitHub Pages en subruta y en Tauri sin configurar servidor. `src/app/router.tsx` construye el árbol a partir de `features`:

```
/                                    → workspaces    P-01 Elegir espacio (o redirige al último abierto)
/bienvenida                          → onboarding    P-02 aviso + plantilla + moneda + saldos + ejemplo
/bienvenida/plantilla/:templateId    → onboarding    vista previa de lo que crea la plantilla
/respaldo                            → backup        P-14 respaldo y restauración
/ajustes                             → backup        P-15 ajustes de instalación (moneda por defecto, tema, aviso)
/_ui                                 → _gallery      galería del sistema de diseño (solo dev)
/e/:wsId                             → home          P-03 Inicio
/e/:wsId/cuentas                     → accounts      P-04 Cuentas
/e/:wsId/cuentas/:accountId          → ledger        P-05 Libro de una cuenta
/e/:wsId/movimientos                 → ledger        Todos los movimientos del espacio (filtros, vistas)
/e/:wsId/movimientos/:txId           → ledger        P-09 Detalle (hoja) + historial
/e/:wsId/lotes/:batchId              → ledger        Movimientos de un lote + anular lote
/e/:wsId/nuevo?tipo=entrada|salida&cuenta=&desde=:txId   → capture P-06 (desde = duplicar)
/e/:wsId/captura?cuenta=&tipo=       → capture       P-07 Captura en tabla
/e/:wsId/transferencia               → capture       P-08 Transferencia
/e/:wsId/resumen?vista=:viewId       → insights      P-10 Resumen configurable
/e/:wsId/informes                    → reports       P-11 Lista de informes
/e/:wsId/informes/:viewId|resumido|detallado → reports  Informe generado (imprimible)
/e/:wsId/historial                   → audit         P-12 Historial general
/e/:wsId/importar                    → import        P-18 Asistente CSV
/e/:wsId/ajustes                     → settings      P-13 índice de configuración
/e/:wsId/ajustes/espacio|cuentas|campos|campos/:fieldId|vistas → settings
```

Filtros activos y periodo van en la query string (`?periodo=this_month&cuenta=…&f=<base64url(JSON)>`) para que "atrás" y compartir enlace funcionen. Navegación: **móvil** barra inferior con 4 entradas `primary` (Inicio, Movimientos, Resumen, Más) y el botón "+" central con las `quickActions`; **escritorio (≥ 1024 px de contenedor, DESIGN §8.1)** barra lateral con selector de espacio arriba y las mismas entradas. View Transitions al navegar donde `document.startViewTransition` exista.

El shell también resuelve: pantalla de arranque, `TabLockScreen` ("Cuadra está abierta en otra pestaña · Usar aquí"), `UpdatePrompt` del service worker (`registerType: 'prompt'`), `BootError` (sin OPFS ni IndexedDB → modo solo memoria con banner rojo "los datos no se guardarán").

Ruta propia del shell: `/e/:wsId/mas` (página «Más», destino de la barra inferior móvil, que tiene 2 destinos primarios + «Más» + la pastilla Anotar, según DESIGN §8.2).

### 5.4 i18n y formato regional

- Diccionarios por espacio de nombres en `src/i18n/es/<ns>.ts`, cada uno exportando un objeto plano `as const`. `src/i18n/es/index.ts` los junta con `import.meta.glob`, así cada agente edita solo su archivo.
- `t('capture.saveAndNew')`, `t('audit.tx.edit', { seq: 12 })` con interpolación `{seq}` y plural simple `{n, plural, one {# movimiento} other {# movimientos}}` (implementación propia mínima, sin dependencia). Clave inexistente: en dev, `⟦clave⟧` visible y `console.warn`; en prod, la clave.
- `useT()` devuelve `t`; los errores de dominio se traducen con `t('errors.' + code)` (archivo `errors.ts`, dueño: núcleo).
- **Formato:** `src/i18n/format.ts` con `Intl` cacheado por locale: `formatMoney` (envuelve `Money.format` con la moneda del espacio), `formatDate` (`26 nov 2026`), `formatDayHeader` (`Hoy`, `Ayer`, `jueves 26`), `formatPeriod` (`noviembre 2026`, `T4 2026`). Locale por defecto **`es-DO`**, moneda por defecto **DOP, 2 decimales, símbolo `RD$`**. Locale en ajustes de instalación; moneda por espacio (un contador puede tener un cliente en USD).
- Semana empieza en lunes. Fechas de entrada con `<input type="date">` nativo + atajos (Hoy, Ayer) en chips.

---

## 6. Datos de demostración

`src/core/demo/` — sin DOM, determinista.

```ts
// src/core/demo/prng.ts
export function mulberry32(seed: number): () => number;     // [0,1)
export interface Rng { next(): number; int(min: number, max: number): number; pick<T>(xs: readonly T[]): T;
  chance(p: number): boolean; normalMinor(meanMinor: Minor, sdMinor: Minor, roundTo: Minor): Minor }

// src/core/demo/plan.ts (tipos, hashPlan, calendario) · index.ts (planDemo, DEMO_PROFILES) · colmado|despacho|personal.ts
// Forma real: DemoPlan gana profile, start/anchor, extraAccounts, extraFields, extraOptions, steps (la historia)
// y backupVerifiedDaysAgo; los anulados van como pasos 'void' en vez de `voids`. Esquema de abajo = idea original.
export interface DemoPlan {
  templateId: 'negocio' | 'despacho';
  workspace: { name: string; ownerName: string };
  openings: Record<string /* account key */, OpeningInput>;
  /** Referencias por clave de plantilla (cuenta, campo, opción): independientes de ids. */
  items: Array<
    | { t: 'tx'; account: string; kind: 'income' | 'expense'; amountMinor: Minor; date: IsoDate; description: string; notes?: string; values: Record<string, string | number | boolean> }
    | { t: 'transfer'; from: string; to: string; amountMinor: Minor; date: IsoDate; description: string }
    | { t: 'capture'; account: string; kind: 'income' | 'expense'; date: IsoDate; label: string; controlTotalMinor: Minor; rows: Array<{ amountMinor: Minor; description: string; values: Record<string, string> }> }>;
  voids: Array<{ index: number; reason: string }>;
}
export function planDemo(profile: 'colmado' | 'despacho' | 'personal', opts: { seed?: number; anchor: IsoDate; months?: number }): DemoPlan;
export function hashPlan(plan: DemoPlan): string;           // para la prueba de determinismo
// DemoService.seed = templates.apply + traducir claves a ids + transactions.createMany (UNA acción demo_seed)
```

Reglas comunes: semilla fija `20261126`; ancla = `clock.today()` (los datos siempre terminan "hoy" pero son idénticos para la misma ancla); 14 meses hacia atrás; montos redondeados a lo creíble (RD$ 5 en ventas, RD$ 50 en gastos); estacionalidad de diciembre (+35 %) y de inicio de clases en agosto; nombres de comercios y contactos **ficticios y genéricos** (nada tomado de los documentos de origen). Objetivo: 1 800–2 600 movimientos en total, para que listas, filtros y gráficas se vean vivos sin ralentizar el worker.

**Implementación (Oleada 2).** `src/core/demo/` (prng, plan, builder y un archivo por perfil) produce un `DemoPlan` puro; `services/demo.ts` lo escribe en tres tiempos:

1. `templates.applyWithKeys` (acción `template_apply`) crea el espacio `is_demo` con cuentas, campos, vistas y saldos iniciales, fechado el primer día del plan.
2. UNA unidad de trabajo con UNA acción `demo_seed`: cuentas, campos y opciones extra y todos los movimientos con `insertBatch` (un lote `capture` por día de ventas, los lotes `import` y un lote `demo` por día con el resto, para que el `seq` de cada cuenta siga el orden de las fechas y `recorded_at` caiga ese día).
3. La historia (ediciones, anulaciones con motivo, una restauración, lote "Día duplicado" anulado, fusión de opciones, renombre, campo desactivado, cuenta archivada) con los servicios públicos y un reloj guionizado: cada acción de historial lleva la fecha en que ocurre en el plan.

Si algo falla tras crear el espacio, se borra entero (`workspaces.purge`). Además del colmado y el despacho hay un tercer perfil, **"Finanzas de la casa"** (plantilla Finanzas personales: salario quincenal, ahorro, tarjeta, un estado de cuenta importado y un viaje anotado en la tabla de captura). Volúmenes con ancla 2026-11-27: colmado ≈ 2 400 movimientos, despacho ≈ 620, personal ≈ 510 (el rango 1 800–2 600 se cumple por perfil grande, no en total). Si no había respaldo verificado, se registra uno de hace 41 días para que el recordatorio salga vencido. Solo las tarjetas pasan por saldo negativo; caja y bancos nunca (prueba). Tiempo en Node: colmado ≈ 0,6–0,9 s.

### 6.1 Perfil "Colmado La Esquina" (plantilla Negocio pequeño)

| Elemento | Generación |
|---|---|
| Cuentas | Caja (saldo inicial RD$ 15,000), Banco (RD$ 120,000), Tarjeta de crédito (−RD$ 8,500, saldo inicial negativo) |
| Ventas diarias | Un **lote de captura** por día en Caja con 3–6 filas ("Ventas mañana", "Ventas tarde", "Ventas recargas", "Ventas a crédito cobradas"); total diario ~ N(RD$ 32,000, 6,000), sábado ×1.4, domingo ×0.7, cerrado 1 ene y Viernes Santo; total de control = suma (y 4 días con descuadre aceptado de RD$ 50–200) |
| Compras de mercancía | 2–3 por semana, Caja o Banco, a 6 distribuidoras ficticias (campo Contacto), RD$ 8,000–45,000 |
| Fijos mensuales | Alquiler día 1 (RD$ 35,000, Banco), electricidad día 5–8 (RD$ 7,500–12,000), agua, internet/teléfono (RD$ 2,300), impuestos día 20 (≈ 4 % de ventas del mes), contador externo (RD$ 6,000) |
| Nómina | Quincenal días 15 y 30: 2 empleados (RD$ 9,500 y 8,000 cada quincena), Caja; doble sueldo en diciembre |
| Transferencias | Depósito Caja → Banco lunes y jueves (≈ 70 % del efectivo acumulado, redondeado a RD$ 1,000); pago de tarjeta Banco → Tarjeta día 25 |
| Gastos con tarjeta | 4–8 al mes (combustible, suministros) |
| Campos | Categoría (según plantilla), Método de pago, Contacto, Número de factura (60 % de compras, `B01########`), Conciliado (sí en el 85 % de lo de Banco con más de 10 días) |
| Anulados | 6 movimientos con motivo ("Registrado dos veces", "Monto equivocado", "Era de la otra cuenta") y 1 lote de captura anulado entero ("Día duplicado") |
| Ediciones | 10 movimientos con una edición posterior para que el historial tenga contenido |

### 6.2 Perfil "Estudio Creativo Brisa, SRL" (plantilla Despacho contable/cliente)

Un cliente de servicios de un contador independiente; el espacio lleva `ownerName` del cliente y la plantilla de despacho.

| Elemento | Generación |
|---|---|
| Cuentas | Banco operativo (RD$ 310,000), Tarjeta empresarial (RD$ 0), Caja chica (RD$ 10,000). Multimoneda queda fuera de la demo |
| Ingresos | 6–12 facturas cobradas al mes de 9 clientes ficticios (campo Contacto), RD$ 18,000–160,000, cobros con 0–45 días de retraso respecto a la fecha de la factura (campo fecha "Fecha de factura"), campo NCF (texto) |
| Gastos | Nómina mensual (5 personas), alquiler de oficina, software (suscripciones), retenciones e impuestos mensuales, publicidad, mantenimiento; Centro de costo (Diseño, Producción, Administración) |
| Caja chica | Reposición mensual Banco → Caja chica (RD$ 10,000) y 10–20 gastos menores |
| Conciliado | Sí en lo de más de 15 días; no en el mes actual (para que el filtro guardado "No conciliados" muestre algo) |
| Importación | Un lote `import` de un mes histórico (simula un CSV traído desde Excel) |
| Anulados | 4 con motivo |

Primer arranque: si no hay espacios, P-01 muestra dos tarjetas grandes ("Empezar mi espacio" y "Ver con datos de ejemplo: Colmado / Despacho"). Los espacios demo llevan un distintivo "Ejemplo" y se archivan con un toque.

---

## 7. Plan de trabajo en oleadas

Reglas de propiedad: **una carpeta = un dueño por oleada**. Fuera de su carpeta un agente solo puede crear su archivo de cadenas `src/i18n/es/<ns>.ts` y sus pruebas. Si necesita un cambio en un contrato ajeno, lo pide al orquestador, que lo aplica o lo delega. Cada oleada cierra con `pnpm lint && pnpm test && pnpm build` en verde.

### Oleada 1 — Cimientos y contratos (paralelo, 4 agentes)

| Agente | Modelo | Propiedad | Entrega | Contrato que debe existir al terminar |
|---|---|---|---|---|
| **1A Andamiaje** | Sonnet medium | raíz (`package.json`, configs, `index.html`, `public/`, `scripts/`), `src/main.tsx`, `src/app/**`, `src/i18n/index.ts`, `src/i18n/format.ts`, `src/i18n/es/{index,common}.ts`, `src/test/{setup,architecture.test}.ts` | Vite 8 + React 19 + TS 7 estricto + Vitest + PWA (prompt) + hash router desde el registro (con una feature de prueba), shell vacío con barra inferior/lateral y FAB que leen el registro, `CuadraProvider`/`useCuadraQuery` | `app/registry/types.ts` y `app/data/*` con las firmas de 5.1–5.2 |
| **1B Contratos del núcleo** | Opus high | `src/core/{index,ports,types,errors,result,money,dates,ids,text,events,uow,recipes}.ts`, `src/core/sql/**`, `src/core/services/*.ts` (stubs), `src/i18n/es/errors.ts`, `src/test/harness.ts` | Tipos y firmas exactas de la sección 3; `Money`, `dates`, `ids`, `compileFilter` **implementados con sus pruebas** (1–15); cada servicio como stub que lanza `not_implemented`; `createCuadra` cableado | Todo `src/core/index.ts` compila; `createTestCuadra` funciona con el driver de 1C |
| **1C Datos** | Opus medium | `src/data/**` | `001_init.sql` (sección 2.2), `migrate.ts` (pruebas 16–21), `nodeDriver`, `wasmDriver` + `db.worker.ts` + `tabLock` + `idbStore` + respaldo `:memory:`+IDB, `mutex`, `openDatabase()` | `SqlDriver` según 3.1 (copiado literal de este documento hasta que 1B lo publique) |
| **1D Sistema de diseño** | Opus medium | `src/ui/**`, `src/features/_gallery/**` | `tokens.css` (DESIGN.md), primitivas, `ui/domain` (AmountKeypad, MoneyText, FieldInput, FilterChips, PeriodPicker), gráficas SVG; galería en `#/_ui` con claro/oscuro y 360 px | Props tipadas de cada componente; `ui/index.ts` |

Orden interno: 1B publica `ports.ts` y `types.ts` en la primera hora; 1C y 1D se basan en este documento mientras tanto.

### Oleada 2 — Núcleo con pruebas primero (paralelo, 4 agentes + 1)

| Agente | Modelo | Propiedad | Pruebas que hace pasar |
|---|---|---|---|
| **2A Movimientos** | Opus high | `core/services/{transactions,batches,validation,audit}.ts` | 28–53, 78–85 |
| **2B Estructura** | Opus medium | `core/services/{workspaces,accounts,fields,settings,templates}.ts`, `src/templates/**` | 22–27, 54–65, 86–89 |
| **2C Consultas e informes** | Opus high | `core/services/{queries,reports,views}.ts`, `core/export/**`, `core/recipes.ts` (resolución/validación) | 66–77 |
| **2D Respaldo, importación, demo** | Opus medium | `core/services/{backup,importCsv}.ts`, `core/services/backup-upgrades/**`, `core/demo/**` | 90–105 (las que necesitan 2A/2B se activan al integrarse; mientras, con `it.todo`) |
| **2E Hooks compartidos y shell real** | Sonnet medium | `src/app/**` | `hooks.ts` de 5.1, `boot.ts` real con `openDatabase`, `TabLockScreen`, `UpdatePrompt`, `BootError`, selector de espacio |

Dependencias: 2A antes de cerrar 2D (demo e importación usan `createMany`). 2B y 2C son independientes de 2A salvo por el harness. El orquestador integra en este orden: 2B → 2A → 2C → 2D.

Cierre real de la Oleada 2: se sumó **2F Login local y cifrado** (`core/crypto.ts`, `core/services/auth.ts`, `i18n/es/auth.ts`). Los datos de ejemplo (`core/demo/**`, `services/demo.ts`) los terminó el integrador. Ningún servicio queda en `not_implemented` (el código se retiró de `ErrorCode`).

### Oleada 3 — Pantallas por área (paralelo, 7 agentes)

Contratos previos: `Cuadra` completo, `app/data/hooks.ts`, `app/registry`, `ui`. Cada agente crea `src/features/<x>/**` y `src/i18n/es/<x>.ts`, nada más.

| Agente | Modelo | Features | Pantallas |
|---|---|---|---|
| **3A Captura** (pieza estrella) | Opus high | `capture` | P-06 con teclado numérico propio en móvil (monto primero, expresión `+`/`−`, chips de cuenta y categoría, avisos suaves en vivo, "Guardar y otro"), P-08, P-07 tabla con teclado (Tab/Enter), virtualizada, pegado desde Excel, total de control y diferencia en vivo |
| **3B Inicio y resumen** | Opus medium | `home`, `insights` | P-03 con tarjetas del registro (saldo grande con sparkline, entradas/salidas del mes como filtros, flujo mensual, cuentas en negativo); P-10 periodo + agrupación + medida + gráfica intercambiable, guardar como vista |
| **3C Libro** | Opus medium | `ledger`, `accounts` | P-04 (tarjetas de cuenta, orden por arrastre, archivadas), P-05/listado por día con subtotales, saldo corrido, acciones al deslizar (duplicar, anular), barra de filtros + vistas guardadas, P-09 hoja con historial, anular/restaurar lote |
| **3D Informes e historial** | Sonnet medium | `reports`, `audit` | P-11 resumido/detallado/personalizado, vista imprimible con CSS `@media print` (PDF vía imprimir), CSV (papaparse) y XLSX (write-excel-file); P-12 con filtros y exportación |
| **3E Espacios y bienvenida** | Sonnet medium | `workspaces`, `onboarding` | P-01, P-02 (aviso de responsabilidad, plantilla con vista previa, moneda, saldos iniciales, "Cargar datos de ejemplo") |
| **3F Configuración, respaldo e importación** | Sonnet medium | `settings`, `backup`, `import` | P-13 (campos: crear/ordenar/desactivar/borrar, opciones: renombrar/fusionar con vista previa del número afectado, cuentas, vistas), P-14/P-15 (respaldo con descarga o `showSaveFilePicker`, restaurar con confirmación, recordatorio, almacenamiento persistente sí/no), P-18 asistente CSV en 5 pasos |
| **3G Cáscara Tauri** | Sonnet medium | `src-tauri/**`, `src/data/tauri/**` | sección 7.3 |

### Oleada 4 — Integración y calidad

- **4A Integración** (Opus medium): datos de ejemplo en primer arranque, recorridos de punta a punta, arreglos de contratos.
- **4B E2E** (Sonnet medium): Playwright en 390×844 y 1440×900, claro y oscuro: crear espacio desde plantilla, registrar con teclado propio, captura en tabla con descuadre, transferencia, anular y restaurar, filtro guardado, resumen por categoría, informe a CSV, respaldo y restauración, importación CSV, segunda pestaña bloqueada.
- **4C Revisión adversarial** (Opus high): invariantes de la sección 4.1 buscando cómo romperlos desde la UI; accesibilidad (foco, contraste, objetivos de 44 px); rendimiento con el perfil colmado.

### Oleada 5 — Publicación

Documentación (README, LICENSES con atribuciones), GitHub Pages (`base: './'`), binarios Tauri Linux si da tiempo. Android nativo queda fuera (faltan NDK y JDK 21); la PWA cubre Android.

### 7.3 Qué va en Tauri

Solo lo que el navegador del sistema no da:

```
src-tauri/
├── Cargo.toml        # tauri = "~2.12", tauri-build = "~2.7", rusqlite = { version = "0.43", features = ["bundled"] },
│                     # tauri-plugin-dialog = "~2.8", tauri-plugin-fs = "~2.7", serde, serde_json
│                     # NUNCA dejar que cargo suba a 3.0.0-alpha: rangos con "~"
├── tauri.conf.json   # identifier, ventana 1200×800 min 360×640, frontendDist ../dist, devUrl http://localhost:5173
├── capabilities/default.json   # core:default, dialog:allow-save, dialog:allow-open, fs:allow-write-file / read-file (scope $DOWNLOAD, $DOCUMENT)
└── src/
    ├── main.rs       # llama a cuadra_lib::run()
    ├── lib.rs        # Builder + plugins + manage(DbState) + invoke_handler
    └── db.rs         # conexión rusqlite en Mutex, en app_data_dir()/cuadra.sqlite3
```

Comandos (reciben el MISMO SQL que el núcleo envía al worker):

| Comando | Firma | Nota |
|---|---|---|
| `db_open` | `() -> DbInfo { sqlite_version, path }` | abre, `foreign_keys=ON`, `journal_mode=WAL` |
| `db_all` | `(sql: String, params: Vec<Value>) -> Vec<Map<String, Value>>` | parámetros JSON → `rusqlite::types::Value` |
| `db_run` | `(sql, params) -> { changes }` | |
| `db_run_many` | `(sql, rows: Vec<Vec<Value>>) -> { changes }` | sentencia preparada reutilizada |
| `db_exec` | `(sql: String)` | migraciones, `BEGIN IMMEDIATE`, `COMMIT`, `ROLLBACK` |
| `db_export` | `() -> Vec<u8>` | `VACUUM INTO` archivo temporal y lectura |

`tauriDriver.ts` implementa `SqlDriver` con `invoke` y el mismo `mutex.ts` que el worker (las transacciones son `BEGIN`/`COMMIT` explícitos sobre la única conexión). La detección en `openDatabase()`: `'__TAURI_INTERNALS__' in window` → Tauri; si no, worker OPFS; si OPFS falla, `:memory:` + IndexedDB. Respaldo en escritorio: `dialog.save()` + `fs.writeTextFile`. La lógica de negocio no entra en Rust.

---

## 8. Decisiones de arquitectura (ADR)

### ADR-1 · La lógica vive en TypeScript, no en Rust

**Contexto.** La especificación v2 decía "backend en Rust". El objetivo real es una demo web/PWA instalable en Android y un escritorio Windows/Linux, con una base que va a cambiar mucho.
**Decisión.** Núcleo de dominio en TS puro, probado con Vitest sobre `node:sqlite` (misma versión de SQLite que el WASM). Rust es una cáscara de 6 comandos SQL y diálogos.
**Por qué.** (1) La web/PWA no puede ejecutar Rust sin compilar el núcleo a WASM, lo que duplica la cadena de build y complica la depuración. (2) Un solo lenguaje para dominio y UI permite que la UI use `Money`, `recipes` y tipos sin puentes ni serialización. (3) Las pruebas del núcleo corren en milisegundos sin `cargo`. (4) El rendimiento lo da SQLite, no el lenguaje del servicio.
**Consecuencias.** Si mañana hace falta un núcleo nativo (Android sin WebView, servidor de sincronización), el contrato es el SQL + el formato de respaldo, ambos independientes de TS. La especificación v2 se cumple en espíritu: Rust + TS + SQLite.

### ADR-2 · Cuenta como estructura, fondo como dimensión

**Contexto.** La especificación dejaba abierto si un "libro" es un fondo o una cuenta (F-12, sección 12), con la variante de tener ambas cosas cuadrando entre sí.
**Decisión.** La **Cuenta** es la única estructura con saldo propio, `seq` y saldo inicial: dónde está el dinero (Caja, Banco, Tarjeta). **Fondo, centro de costo, categoría, contacto, método de pago** son campos de lista (dimensiones) con `role` opcional que da pistas a la UI.
**Por qué.** Una cuenta se cuadra contra algo físico (la gaveta, el estado del banco); un fondo no. Con dimensiones, el saldo por fondo es un `GROUP BY` (y siempre cuadra con el de cuentas porque es el mismo conjunto de filas), sin duplicar movimientos ni inventar "transferencias entre fondos". Un despacho contable usa centro de costo; una organización usa fondo; un negocio usa categoría y contacto. Ninguno necesita código propio.
**Consecuencias.** "Préstamo entre fondos" no es una transferencia sino dos movimientos o un campo; el informe por fondo agrupa por la dimensión `fund`. Saldo por contacto (quién me debe) sale de agrupar por `contact`; las cuentas por cobrar formales quedan fuera.

### ADR-3 · SQL en el núcleo detrás de un puerto asíncrono único

**Decisión.** Un `SqlDriver` asíncrono (`all/get/run/runMany/exec/transaction/exportBytes`) definido en `core/ports.ts`; el SQL de los servicios vive en el núcleo y es dialecto SQLite ≥ 3.45. Adaptadores: worker WASM (OPFS sahpool), `:memory:`+IndexedDB, `node:sqlite`, Tauri/rusqlite.
**Por qué.** Hay un solo motor en todas las plataformas, así que una capa de repositorios por adaptador solo añadiría código. Asíncrono porque el worker y `invoke` lo son; síncrono no aporta nada en Node.
**Consecuencias.** Los servicios son probables con el driver de Node sin mocks. Las consultas complejas (resumen, saldo corrido) usan SQL real con índices, no bucles en JS.

### ADR-4 · EAV tipado para los campos personalizables

**Decisión.** `transaction_field_values (transaction_id, field_id, value_text|number|date|option_id|bool)`.
**Por qué.** Ver 2.1: FK a opciones (renombrar y fusionar baratos, "nunca usado" lo responde el motor), selección única por clave primaria, índices por campo para agrupar, tipos verificados. Una columna JSON obligaría a `json_extract` sin índice y a validar en JS.
**Consecuencias.** Leer un movimiento con valores son dos consultas (o una con `json_group_object`); se resuelve en `core/sql/rows.ts`.

### ADR-5 · Nada se borra: anular, desactivar, historial solo-añadir y `seq` sin huecos

**Decisión.** Movimientos se anulan; campos y opciones se desactivan; vistas se ocultan; el historial solo crece (triggers). `seq` se reserva en la misma transacción que el `INSERT` y **la cuenta de un movimiento no se cambia** (la UI ofrece "Mover a otra cuenta" = anular + crear, enlazados en el historial).
**Por qué.** Es lo que pide la especificación (F-16, F-29, F-53, F-59) y lo que da confianza a un contador. Permitir cambiar de cuenta dejaría huecos en `seq` o exigiría renumerar.
**Consecuencias.** El único escape es el modo mantenimiento (restaurar todo, borrar un espacio). El historial es honesto contra errores, no contra fraude: quien tenga el archivo puede alterarlo (F-60 queda para después con una cadena de hashes).

### ADR-6 · TanStack Query + eventos por tabla; zustand solo para la interfaz

**Decisión.** Las lecturas son consultas de TanStack Query con `meta.tables`; el núcleo emite `ChangeEvent` tras cada COMMIT y el proveedor invalida lo que dependa de esas tablas.
**Por qué.** Nadie invalida a mano y añadir una pantalla no exige conocer quién escribe qué. Ver 5.1.
**Consecuencias.** Invalidación algo gruesa (por tabla y espacio); con decenas de miles de filas locales es imperceptible.

### ADR-7 · Features que se registran solas

**Decisión.** Cada `src/features/<x>/index.ts` exporta un descriptor (`routes`, `nav`, `quickActions`, `homeCards`, `settingsSections`); el shell los descubre con `import.meta.glob`. Las features no se importan entre sí.
**Por qué.** Siete agentes en paralelo sin tocar un archivo común; añadir o quitar un módulo es crear o borrar una carpeta. Prepara el modelo de "módulos activables por espacio" (`flag`).
**Consecuencias.** Lo compartido sube a `ui/domain` o `app/data`; la prueba de arquitectura lo vigila.

### ADR-8 · Respaldo como JSON versionado de tablas

**Decisión.** El respaldo es un JSON (`format`, `formatVersion`, `schemaVersion`, `checksum`, tablas como columnas + filas), no el archivo `.sqlite`.
**Por qué.** Es el mismo en web, escritorio y Android; se puede inspeccionar antes de restaurar (P-14 muestra qué contiene); permite importar un solo espacio con ids nuevos; se verifica al crearlo (F-84). El `.sqlite` crudo depende del adaptador (OPFS no expone un archivo descargable sin exportar).
**Consecuencias.** Las migraciones que cambien la forma de una tabla deben traer su *upgrader* de respaldo. `exportBytes()` se reserva para copias automáticas internas antes de migrar o restaurar.

### ADR-9 · OPFS sahpool en worker con candado entre pestañas; nunca un segundo libro

**Decisión.** `opfs-sahpool` funciona sin COOP/COEP (GitHub Pages) pero admite una sola conexión. `navigator.locks.request('cuadra-db')` protege la apertura; la pestaña sin candado muestra "Cuadra está abierta en otra pestaña · Usar aquí" (BroadcastChannel → la otra pestaña hace `pauseVfs()` y suelta el candado). Sin OPFS: `:memory:` hidratado desde IndexedDB y volcado con espera de 500 ms tras cada transacción y en `visibilitychange`. Nunca `kvvfs`.
**Por qué.** Probado en la verificación técnica: una segunda pestaña rompe el access handle y caer a otro almacenamiento crea datos divergentes.
**Consecuencias.** `navigator.storage.persist()` al arrancar y estado visible en Ajustes.
