# Licencias de terceros

Este archivo lista las dependencias directas de Cuadra y los recursos de terceros que se distribuyen o se usan en el desarrollo. Las licencias de npm se leyeron del campo `license` de `node_modules/<paquete>/package.json`; las de las crates, del `Cargo.toml` de cada crate en el registro local de Cargo, con la versión fijada en `src-tauri/Cargo.lock`. Las dependencias transitivas no se listan una a una (ver la sección de copyleft).

## Dependencias de npm (`package.json`)

### dependencies

| Paquete | Versión | Licencia (SPDX) | Proyecto |
|---|---|---|---|
| @fontsource-variable/archivo | 5.3.0 | OFL-1.1 | https://fontsource.org/fonts/archivo |
| @sqlite.org/sqlite-wasm | 3.54.1-build1 | Apache-2.0 | https://github.com/sqlite/sqlite-wasm |
| @tanstack/react-query | 5.108.4 | MIT | https://tanstack.com/query |
| @tanstack/react-virtual | 3.14.28 | MIT | https://tanstack.com/virtual |
| @tauri-apps/api | 2.12.5 | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri |
| date-fns | 4.4.0 | MIT | https://github.com/date-fns/date-fns |
| lucide-react | 1.81.0 | ISC | https://lucide.dev |
| papaparse | 5.7.1 | MIT | https://www.papaparse.com/ |
| react | 19.3.1 | MIT | https://react.dev/ |
| react-dom | 19.3.1 | MIT | https://react.dev/ |
| react-router | 8.5.3 | MIT | https://github.com/remix-run/react-router |
| read-excel-file | 9.3.20 | MIT | https://gitlab.com/catamphetamine/read-excel-file |
| workbox-window | 7.4.1 | MIT | https://github.com/GoogleChrome/workbox |
| write-excel-file | 4.1.1 | MIT | https://gitlab.com/catamphetamine/write-excel-file |
| zustand | 5.1.0 | MIT | https://github.com/pmndrs/zustand |

### devDependencies

Solo se usan para compilar, probar y generar iconos; no se distribuyen en la aplicación.

| Paquete | Versión | Licencia (SPDX) | Proyecto |
|---|---|---|---|
| @playwright/test | 1.65.1 | Apache-2.0 | https://playwright.dev |
| @tauri-apps/cli | 2.12.6 | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri |
| @types/node | 26.6.11 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/papaparse | 5.5.2 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/react | 19.3.3 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/react-dom | 19.3.0 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @vite-pwa/assets-generator | 2.0.0 | MIT | https://github.com/vite-pwa/assets-generator |
| @vitejs/plugin-react | 6.3.0 | MIT | https://github.com/vitejs/vite-plugin-react |
| typescript | 7.0.2 | Apache-2.0 | https://www.typescriptlang.org/ |
| vite | 8.4.0 | MIT | https://vite.dev |
| vite-plugin-pwa | 2.0.0 | MIT | https://github.com/vite-pwa/vite-plugin-pwa |
| vitest | 5.1.2 | MIT | https://vitest.dev |

## Crates de Rust (`src-tauri/Cargo.toml`)

| Crate | Versión (Cargo.lock) | Licencia (SPDX) | Proyecto |
|---|---|---|---|
| tauri | 2.12.7 | Apache-2.0 OR MIT | https://tauri.app/ |
| tauri-build (build-dependency) | 2.7.6 | Apache-2.0 OR MIT | https://tauri.app/ |
| tauri-plugin-dialog | 2.8.4 | Apache-2.0 OR MIT | https://github.com/tauri-apps/plugins-workspace |
| rusqlite (feature `bundled`) | 0.43.0 | MIT | https://github.com/rusqlite/rusqlite |
| serde | 1.0.229 | MIT OR Apache-2.0 | https://serde.rs |
| serde_json | 1.0.154 | MIT OR Apache-2.0 | https://github.com/serde-rs/json |

## Recursos incluidos

### Fuente Archivo

- Licencia: SIL Open Font License 1.1 (OFL-1.1).
- Se distribuye mediante `@fontsource-variable/archivo`, que incluye el texto de la licencia en su archivo `LICENSE`.
- Titulares de derechos: The Archivo Project Authors (https://github.com/Omnibus-Type/Archivo).
- La OFL permite usar, incrustar y redistribuir la fuente con el software, siempre que se conserve el aviso de derechos y la licencia, y que la fuente no se venda por separado.

### SQLite

- Licencia: dominio público (https://www.sqlite.org/copyright.html).
- Se usa por dos vías: la compilación WebAssembly de `@sqlite.org/sqlite-wasm` (la capa de empaquetado npm es Apache-2.0) y el SQLite en C que `rusqlite` compila con la feature `bundled`. Ambos contienen el código de SQLite, de dominio público.

### Iconos Lucide

- Licencia: ISC (https://lucide.dev/license), a través de `lucide-react`.
- Parte de los iconos de Lucide derivan de Feather (MIT).
- El `LICENSE` del paquete lleva el aviso "Copyright (c) 2026 Lucide Icons and Contributors" y, para los iconos derivados de Feather, el aviso MIT de ese proyecto.

### Skill modern-web-guidance (GoogleChrome)

- Ubicación: `.claude/skills/modern-web-guidance`.
- Licencia: Apache-2.0. El archivo `LICENSE` de la carpeta contiene el texto estándar de la Apache License 2.0 (versión 2.0, enero de 2004). Incluye la plantilla del apéndice sin rellenar (`Copyright [yyyy] [name of copyright owner]`), así que no declara titular concreto.
- No hay archivo `NOTICE` en la carpeta, por lo que no hay avisos adicionales que reproducir.
- Es una herramienta de desarrollo para el asistente de código; no forma parte de la aplicación distribuida.

## Copyleft

- No hay ninguna dependencia directa con licencia GPL, AGPL, LGPL ni MPL. Todas las directas son MIT, ISC, Apache-2.0, OFL-1.1 o dobles de MIT/Apache-2.0. SQLite, de dominio público, va incluido dentro de `@sqlite.org/sqlite-wasm` y de `rusqlite`.
- Dependencias transitivas con MPL-2.0 (copyleft débil, a nivel de archivo) en `src-tauri/Cargo.lock`, con la licencia leída en el registro local de Cargo: `option-ext` 0.2.0, `cssparser` 0.37.0, `cssparser-macros` 0.7.1, `dtoa-short` 0.3.5 y `selectors` 0.38.0. El lockfile también fija `cssparser` 0.38.0 y `selectors` 0.41.0, que no están descargados; su licencia no se pudo leer, aunque es de esperar que sea la misma. `option-ext` llega por `dirs-sys` y `dirs` (que usan `tauri`, `tauri-build`, `tray-icon` y `wry`); `cssparser` y `selectors` llegan por `dom_query`, que usan `tauri-utils` y `wry`. MPL-2.0 exige publicar las modificaciones a esos archivos si se modifican; usarlas sin modificar como dependencia no impone obligaciones sobre el código propio. Cuadra no las modifica.
- No se auditó el árbol transitivo completo, ni el de npm ni el de Cargo. Antes de una distribución pública conviene generarlo con una herramienta como `cargo license` o `cargo deny` para Rust y `pnpm licenses list` para npm.

## Nota sobre la investigación previa

`docs/RESEARCH.md` estudió proyectos con licencia copyleft (AGPL y GPL, entre ellos Firefly III, Sure, Maybe Finance y Wallos) solo como referencia de ideas de comportamiento. No se copió código, textos, esquemas ni recursos gráficos de ellos.
