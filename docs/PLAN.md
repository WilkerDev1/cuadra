# Plan de Cuadra

**Qué es:** una libreta financiera que vive en el dispositivo del usuario. Registra entradas y salidas, las encuentra con filtros, las resume en gráficas e informes y deja rastro de cada cambio. Pensada para negocios pequeños y medianos y para contadores independientes que llevan los libros de varios clientes.

**Estado:** demo funcional para iterar ideas. No es un producto terminado.

## 1. Qué se tomó de los documentos de origen y qué se cambió

Los documentos de origen (inventario, especificación v2 y su análisis crítico) son un buen catálogo de ideas. La demo los sigue donde ayudan y los corrige donde el propio análisis crítico señalaba un hueco.

| Tema | En los documentos | En Cuadra | Por qué |
|---|---|---|---|
| ¿Qué es un "libro"? | Sin decidir: fondo o cuenta | **Cuenta**: dónde está el dinero (Caja, Banco, tarjeta). "Fondo", "centro", "categoría" y "contacto" son **dimensiones** (campos de lista) | Era el hueco más serio del modelo. Una cuenta cuadra contra el banco; una dimensión da saldos por fondo sin duplicar estructura |
| "Proyecto" | Nombre dudoso (P2) | **Espacio** | Un contador tiene un espacio por cliente; un negocio, uno por empresa. No se confunde con "obra" |
| Público | Iglesias, luego negocios y personas | Genérico de verdad: negocio, despacho contable, organización, personal, en blanco | Lo específico vive en plantillas de datos, no en código |
| Tecnología | Rust + TypeScript + SQLite, escritorio | TypeScript + React + SQLite (WASM) como **web/PWA**, con Tauri 2 (Rust) como cáscara de escritorio | La misma base corre en navegador, se instala en Android como PWA y se empaqueta en escritorio. La lógica en TS se prueba rápido y no ata a una plataforma |
| Captura | Formulario + tabla de captura | Igual, más un **teclado numérico propio en móvil** como interacción estrella | En un negocio pequeño se registra con el teléfono en la mano |
| Importar desde Excel | Aplazado, luego "por decidir" con IA | **CSV con asignación de columnas y vista previa**, sin IA | El análisis crítico acierta: sin importación cada cliente empieza de cero. La IA choca con "los datos no salen del equipo" |
| Respaldo | Manual, recordatorio a 30 días | Exportar/restaurar a archivo + copia automática local antes de operaciones destructivas | Suficiente para la demo; la subida a Drive queda fuera |
| Inicio de sesión | Contraseña opcional + clave de recuperación | **Entra**: perfil local con contraseña, pantalla de bloqueo, clave de recuperación y bloqueo automático. La contraseña además **cifra los respaldos** (AES-GCM con clave derivada) | El equipo lo marcó como primordial para la V1. Para que no sea decorativa, protege lo que sale del equipo: el archivo de respaldo. La base local queda sin cifrar en la demo y la app lo dice |
| Licencias y suscripción | V1 / por decidir | **Fuera de la demo** | No se construye la caja antes de saber qué se cobra |
| Asistente de IA | Por decidir | **Fuera** | Costo, privacidad y ningún usuario lo pidió |
| Historial | "Evidencia" | Rastro de cambios honesto: sirve contra errores, no contra fraude | Así lo dice la v2 (F-59) y es lo correcto con datos locales |
| Informes | Motor personalizable con recetas | Resumido y detallado sobre el mismo motor de consultas; vistas guardadas | El motor configurable completo es la pieza más cara; se deja la base |

## 2. Alcance de la demo

**Entra**

- Espacios independientes, con plantillas (Negocio pequeño, Despacho contable, Organización, Finanzas personales, En blanco) y datos de ejemplo opcionales.
- Cuentas con saldo propio, orden manual, archivo, saldo negativo permitido con aviso.
- Movimientos: entrada, salida, transferencia entre cuentas, saldo inicial. Montos en unidad menor, dos fechas, número consecutivo por cuenta, notas.
- Campos personalizables (texto, número, fecha, lista, sí/no) que aparecen solos en formulario, filtros y agrupaciones. Desactivar en vez de borrar. Fusión de opciones.
- Captura: formulario rápido (teclado propio en móvil), tabla de captura con total de control y lotes anulables, duplicar, validaciones suaves, sugerencias de descripción.
- Editar con historial, anular y restaurar, historial por movimiento y general.
- Filtros combinables y vistas guardadas. Resumen configurable por periodo y por cualquier campo, con gráficas.
- Informes resumido y detallado; exportación a CSV/XLSX e impresión a PDF.
- Respaldo y restauración a archivo; importación de **CSV y Excel (.xlsx)** con mapeo de columnas y vista previa, anulable como lote.
- Inicio de sesión local: contraseña, clave de recuperación, bloqueo automático y respaldos cifrados.

**Lo primordial según el equipo (V1 funcional)** y dónde queda cubierto:

| Pedido | En Cuadra |
|---|---|
| Módulo de plantillas | Plantillas como archivos JSON, vista previa al crear un espacio, y "guardar este espacio como plantilla" para exportarla e importarla |
| Exportación e importación de documentos | Exportar informes y listados a PDF (impresión), Excel y CSV; importar movimientos desde Excel y CSV; respaldo completo o de un solo espacio |
| Login | Perfil local con contraseña y clave de recuperación (ver tabla de arriba) |
- Móvil y escritorio como ciudadanos de primera; claro y oscuro; instalable como PWA.

**Datos de ejemplo.** Un botón "Cargar datos de ejemplo" crea espacios ficticios con unos 14 meses de actividad creíble (un colmado, un cliente de despacho contable y unas finanzas personales), generados con semilla fija para que la demo sea siempre igual. Deben ejercitar **todas** las funciones, no solo llenar listas:

- Cuentas en positivo, una en negativo con su aviso, y una archivada.
- Entradas, salidas, transferencias y saldos iniciales; lotes de captura con total de control (uno con descuadre anotado); un lote importado desde Excel.
- Campos de los cinco tipos con valores reales, una opción renombrada, dos opciones fusionadas y un campo desactivado que aún aparece en lo histórico.
- Movimientos editados (con su historial), anulados con motivo y restaurados; posibles duplicados para ver el aviso.
- Vistas guardadas (filtros, resúmenes e informes) listas para abrir; meses con estacionalidad para que las gráficas cuenten algo.
- Un respaldo reciente registrado y otro vencido, para ver el recordatorio.

**Panel de escritorio.** El inicio en pantallas anchas no es la vista móvil estirada: es un panel propio, la pieza estrella del escritorio. Requisitos:

- Pocas piezas y bien jerarquizadas: una cifra protagonista (saldo), flujo de entradas y salidas por mes, evolución del saldo, reparto por categoría, cuentas con su tendencia, lo que pide atención (negativos, descuadres, respaldo vencido) y los últimos movimientos.
- Gráficas detalladas y con las que se puede interactuar: valores al pasar el cursor, cambio de periodo, comparación con el periodo anterior, y clic en una barra o categoría para abrir los movimientos que la forman.
- Los datos hablan y el texto calla: sin títulos de relleno, sin subtítulos que repiten el título, sin tarjetas idénticas en rejilla, sin párrafos explicativos. Cada rótulo que quede debe ganarse su sitio.
- Se revisa con capturas reales a 1440 y 1920 px, en claro y oscuro, con los datos de ejemplo, y se itera hasta que se vea bien.

**No entra (y por qué)**: ver tabla anterior. Además: multiusuario, sincronización, conciliación con archivo bancario, presupuestos, recurrentes automáticos, adjuntos, varias monedas. El modelo no los impide.

## 3. Cómo se trabaja

- Un orquestador planifica y revisa; agentes implementan por oleadas con propiedad de carpetas para no pisarse.
- Pruebas primero en el núcleo: ninguna regla de dinero sin prueba.
- Cada oleada termina con `pnpm lint`, `pnpm test` y `pnpm build` en verde, revisión adversarial y prueba en navegador real (móvil y escritorio).

| Oleada | Qué | Depende de |
|---|---|---|
| 0 | Investigación de proyectos abiertos, verificación de stack, dirección de diseño, arquitectura | — |
| 1 | Andamiaje (Vite, React, TS, Vitest, PWA), tokens y componentes base, puerto de datos + migración 001 | 0 |
| 2 | Núcleo de dominio con pruebas (dinero, cuentas, movimientos, campos, consultas, historial, plantillas, respaldo, importación) | 1 |
| 3 | Pantallas por área funcional en paralelo (inicio, cuentas, captura, resumen, informes, configuración, respaldo, onboarding) | 1, 2 |
| 4 | Integración, datos de ejemplo, revisión adversarial, pruebas en navegador, correcciones | 3 |
| 5 | Cáscara Tauri, documentación, publicación | 4 |

El detalle técnico está en [ARCHITECTURE.md](ARCHITECTURE.md), el visual en [DESIGN.md](DESIGN.md) y las fuentes estudiadas en [RESEARCH.md](RESEARCH.md).
