# Cuadra: investigación de proyectos y decisiones de stack

Fecha de verificación: 2026-11-26. Versiones y licencias tomadas de `pnpm view`, `cargo info` y `gh api`.

## 1. Resumen ejecutivo

1. Cuadra es una libreta financiera (libro de caja honesto, no partida doble) para negocios pequeños y contadores independientes.
2. Los dos proyectos más cercanos a un libro de caja simple, Actual Budget y ezBookkeeping, son MIT: se pueden estudiar y adaptar con aviso de licencia.
3. La mayoría de las apps de finanzas libres son AGPL o GPL (Firefly III, Sure, Paisa, Frappe Books, Bigcapital, Cashew, Ivy Wallet, etc.): solo se toman ideas, nunca código.
4. Las apps comerciales de libro de caja (Khatabook, OkCredit) enseñan el patrón móvil ganador: botones grandes verde Entrada y rojo Salida, saldo siempre visible.
5. Stack: TypeScript estricto, React 19, Vite, pnpm; núcleo de dominio en TS puro probado con Vitest.
6. SQLite detrás de un puerto asíncrono único: sqlite-wasm con OPFS (opfs-sahpool) en el navegador y rusqlite nativo en Tauri 2.
7. PWA instalable en Android; Tauri 2 solo como cáscara fina de escritorio; Android nativo queda fuera de esta noche por falta de NDK y JDK compatible.
8. Todas las dependencias elegidas son permisivas (MIT, ISC, Apache-2.0, OFL para fuentes) y verificadas.

## 2. Proyectos de licencia permisiva

| Nombre | Repo | Licencia | Stack | Qué tomamos |
|---|---|---|---|---|
| Actual Budget | [actualbudget/actual](https://github.com/actualbudget/actual) | MIT | TypeScript, React, SQLite | Local-first con sync como capa aparte tras un puerto; reglas de importación; montos enteros; recurrentes; monorepo con núcleo sin UI (loot-core). Se pueden adaptar utilidades con aviso de licencia. |
| ezBookkeeping | [mayswind/ezbookkeeping](https://github.com/mayswind/ezbookkeeping) | MIT | Go, Vue, PWA | Flujos de captura rápida con pulgar; plantillas de transacción; transferencias como tipo propio fuera de ingresos/gastos; etiquetas como dimensión; mapeos de importación y categorías predeterminadas (traducir al español). La interfaz Vue no se reutiliza. |
| Fava | [beancount/fava](https://github.com/beancount/fava) | MIT | Python, Svelte | Filtros globales por tiempo, cuenta y etiqueta aplicados a todos los informes; árbol de cuentas con saldos. Referencia de estilo, no ligado a React. |
| Ledger | [ledger/ledger](https://github.com/ledger/ledger) | BSD-3-Clause | C++ | Formato de texto legible como exportación de respaldo; saldo por periodo. Solo inspiración conceptual (GitHub lo reporta como NOASSERTION; el texto de LICENSE es BSD). |
| Financier | [financier-io/financier](https://github.com/financier-io/financier) | MIT | Angular, PouchDB | Sobres mensuales simples. Solo ideas. |
| dinero.js | [dinerojs/dinero.js](https://github.com/dinerojs/dinero.js) | MIT | TypeScript | Dinero como entero más exponente; reparto (allocate) sin perder centavos. Dependencia o patrón propio. |
| currency.js | [scurker/currency.js](https://github.com/scurker/currency.js) | MIT | JavaScript | Formateo y parseo con separadores locales. Dependencia directa, más pequeña. |
| PapaParse | [mholt/PapaParse](https://github.com/mholt/PapaParse) | MIT | JavaScript | Detección de delimitador y cabeceras. Dependencia directa para importar CSV. |
| SheetJS Community Edition | [SheetJS/sheetjs](https://github.com/SheetJS/sheetjs) | Apache-2.0 | JavaScript | Lectura de hojas. El paquete npm `xlsx` está viejo (0.18.5, CVE conocidos); evitarlo. |
| write-excel-file | [catamphetamine/write-excel-file](https://github.com/catamphetamine/write-excel-file) | MIT | JavaScript | Exportar informes a XLSX con formato de moneda y anchos. Dependencia directa. |
| ExcelJS | [exceljs/exceljs](https://github.com/exceljs/exceljs) | MIT | JavaScript | Informes con estilos y fórmulas; solo si hace falta leer XLSX. Es pesado. |
| TanStack Table | [TanStack/table](https://github.com/TanStack/table) | MIT | TypeScript | Agrupar por dimensión con totales; columnas generadas desde campos personalizables. |
| react-datasheet-grid | [nick-keller/react-datasheet-grid](https://github.com/nick-keller/react-datasheet-grid) | MIT | React | Captura rápida tipo hoja con teclado y pegado desde Excel. |
| Glide Data Grid | [glideapps/glide-data-grid](https://github.com/glideapps/glide-data-grid) | MIT | React, canvas | Rejilla rápida para miles de filas; opción si la anterior se queda corta. |
| Recharts | [recharts/recharts](https://github.com/recharts/recharts) | MIT | React | Gráficas declarativas. Descartada como primera opción (pesada, aspecto genérico). |
| uPlot | [leeoniya/uPlot](https://github.com/leeoniya/uPlot) | MIT | JavaScript | Series de saldo largas en móvil sin lag. Opcional. |
| Observable Plot | [observablehq/plot](https://github.com/observablehq/plot) | ISC | JavaScript, d3 | Gráficas analíticas con poco código. Alternativa. |
| @sqlite.org/sqlite-wasm | [sqlite/sqlite-wasm](https://github.com/sqlite/sqlite-wasm) | Apache-2.0 | WebAssembly | SQLite en el navegador con persistencia OPFS en un Worker. Elegida. |
| wa-sqlite | [rhashimoto/wa-sqlite](https://github.com/rhashimoto/wa-sqlite) | MIT | WebAssembly | VFS sobre IndexedDB. Descartada: paquete npm abandonado, sin licencia en metadatos y API asíncrona más compleja. |
| Sossoldi | [RIP-Comm/sossoldi](https://github.com/RIP-Comm/sossoldi) | MIT | Dart | Pantallas móviles de resumen con tarjetas; añadir transacción en pocos pasos. Solo ideas. |
| Hisabi | [hisabi-app/hisabi](https://github.com/hisabi-app/hisabi) | MIT | PHP | Captura desde notificaciones, para fases futuras. Solo ideas. |

Total permisivos: 21.

## 3. Proyectos copyleft o cerrados (solo ideas)

> **Aviso de sala limpia.** De estos proyectos NO se copia, traduce ni adapta código, textos, esquemas ni recursos gráficos. Solo se toman ideas de comportamiento descritas en este documento y se reimplementan desde cero. Quien implemente no debe abrir su código fuente mientras lo hace.

| Nombre | Repo | Licencia | Qué se toma (idea) |
|---|---|---|---|
| Maybe Finance | [maybe-finance/maybe](https://github.com/maybe-finance/maybe) | AGPL-3.0 (archivado 2025-07) | Cuentas por tipo con saldo diario calculado; gráfica de saldo con comparación de periodos; ingreso/gasto/transferencia. |
| Sure | [we-promise/sure](https://github.com/we-promise/sure) | AGPL-3.0 | Inicio con un número grande, sparkline y selector de periodo; limpieza de filas con error en la importación; lista agrupada por día con subtotal; reglas con "aplicar a pasados". Lección: no depender de la nube. |
| Firefly III | [firefly-iii/firefly-iii](https://github.com/firefly-iii/firefly-iii) | AGPL-3.0 | Tres tipos de movimiento; reglas con condiciones y acciones y vista previa; importador con mapeo guardado; recurrentes como borrador a confirmar. |
| Wallos | [ellite/Wallos](https://github.com/ellite/Wallos) | GPL-3.0 | Calendario de pagos próximos; tarjeta por compromiso recurrente. |
| Paisa | [ananthakumaran/paisa](https://github.com/ananthakumaran/paisa) | AGPL-3.0 | Catálogo de reportes; flujo de caja mensual apilado; tarjetas que responden una pregunta; búsqueda con sintaxis simple (cuenta:Caja monto>1000); panel de validaciones. |
| hledger | [hledgerorg/hledger](https://github.com/simonmichael/hledger) | GPL-3.0 | Periodos flexibles; mapeo CSV con reglas declarativas. |
| Frappe Books | [frappe/books](https://github.com/frappe/books) | AGPL-3.0 | Esquemas declarativos que generan formularios; asistente de inicio con vista previa; "+ crear nuevo" dentro de un selector; plantilla CSV de importación; escritorio con SQLite local. |
| Bigcapital | [bigcapitalhq/bigcapital](https://github.com/bigcapitalhq/bigcapital) | AGPL-3.0 | Conciliación en dos paneles; selector de organización para contadores; paquete de exportación para el contador. Lección: el alcance ERP lo vuelve pesado. |
| Akaunting | [akaunting/akaunting](https://github.com/akaunting/akaunting) | BUSL-1.1 (no permisiva) | Módulos activables por espacio; categorías con color y tipo; widgets por usuario. Lección: licencia confusa, Cuadra mantiene licencia limpia. |
| Cashew | [jameskokoska/Cashew](https://github.com/jameskokoska/Cashew) | GPL-3.0 | Estética móvil con tarjetas, color por categoría, tema dinámico; deslizar fila para duplicar/anular; selección múltiple; "+" flotante con monto primero; presupuestos con marcador de ritmo. |
| Oinkoin | [emavgl/oinkoin](https://github.com/emavgl/oinkoin) | GPL-3.0 | Vista mínima por mes; respaldo prominente con recordatorio; funciona sin cuenta ni red como argumento de venta. |
| GnuCash | [Gnucash/gnucash](https://github.com/Gnucash/gnucash) | GPL-2.0-or-later (GitHub: NOASSERTION) | Conciliación con contador de diferencia; movimiento dividido en varias líneas; "desde la última vez" para recurrentes; avisar (no prohibir) al editar periodo cerrado. Lección: el vocabulario débito/crédito asusta a no contadores. |
| HomeBank | [homebank](https://www.gethomebank.org/) | GPL-2.0-or-later (sin verificar por API) | Fila de captura rápida arriba con flujo solo teclado; autoasignación por patrón; filtros guardados y estado; detección de duplicados al importar. |
| KMyMoney | [KDE/kmymoney](https://invent.kde.org/office/kmymoney) | GPL-2.0-or-later (sin verificar por API) | Columna de saldo corrido que respeta filtros; contacto como entidad con valores por defecto; constructor de informes guardables; proyección futura. |
| Money Manager Ex | [moneymanagerex/moneymanagerex](https://github.com/moneymanagerex/moneymanagerex) | GPL-2.0 | Un solo archivo de base de datos como los datos del usuario; panel de widgets configurables; campos personalizados por tipo; adjuntos por referencia; filtros con nombre. |
| Ivy Wallet | [Ivy-Apps/ivy-wallet](https://github.com/Ivy-Apps/ivy-wallet) | GPL-3.0 | Tres mosaicos (saldo, entradas, salidas) que filtran la lista; hoja de captura con teclado numérico primero; tarjetas de cuenta deslizables; pagos planeados con "pagar ahora". |
| Kresus | [kresusapp/kresus](https://github.com/kresusapp/kresus) | AGPL-3.0 | Detección de duplicados con umbral y pantalla para fusionar; sugerencias de categoría como chip; gráficas con un control de fechas compartido; alertas de saldo. |
| Khatabook, OkCredit, Treinta, Vyapar, CashBook (apps comerciales) | Cerrado | Propietaria | Dos botones grandes verde Entrada y rojo Salida siempre visibles; encabezado con saldo neto, entradas y salidas del periodo (chips día/semana/mes); saldo corrido tras cada fila; recordatorio diario; compartir estado de cuenta en un toque; libreta de clientes y proveedores como pull principal. Solo se verificó Khatabook y OkCredit; el resto está sin verificar. |
| Skrooge | [KDE/skrooge](https://invent.kde.org/office/skrooge) | GPL-3.0 (sin verificar por API) | Edición masiva con vista previa; etiquetas libres con nube; páginas de widgets; historial deshacer/rehacer, que en Cuadra será un registro con "revertir". |

Total copyleft o cerrados: 19 (la fila de apps comerciales cuenta como una).

Total general listado: 40.

## 4. Ideas que adoptamos en Cuadra

### Captura
- Móvil: dos botones grandes siempre visibles, verde Entrada y rojo Salida; un toque, monto, nota opcional, menos de 5 segundos.
- Hoja de captura con teclado numérico propio y el monto primero; chips para cuenta y dimensiones.
- Escritorio: fila rápida arriba y captura por lotes en tabla con teclado y pegado desde Excel (lote anulable).
- "+ crear nuevo" dentro de cualquier selector para no salir del formulario.
- Duplicar movimiento; deslizar fila para duplicar o anular; selección múltiple con barra de acciones.
- Validaciones suaves: se resalta, se explica y se permite guardar.
- Saldo corrido visible tras cada fila para comparar con la caja física.

### Modelo
- Espacio, Cuenta, Movimiento; fondo, centro, categoría y contacto como dimensiones de lista configurables.
- Tipos entrada, salida, transferencia y saldo inicial; transferencia y saldo inicial fuera de los totales.
- Montos enteros en unidad menor, ids UUID, anular en lugar de borrar, historial que solo crece con "revertir".
- Movimiento dividido en líneas que suman el total (idea de GnuCash), mostrado como una sola fila.
- Plantillas JSON, esquemas declarativos para campos personalizables, y activación de módulos por Espacio.
- Vocabulario sin jerga contable.

### Informes
- Resumen configurable por tarjetas que responden una pregunta; mosaicos de periodo que actúan como filtro.
- Filtros globales y guardados con nombre; búsqueda con sintaxis simple.
- Informes resumido y detallado; exportación a impresión/PDF, CSV y XLSX; paquete de exportación para el contador.
- Gráficas de saldo en el tiempo, barras de entradas contra salidas y dona por dimensión, en SVG propio.
- Compartir estado de cuenta de un periodo con un toque.

### Importación
- Asistente: subir, mapear columnas, mapear valores desconocidos, vista previa, importar.
- Filas con error en rojo y corrección en línea; mapeos guardados por fuente; plantilla CSV descargable.
- Detección de duplicados (misma fecha, monto y contacto) con casilla para omitir.
- Reglas (si contiene X, asignar Y) con contador de a cuántos movimientos afectaría.

### Respaldo
- Archivo único como datos del usuario; respaldo y restauración a archivo sin servidor.
- Recordatorio periódico de respaldo y mensaje claro de almacenamiento persistente.
- Sin sincronización en el núcleo: local-first y sin cuenta ni red como argumento de venta.

### Móvil
- Inicio con saldo grande, sparkline y selector de periodo deslizable.
- Tarjetas de cuenta deslizables con color e ícono; color por categoría y tema dinámico con tokens de diseño.
- Lista agrupada por día con subtotal; animaciones de entrada con View Transitions y CSS.
- PWA instalable con aviso de "Nueva versión disponible".

## 5. Decisiones de stack

| Pieza | Versión | Licencia | Uso |
|---|---|---|---|
| typescript | 7.0.2 | Apache-2.0 | Tipado estricto (`moduleResolution: bundler`, `target: es2024`) |
| vite | 8.4.0 | MIT | Bundler y servidor de desarrollo |
| @vitejs/plugin-react | 6.3.0 | MIT | React en Vite |
| react / react-dom | 19.3.1 | MIT | Interfaz |
| @types/react | 19.3.3 | MIT | Tipos |
| @types/node | 26.6.11 | MIT | Solo para pruebas del núcleo (`node:sqlite`) |
| @sqlite.org/sqlite-wasm | 3.54.1-build1 | Apache-2.0 | SQLite en navegador, VFS opfs-sahpool en Worker |
| vite-plugin-pwa | 2.0.0 | MIT | Service worker y manifest |
| workbox-window | 7.4.1 | MIT | Registro del SW y aviso de actualización |
| @vite-pwa/assets-generator | 2.0.0 | MIT | Iconos PWA |
| react-router | 8.5.3 | MIT | `createHashRouter` (sirve en GitHub Pages y Tauri) |
| zustand | 5.1.0 | MIT | Estado de interfaz |
| @tanstack/react-query | 5.108.4 | MIT | Consultas sobre el puerto, invalidación por tabla tocada |
| @tanstack/react-virtual | 3.14.28 | MIT | Tabla de captura y listas largas |
| uplot | 1.6.32 | MIT | Opcional, series largas (el resto en SVG propio) |
| write-excel-file | 4.1.1 | MIT | Exportación XLSX |
| papaparse / @types/papaparse | 5.7.1 / 5.5.2 | MIT | Importación y exportación CSV |
| date-fns | 4.4.0 | MIT | Fechas (guardadas como texto ISO YYYY-MM-DD) |
| lucide-react | 1.81.0 | ISC | Iconos |
| @fontsource-variable/inter, /fraunces | 5.3.0 | OFL-1.1 | Fuentes autoalojadas |
| motion | 14.14.0 | MIT | Opcional, gestos y hojas arrastrables en móvil |
| vitest | 5.1.2 | MIT | Pruebas del núcleo |
| @playwright/test | 1.65.1 | Apache-2.0 | Pruebas e2e |
| @tauri-apps/cli / @tauri-apps/api | 2.12.6 / 2.12.5 | Apache-2.0 OR MIT | Cáscara de escritorio |
| tauri (crate) / tauri-build (crate) | 2.12.7 / 2.7.6 | Apache-2.0 OR MIT | Runtime y compilación |
| rusqlite (crate, feature `bundled`) | 0.43.0 | MIT | SQLite nativo en Tauri |
| tauri-plugin-dialog / tauri-plugin-fs (crates) | 2.8.4 / 2.7.1 | Apache-2.0 OR MIT | Respaldo, restauración y exportación |

Decisiones de arquitectura derivadas de las pruebas:

- **Un solo puerto asíncrono** (`all`, `get`, `run`, `transaction(fn)`, `exportBytes`) con tres adaptadores: Worker con opfs-sahpool, `node:sqlite` envuelto en Promise (mismo SQLite 3.54.1 que el WASM, para las pruebas) y Tauri (rusqlite) más adelante. Migraciones como archivos `.sql` numerados aplicados con `PRAGMA user_version`.
- **Candado entre pestañas** con `navigator.locks.request('cuadra-db', ...)`: la segunda pestaña muestra "Cuadra está abierta en otra pestaña" con un botón "usar aquí" (BroadcastChannel y `pauseVfs`/`unpauseVfs`). Nunca caer a kvvfs en la segunda pestaña: crearía un libro divergente.
- **Respaldo sin OPFS**: sqlite-wasm con `:memory:` hidratado desde un blob en IndexedDB y volcado con `sqlite3_js_db_export` tras cada transacción. Llamar a `navigator.storage.persist()` y mostrar el estado en Ajustes.
- **Escritorio**: WebKitGTK no ofrece OPFS (comprobado), así que el adaptador de Tauri es SQLite nativo con comandos propios (`db_all`, `db_run`, `db_tx`, `db_export`) que reciben el mismo SQL.
- **PWA**: `registerType: 'prompt'`, `base: './'`, añadir `wasm` y `woff2` a `globPatterns` y subir `maximumFileSizeToCacheInBytes` a unos 5 MB.
- **Vite** debe excluir `@sqlite.org/sqlite-wasm` de `optimizeDeps`; el Worker se carga con `new Worker(new URL('./db.worker.ts', import.meta.url), { type: 'module' })`.
- Descartadas: wa-sqlite (npm abandonado, sin licencia declarada), sql.js (solo memoria; solo respaldo de último recurso), `xlsx` de npm 0.18.5 (CVE conocidos), Recharts (pesado y genérico), TanStack Router (complejidad innecesaria).

## 6. Bloqueos y pendientes

1. **Android con Tauri**: faltan NDK, cmdline-tools (no hay `sdkmanager` en `~/Android/Sdk`) y las variables `ANDROID_HOME`, `NDK_HOME` y `JAVA_HOME`. El JDK del sistema es OpenJDK 27, probablemente demasiado nuevo para Android Gradle Plugin; usar JDK 21 o el JBR de Android Studio. Todo se instala sin sudo, pero no se hizo; la PWA cubre Android en la demo.
2. **WebKitGTK sin OPFS**: el adaptador de escritorio debe ser SQLite nativo (rusqlite); web y escritorio comparten el SQL, no el adaptador.
3. **opfs-sahpool admite una sola conexión**: el candado Web Locks y el aviso de otra pestaña son obligatorios.
4. **Tauri 3.0.0-alpha** aparece como última en crates.io: fijar `2.x` explícitamente y no dejar que `cargo add` suba a la alfa.
5. **Playwright 1.65.1** espera Chromium build 1255 y la caché local solo tiene el 1248: usar `executablePath` o ejecutar `playwright install chromium` (sin sudo).
6. **Licencias sin verificar por API**: HomeBank, Skrooge y KMyMoney (estatus copyleft por información pública del proyecto); GnuCash y Akaunting figuran como NOASSERTION en GitHub, leídas del archivo LICENSE.
7. **UX sin verificar**: de las apps comerciales solo se revisó Khatabook y OkCredit; lo de Treinta, Vyapar y CashBook debe comprobarse probando las apps.
8. **Revisión pendiente de reutilización de código**: Actual Budget (utilidades de loot-core), Fava y Ledger merecen una revisión aparte antes de copiar nada; se debe añadir aviso de licencia a todo código adaptado.
9. **Fuera de la demo**: licencias y suscripciones, contraseña y cifrado, subida a Drive, asistente de IA, multiusuario y sincronización.
