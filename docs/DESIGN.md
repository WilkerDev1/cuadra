# DESIGN.md: Renglón y Resaltador

Contrato de diseño de Cuadra. Quien implemente la interfaz trabaja con este documento y con `src/ui/tokens.css`, no con los conceptos previos. Si el código y este documento discrepan, gana el código y se corrige el documento. Toda medida, color o duración que no esté aquí se añade primero aquí como token.

- **Modo de superficie:** *Operar*. Es una herramienta de trabajo diario. Lo primero es poder escanear la pantalla, la coherencia y la rapidez de captura. La marca vive en unos pocos detalles precisos, no en decoración.
- **Público:** dueños de negocios pequeños (registran con el teléfono en la mano, de pie, a la luz del día) y contadores independientes (escritorio, dos pantallas, teclado, 20 a 40 espacios de clientes).
- **Idioma:** la interfaz va en español, con formatos de `Intl` según la configuración del Espacio (`es-DO` y `DOP` por defecto: `RD$1,850.00`).

---

## 1. Nombre e idea rectora

**Cuadra** viene de *cuadrar las cuentas*. La dirección visual se llama **Renglón y Resaltador** y sale de los dos objetos que todo contador tiene sobre la mesa:

1. **El papel columnar verde pálido**, con renglones, tinta oscura y la *doble raya* bajo los totales. De ahí sale la confianza: es un registro que solo crece, donde lo que se corrige se tacha y nunca se borra.
2. **El resaltador fosforescente** con el que se marca la cifra que importa. Es el lima de las referencias, pero con un sentido concreto: aparece **una sola vez por pantalla**, como trazo bajo la cifra protagonista, y como relleno de la única acción principal.

El bosque oscuro es la tinta y la pizarra: la tarjeta de saldo, la barra lateral y el tema oscuro.

La firma de la marca es el **sello de cuadre**, un cuadrado de cuatro trazos que se dibuja cuando algo cuadra: un total de control igualado, un respaldo restaurado o un espacio creado. El logotipo es ese mismo sello. La marca *es* la acción de cuadrar.

**Frase de producto:** «Tu libro de caja, al día y sin enredos.»

---

## 2. Principios

1. **Anotar en tres toques.** La acción más frecuente (anotar una salida en la cuenta y la categoría de siempre) cabe en tres toques desde cualquier pantalla del móvil, sin que aparezca el teclado del sistema.
2. **La cifra manda.** En cada pantalla hay una cifra protagonista, grande, tabular y nunca truncada. Todo lo demás se subordina a ella. Solo lleva resaltador esa cifra.
3. **Nada desaparece.** Anular tacha y estampa, editar deja el valor viejo tachado en el historial y desactivar pone en gris. Lo que se ve en la interfaz es la regla del dominio.
4. **El color nunca va solo.** Entrada, salida y transferencia se distinguen siempre por signo, glifo, columna o etiqueta, y además por color.
5. **Un solo sistema, dos densidades.** Móvil y escritorio comparten tokens, componentes y lenguaje. Cambian la densidad (`--fila`), la navegación y el lugar donde se abre el detalle, nunca la identidad.

---

## 3. Tokens

Se copian tal cual a `src/ui/tokens.css`. Ningún componente usa colores, medidas ni duraciones sueltas.

Sobre el tema: los valores oscuros se declaran en bloques aparte, en lugar de con `light-dark()`. Así funcionan igual en WebKitGTK, el webview de Tauri en Linux, y el interruptor manual (`data-theme`) no depende de `color-scheme`. Todos los pares de texto de abajo se verificaron con WCAG 2.x (ver §12).

```css
/* ==========================================================================
   Cuadra · tokens · dirección «Renglón y Resaltador»
   ========================================================================== */

@import "@fontsource-variable/archivo/wdth.css"; /* familia 'Archivo Variable', wght 100–900, wdth 62–125 */

:root {
  color-scheme: light dark;

  /* ---------- Papel y tinta (claro: «papel de libreta») ---------- */
  --bg:            oklch(0.975 0.010 135);  /* papel */
  --surface:       oklch(0.995 0.004 135);  /* hoja: tarjetas, hojas inferiores, tabla */
  --surface-2:     oklch(0.950 0.016 140);  /* filas alternas, chips en reposo, teclas */
  --sunken:        oklch(0.930 0.020 140);  /* campos, pistas, fondo de vista previa */
  --rule:          oklch(0.880 0.025 145);  /* renglones y separadores (decorativo) */
  --rule-strong:   oklch(0.700 0.040 150);  /* doble raya, ejes */
  --control:       oklch(0.620 0.035 150);  /* borde de input/checkbox: ≥3:1 */

  --ink:           oklch(0.240 0.045 155);  /* texto principal 15:1 */
  --ink-2:         oklch(0.420 0.035 155);  /* texto secundario 7.7:1 */
  --ink-3:         oklch(0.520 0.030 155);  /* meta ≥4.7:1, nunca bajo 13px */

  --forest:        oklch(0.310 0.070 155);  /* tarjeta de saldo, barra lateral */
  --forest-2:      oklch(0.370 0.075 155);  /* hover/activo sobre forest */
  --on-forest:     oklch(0.970 0.020 130);  /* 11.8:1 sobre forest */
  --on-forest-2:   oklch(0.800 0.040 140);  /* 6.9:1 sobre forest */

  /* ---------- Resaltador (único acento) ---------- */
  --lime:          oklch(0.920 0.200 125);  /* SOLO relleno; encima siempre --on-lime */
  --on-lime:       oklch(0.240 0.045 155);  /* 13:1 sobre lime */
  --lime-press:    oklch(0.860 0.200 125);
  --accent-ink:    oklch(0.480 0.130 140);  /* enlaces y texto de acento sobre claro 5.8:1 */

  /* ---------- Semánticos (tinta de libro) ---------- */
  --in:            oklch(0.480 0.110 165);  /* entrada: verde azulado, separado del bosque */
  --in-wash:       oklch(0.950 0.035 165);
  --out:           oklch(0.520 0.180 27);   /* salida: tinta roja */
  --out-wash:      oklch(0.955 0.030 27);
  --xfer:          oklch(0.500 0.120 255);  /* transferencia: tinta azul */
  --xfer-wash:     oklch(0.950 0.025 255);
  --warn-ink:      oklch(0.480 0.110 70);
  --warn-wash:     oklch(0.930 0.070 85);
  --void:          var(--out);              /* sello ANULADO */

  /* ---------- Foco ---------- */
  --focus-ring:    var(--ink);              /* contorno 2px */
  --focus-halo:    oklch(0.920 0.200 125 / 0.9); /* halo lima 3px por fuera */

  /* ---------- Gráficas ---------- */
  --chart-in:      var(--in);
  --chart-out:     var(--out);
  --chart-line:    var(--ink);
  --chart-grid:    var(--rule);
  --chart-select:  var(--ink);
  /* 8 tintas para lomos de Espacio y opciones de lista (croma baja, iguales en L) */
  --tint-1: oklch(0.62 0.09 155); --tint-2: oklch(0.62 0.09 200);
  --tint-3: oklch(0.62 0.09 250); --tint-4: oklch(0.62 0.09 300);
  --tint-5: oklch(0.62 0.09 350); --tint-6: oklch(0.62 0.10 30);
  --tint-7: oklch(0.66 0.10 75);  --tint-8: oklch(0.58 0.03 155);

  /* ---------- Sombras (teñidas de bosque, nunca gris neutro) ---------- */
  --sh-1: 0 1px 0 oklch(0.24 0.045 155 / 0.06), 0 1px 2px oklch(0.24 0.045 155 / 0.08);
  --sh-2: 0 1px 0 oklch(0.24 0.045 155 / 0.06), 0 10px 28px -14px oklch(0.24 0.05 155 / 0.28);
  --sh-sheet: 0 -8px 32px oklch(0.24 0.05 155 / 0.16);
  --sh-inset: none;

  /* ---------- Tipografía ---------- */
  --font: "Archivo Variable", "Archivo", ui-sans-serif, system-ui, sans-serif;
  --num: tabular-nums lining-nums;              /* font-variant-numeric de toda cifra */

  /* Escala fluida. cqi resuelve contra el contenedor más cercano (el shell como mínimo) */
  --t-display: clamp(3.5rem, 2rem + 10cqi, 7rem);     /* «Cuadra.» en bienvenida */
  --t-hero:    clamp(3.25rem, 1.5rem + 11cqi, 6.5rem); /* cifra protagonista */
  --t-amount-l: clamp(1.875rem, 1.5rem + 1.5cqi, 2.5rem); /* saldo de cuenta, detalle */
  --t-h1:      clamp(1.75rem, 1.45rem + 1.2cqi, 2.25rem);
  --t-h2:      clamp(1.25rem, 1.15rem + 0.4cqi, 1.5rem);
  --t-h3:      1.0625rem;
  --t-body:    1rem;
  --t-small:   0.875rem;   /* tabla escritorio, detalle */
  --t-meta:    0.8125rem;  /* meta bajo filas */
  --t-micro:   0.75rem;    /* cabeceras de tabla en mayúsculas, nada más */

  --lh-tight: 1.05;  --lh-snug: 1.25;  --lh-body: 1.45;

  /* Pesos y anchos (eje wdth = font-stretch) */
  --w-body: 420;  --w-medium: 520;  --w-strong: 650;  --w-title: 720;  --w-figure: 760;  --w-display: 820;
  --wd-wide: 112%;  --wd-normal: 100%;  --wd-table: 88%;  --wd-tight: 75%;  --wd-min: 62%;

  /* ---------- Espaciado (base 4) ---------- */
  --s-1: 0.25rem; --s-2: 0.5rem;  --s-3: 0.75rem; --s-4: 1rem;   --s-5: 1.25rem;
  --s-6: 1.5rem;  --s-8: 2rem;    --s-10: 2.5rem; --s-12: 3rem;  --s-16: 4rem;
  --gutter: 1rem;                 /* 16px móvil; 24px ≥600; 32px ≥1024 (ver shell) */

  /* ---------- Densidad: la fila y el renglón del fondo usan el MISMO valor ---------- */
  --fila: 3.5rem;                 /* 56px táctil */
  --fila-densa: 2.5rem;
  --key: 4rem;                    /* tecla del teclado: 64px */
  --target: 3rem;                 /* objetivo táctil mínimo: 48px */

  /* ---------- Radios (regla: los datos son rectos; lo que se toca, redondeado) ---------- */
  --r-0: 0;          /* tablas, filas, cinta, renglones */
  --r-1: 6px;        /* inputs, chips de filtro cuadrados, celdas activas */
  --r-2: 14px;       /* tarjetas, teclas, botones grandes */
  --r-3: 28px;       /* SOLO borde superior de hojas inferiores */
  --r-pill: 999px;   /* SOLO chips de selección, botón Anotar, segmentado */

  /* ---------- Bordes ---------- */
  --bw: 1px;  --bw-2: 2px;

  /* ---------- Capas (casi todo lo flotante va al top layer; esto es lo que no) ---------- */
  --z-base: 0;  --z-sticky: 10;  --z-header: 20;  --z-nav: 30;  --z-fab: 40;

  /* ---------- Movimiento ---------- */
  --d-press: 90ms;     /* pulsación de tecla/botón */
  --d-micro: 160ms;    /* hover, chips, interruptores */
  --d-route: 240ms;    /* cambio de vista */
  --d-sheet: 320ms;    /* hoja inferior y diálogo */
  --d-count: 600ms;    /* conteo de totales */
  --d-stamp: 520ms;    /* sello de cuadre, doble raya */
  --d-fade-rm: 120ms;  /* sustituto con movimiento reducido */
  --ease-out: cubic-bezier(.2, .9, .1, 1);
  --ease-inout: cubic-bezier(.65, 0, .35, 1);
  --ease-spring: var(--ease-out);   /* respaldo; ver @supports abajo. Solo para hojas */

  /* ---------- Layout ---------- */
  --nav-h: 4rem;            /* barra inferior, sin el safe area */
  --rail-w: 4.5rem;         /* 72px */
  --sidebar-w: 15.5rem;     /* 248px */
  --inspector-w: 23.75rem;  /* 380px */
  --content-max: 75rem;     /* 1200px */
  --sheet-max-w: 40rem;     /* hojas en tableta/escritorio */
}

/* Las custom properties no validan su valor: el respaldo se hace con @supports, no repitiendo la declaración */
@supports (transition-timing-function: linear(0, 1)) {
  :root { --ease-spring: linear(0, .62 14%, 1.05 31%, .99 46%, 1); }
}

@media (pointer: fine) {
  :root { --fila: 2.5rem; --fila-densa: 2rem; } /* 40px ratón, 32px compacta */
}

:root[data-theme="light"] { color-scheme: light; }

/* ---------- Oscuro: «pizarra de bosque» (no negro) ----------
   Este bloque se aplica por elección manual (data-theme="dark").
   El MISMO bloque se repite abajo dentro de
   @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }
   para seguir al sistema. Un test de tokens verifica que ambos sean idénticos. */
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg:          oklch(0.180 0.025 155);
  --surface:     oklch(0.220 0.030 155);
  --surface-2:   oklch(0.260 0.035 155);
  --sunken:      oklch(0.155 0.020 155);
  --rule:        oklch(0.320 0.035 155);
  --rule-strong: oklch(0.480 0.040 155);
  --control:     oklch(0.520 0.040 155);
  --ink:         oklch(0.950 0.015 130);
  --ink-2:       oklch(0.780 0.025 140);
  --ink-3:       oklch(0.680 0.025 145);
  --forest:      oklch(0.270 0.060 155);
  --forest-2:    oklch(0.320 0.065 155);
  --on-forest:   oklch(0.970 0.020 130);
  --on-forest-2: oklch(0.800 0.040 140);
  --lime:        oklch(0.900 0.200 125);
  --on-lime:     oklch(0.220 0.050 140);
  --lime-press:  oklch(0.840 0.200 125);
  --accent-ink:  oklch(0.880 0.180 125);   /* en oscuro el lima SÍ puede ser texto */
  --in:          oklch(0.800 0.130 165);   /* menta, separada del lima */
  --in-wash:     oklch(0.280 0.050 165);
  --out:         oklch(0.750 0.150 30);
  --out-wash:    oklch(0.290 0.060 30);
  --xfer:        oklch(0.780 0.100 250);
  --xfer-wash:   oklch(0.280 0.045 250);
  --warn-ink:    oklch(0.840 0.130 85);
  --warn-wash:   oklch(0.300 0.060 85);
  --focus-ring:  oklch(0.900 0.200 125);
  --focus-halo:  oklch(0.900 0.200 125 / 0.35);
  --sh-1: none;
  --sh-2: inset 0 1px 0 oklch(1 0 0 / 0.06);
  --sh-sheet: inset 0 1px 0 oklch(1 0 0 / 0.08), 0 -8px 32px oklch(0 0 0 / 0.35);
  --sh-inset: inset 0 1px 0 oklch(1 0 0 / 0.06);
}

/* ---------- Colores forzados ---------- */
@media (forced-colors: active) {
  :root {
    --bg: Canvas; --surface: Canvas; --surface-2: Canvas; --sunken: Canvas;
    --ink: CanvasText; --ink-2: CanvasText; --ink-3: GrayText;
    --rule: GrayText; --rule-strong: CanvasText; --control: ButtonBorder;
    --forest: Canvas; --on-forest: CanvasText; --on-forest-2: CanvasText;
    --lime: Highlight; --on-lime: HighlightText; --accent-ink: LinkText;
    --in: CanvasText; --out: CanvasText; --xfer: CanvasText; --warn-ink: CanvasText;
    --focus-ring: Highlight; --focus-halo: transparent;
  }
}

/* ---------- Movimiento reducido ---------- */
@media (prefers-reduced-motion: reduce) {
  :root {
    --d-route: var(--d-fade-rm); --d-sheet: var(--d-fade-rm);
    --d-count: 0ms; --d-stamp: 0ms; --d-press: 0ms;
    --ease-spring: linear;
  }
}

/* ---------- Base ---------- */
html { font-family: var(--font); font-size: 100%; -webkit-text-size-adjust: 100%;
       background: var(--bg); color: var(--ink); interpolate-size: allow-keywords; }
body { font-size: var(--t-body); line-height: var(--lh-body); font-weight: var(--w-body); }
:where(h1, h2, h3) { text-wrap: balance; } :where(p) { text-wrap: pretty; }
:where(.num, data, output, td.num, [data-amount]) { font-variant-numeric: var(--num); }
:focus-visible { outline: var(--bw-2) solid var(--focus-ring); outline-offset: 2px;
                 box-shadow: 0 0 0 5px var(--focus-halo); }
```

> El bloque oscuro se escribe **dos veces, literal**: una vez como `:root[data-theme="dark"]` (arriba) y otra dentro de `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }`, inmediatamente después. Un test de Vitest lee `tokens.css` y falla si los dos bloques difieren. El interruptor de Apariencia escribe `data-theme` en `<html>` (Sistema = sin atributo).

Además, en `index.html`:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="text-scale" content="scale">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f4f7ef">
<meta name="theme-color" media="(prefers-color-scheme: dark)"  content="#0f1d15">
<link rel="preload" href="/fonts/archivo-latin-wdth-normal.woff2" as="font" type="font/woff2" crossorigin>
```

(Los hex de `theme-color` son aproximaciones de `--bg`. Cuando el usuario fuerza un tema, se actualizan por JS.)

---

## 4. Tipografía

- **Una sola familia:** `@fontsource-variable/archivo` importada como `@fontsource-variable/archivo/wdth.css`. El nombre de familia es `'Archivo Variable'`, con los ejes `wght` 100–900 y `wdth` 62–125 (este último se controla con `font-stretch`). El archivo latino pesa unos 90 KB en woff2 y se precarga.
- **Verificado en el paquete 5.3.0:** la fuente trae `tnum`, `pnum`, `frac` y el signo menos U+2212. **No trae** `zero` (cero con barra) ni flechas (U+2190–21FF), así que las flechas se dibujan con iconos y no se usa `slashed-zero`.
- **Expresividad con el eje de ancho, no con más familias:**
  - Títulos de pantalla (H1) a `wdth 112`, `wght 720`, con tracking de −0.015em.
  - La cifra protagonista a `wght 760` y ancho elástico (§5).
  - Las tablas de escritorio a `wdth 88`, para que quepan más columnas sin bajar el tamaño.
  - La cinta de Captura y los números de movimiento a `wdth 75`, `wght 520`.
  - La palabra «Cuadra.» de bienvenida a `wdth 125`, `wght 820`.
- **Cuerpo** a 1rem/1.45 con `wght 420`. Etiquetas de campo a `--t-small` con `wght 520`.
- **Mayúsculas** solo en las cabeceras de tabla (`--t-micro`, +0.06em) y en el sello ANULADO. No se pone una etiqueta pequeña en mayúsculas encima de cada título.
- Todo se escribe en `rem`. Con `<meta name="text-scale">`, el tamaño de letra del sistema Android escala la app entera.

---

## 5. Reglas para cifras

Toda cifra de dinero se pinta con el componente `AmountText`. Nadie formatea dinero a mano.

1. **Datos:** el monto es un entero en unidad menor y la moneda la define el Espacio. El formato sale de `Intl.NumberFormat(locale, { style: 'currency', currency })` con `formatToParts` para separar símbolo, entero y decimales. El ejemplo por defecto es `es-DO`/`DOP` → `RD$1,850.00`. La tecla decimal del teclado propio muestra el separador decimal del locale.
2. **Tabulares siempre:** `font-variant-numeric: tabular-nums lining-nums`, alineadas a la derecha en listas y tablas y alineadas por la coma decimal en columnas.
3. **Signo y glifo antes que color:**

   | Tipo | Móvil y listas | Tabla de escritorio | Informe impreso | Color |
   |---|---|---|---|---|
   | Entrada | `+RD$1,850.00` | columna **Entra** sin signo | columna Entra | `--in` |
   | Salida | `−RD$1,850.00` (U+2212, nunca guion) | columna **Sale** sin signo | columna Sale | `--out` |
   | Transferencia | icono `ArrowsLeftRight` + `RD$1,850.00` | ambas columnas en sus cuentas; en vista de espacio, columna aparte | fuera de Entra/Sale | `--xfer` |
   | Saldo inicial | etiqueta «Saldo inicial» + monto, sin signo | columna Saldo | fila de apertura | `--ink-2` |
   | Saldo negativo | `−RD$1,200.00` | `(1,200.00)` entre paréntesis | `(1,200.00)` | `--out` |
   | Saldo positivo | `RD$12,400.00` sin signo | sin signo | sin signo | `--ink` |

   Los paréntesis se usan **solo** en tablas e informes, que es la convención del contador. En el móvil se usa el signo, que es la del dueño de negocio.
4. **Anatomía en tamaño héroe y L:**
   - el símbolo `RD$` va al 45% del tamaño, alineado a la altura de mayúscula, en `--ink-3` (o `--on-forest-2` sobre el bosque);
   - el entero va al 100% con `wght 760`;
   - los decimales van al 55% con `wght 450`, alineados arriba;
   - el signo va al 80%, con el color del tipo.

   En filas y tablas todo va al mismo tamaño.
5. **Nunca se trunca (cifra elástica).** `AmountText` fija `--chars` con el número de caracteres del monto formateado sin el símbolo. Primero se encoge el **ancho**, y solo después el tamaño:
   ```css
   .amount--hero {
     font-size: min(var(--t-hero), calc(100cqi / (var(--chars) * 0.56)));
     font-stretch: clamp(62%, calc(100% - (var(--chars) - 9) * 6%), 100%);
   }
   ```
   Así `12,400.00` (9 caracteres) sale a ancho normal y `1,234,567.89` sale condensado. Nunca se usa `…` en un monto.
6. **Totales:** todo total de un grupo (día, cuenta, informe o lote) lleva debajo la **doble raya**: dos líneas de 1px en `--rule-strong` separadas 2px, del ancho de la cifra. Los subtotales llevan una sola raya.
7. **Anulado:** el monto se tacha (`text-decoration: line-through 2px`) en `--ink-3`, sigue visible y **no suma**.
8. **Lectura para lector de pantalla:** cada `AmountText` tiene `aria-label` con la lectura completa, por ejemplo «salida de mil ochocientos cincuenta pesos». Los dígitos sueltos y los glifos decorativos llevan `aria-hidden`.
9. **Conteo:** cuando cambia un total visible, cuenta del valor viejo al nuevo en `--d-count` con `--ease-out`. Como las cifras son tabulares, el ancho no salta. Con movimiento reducido el cambio es inmediato.

---

## 6. Color: presupuesto y uso

- **Presupuesto de lima por pantalla:** **un** trazo de resaltador (bajo la cifra protagonista) y **una** acción principal rellena (Anotar, Guardar lote, Empezar, etc.). Nada más. Las pestañas activas, chips seleccionados, gráficas e iconos no usan lima.
- **El lima nunca es texto sobre fondo claro.** Para texto de acento en claro está `--accent-ink`. En oscuro, `--accent-ink` sí es lima.
- **El bosque (`--forest`)** cubre superficies grandes: la tarjeta de saldo en Inicio, la barra lateral de escritorio y el icono de la app. Encima solo va `--on-forest`, `--on-forest-2` y el resaltador.
- **Los lavados semánticos** (`--in-wash`, `--out-wash`, `--xfer-wash`) tiñen el fondo de la hoja de Nuevo movimiento según el tipo y las celdas de la vista previa de importación. Nunca se usan como borde lateral de una tarjeta.
- **Las tintas de lomo** (`--tint-1…8`) identifican Espacios y opciones de lista. Aparecen como franja o punto, nunca como fondo de texto.
- **Aviso** (`--warn-ink`/`--warn-wash`): respaldo atrasado, saldo negativo y celdas con error en la importación. No hay rojo de error genérico: la salida ya es roja. Los errores bloqueantes usan `--warn-ink` con icono `WarningCircle` y texto.

---

## 7. Iconos

- Se usa **Phosphor Icons** (`@phosphor-icons/react`, MIT), con peso `regular` a 20px en filas y 24px en navegación, y `fill` para el destino activo de la navegación.
- Los iconos siempre van con texto, salvo en `IconButton`, que lleva `aria-label`. Nunca se ponen iconos dentro de círculos de color.
- Iconos de referencia:
  - entrada `ArrowDownLeft`, salida `ArrowUpRight`, transferencia `ArrowsLeftRight`
  - cuenta de caja `Wallet`, banco `Bank`, tarjeta `CreditCard`
  - campos: texto `TextT`, número `Hash`, fecha `CalendarBlank`, lista `ListBullets`, sí/no `ToggleLeft`
  - anular `Prohibit`, duplicar `Copy`, historial `ClockCounterClockwise`, respaldo `FloppyDisk`
  - info `Info`, aviso `WarningCircle`

---

## 8. Estructura y navegación

### 8.1 Puntos de corte (container queries sobre el shell)

El shell (`<div class="app">`) es `container-type: inline-size; container-name: shell`. Los componentes internos declaran su propio contenedor. **No se usan media queries de viewport para el layout**, solo para `pointer`, `prefers-*` y la impresión.

| Clase | Ancho del shell | Navegación | Detalle | `--gutter` |
|---|---|---|---|---|
| Compacta | < 600px | Barra inferior + pastilla Anotar | Hoja inferior (`<dialog>`) | 16px |
| Media | 600–1023px | Riel de 72px a la izquierda | Hoja lateral derecha (`<dialog>`, 420px) | 24px |
| Expandida | 1024–1279px | Barra lateral de 248px en `--forest` | Hoja lateral derecha | 32px |
| Amplia | ≥ 1280px | Barra lateral | **Inspector fijo** de 380px (panel, no modal) | 32px |

### 8.2 Móvil (compacta)

- **Encabezado** de 56px: chip del Espacio a la izquierda (inicial en su tinta y nombre; un toque abre el selector) y, a la derecha, buscar (`MagnifyingGlass`). En Inicio, el encabezado se encoge al hacer scroll con `animation-timeline: scroll()`: el saldo pasa a mostrarse pequeño en el encabezado.
- **Barra inferior** de `--nav-h` + `env(safe-area-inset-bottom)`, sobre `--surface` con borde superior `--rule`. Tiene tres destinos a la izquierda: **Inicio** (`House`), **Movimientos** (`Rows`) y **Más** (`DotsThreeOutline`, que abre la página con Cuentas, Resumen, Informes, Campos y listas, Respaldo y Ajustes). A la derecha va la **pastilla Anotar**: lima, 64px de alto y unos 132px de ancho, con `Plus` en negrita y el texto «Anotar».
  - Toque: abre Nuevo movimiento con el último tipo usado.
  - Pulsación larga (400ms) o el botón `CaretUp` dentro de la pastilla: abre un popover anclado con Entrada, Salida, Transferencia y Ráfaga.
- **Hojas inferiores** con `<dialog>`, radio `--r-3` arriba, asa de 36×4px y tres alturas (media, alta y completa). El gesto Atrás del sistema las cierra con `closedby="any"` más un manejador del historial.
- **Atajos de la PWA** (manifest `shortcuts`): «Nueva entrada», «Nueva salida» y «Transferencia».

### 8.3 Escritorio (expandida y amplia)

- **Barra lateral** de 248px en `--forest`:
  - arriba, el selector de Espacio (lomo con tinta, nombre y `CaretUpDown`);
  - el botón **Anotar** (lima, ancho completo, 44px de alto);
  - la navegación: Inicio, Movimientos, Cuentas (con la lista de cuentas y su saldo, plegable), Captura, Resumen, Informes, Campos y listas, Respaldo;
  - abajo, Ajustes y el sello pequeño.

  El ítem activo lleva fondo `--forest-2`, texto `--on-forest` e indicador de 3px en `--lime` a la izquierda. Ese indicador es la única excepción al presupuesto de lima, porque está fuera del contenido.
- **Contenido** centrado hasta `--content-max`, con encabezado sticky (título H1 a `wdth 112` y acciones a la derecha).
- **Inspector** de 380px (amplia) o hoja lateral (expandida) para el detalle de movimiento, Nuevo movimiento y Transferencia. Nada de eso se abre en un modal centrado.
- **Paleta de comandos** con `Ctrl/⌘+K` (`<dialog>`): busca Espacios, cuentas, movimientos por concepto o monto, acciones y vistas guardadas.
- **Atajos** de una letra, que solo se activan fuera de inputs:

  | Tecla | Acción |
  |---|---|
  | `N` | Anotar |
  | `E` / `S` / `T` | entrada / salida / transferencia |
  | `R` | ráfaga o captura |
  | `/` | buscar |
  | `G` y luego `I`, `M`, `C`, `R` | ir a Inicio, Movimientos, Cuentas, Resumen |
  | `J` / `K` | fila siguiente / anterior |
  | `Enter` | abrir |
  | `D` | duplicar |
  | `A` | anular (con confirmación) |
  | `Ctrl+Enter` | guardar |
  | `?` | hoja de atajos |

  En la rejilla de Captura, además: `Alt+↓` copia el campo de arriba y `Ctrl+D` duplica la fila de arriba.

---

## 9. Componentes base

Todos viven en `src/ui/` y usan solo tokens. Estados obligatorios en todos los interactivos: reposo, hover (solo con `@media (hover: hover)`), `:focus-visible`, activo/pulsado (`scale(.97)` en `--d-press`), deshabilitado (opacidad .45 + motivo en tooltip o texto) y cargando cuando aplique.

| Componente | Variantes | Notas y medidas |
|---|---|---|
| **Button** | `primary` (lima, `--on-lime`), `secondary` (`--surface` + borde `--control`), `ghost` (solo texto `--ink`), `danger` (texto `--out`, borde `--out`), `on-forest` | Alto 48px táctil y 40px con ratón; padding 0 20px; radio `--r-2` (primary pill solo en Anotar); peso 650. Solo un `primary` por vista. Cargando: el texto se mantiene y se añade un spinner de 16px a la izquierda |
| **IconButton** | `ghost`, `secondary`, `on-forest` | 48×48 táctil y 40×40 con ratón; `aria-label` obligatorio; tooltip con `interestfor`/popover hint |
| **Card** | `plain` (surface + `--sh-1`), `forest` (saldo), `sunken` | Radio `--r-2`, padding `--s-4` móvil / `--s-6` escritorio. **Prohibido anidar Card dentro de Card** |
| **Sheet / BottomSheet** | `bottom` (compacta), `side` (media/expandida), `full` | `<dialog>` + `showModal()`; alturas 50/85/100dvh; entra en `--d-sheet` `--ease-spring` con `@starting-style`; sale con `transition-behavior: allow-discrete`; padding inferior `env(safe-area-inset-bottom)`; foco al título al abrir y al disparador al cerrar; guarda de cambios sin guardar en el evento `cancel` |
| **Dialog** | `confirm`, `destructive`, `info` | Centrado, máx. 28rem, radio `--r-2`. Para confirmaciones, el botón destructivo nunca está enfocado por defecto. Texto: «¿Anular este movimiento?» / «Quedará tachado en el libro y dejará de sumar. Puedes restaurarlo después.» / [Cancelar] [Anular] |
| **Field** | `text`, `number`, `date`, `textarea` (`field-sizing: content`), `amount` | Etiqueta siempre visible encima (nunca solo placeholder); input de 48/40px, fondo `--surface`, borde 1px `--control`, radio `--r-1`; ayuda en `--ink-3` `--t-meta`; error en `--warn-ink` con icono, enlazado con `aria-describedby`. El `amount` acepta aritmética (`1500+350`) y muestra el resultado a la derecha |
| **Select / Combobox** | `native` (móvil), `combobox` (escritorio, autocompletado) | Combobox en popover con anchor positioning; la opción desactivada no aparece al crear, pero sí al mostrar datos viejos (en gris, con «(inactiva)»); «Crear "X"» al final si el campo lo permite |
| **Segmented** | 2 a 4 segmentos | Pista `--surface-2` pill, el segmento activo es `--surface` con `--sh-1` y texto `--ink` 650. En Nuevo movimiento el activo lleva un subrayado de 3px del color del tipo. Es `role="radiogroup"` |
| **Chip** | `choice` (pill, seleccionable), `filter` (radio `--r-1`, con valor y ×), `info` (estático) | Alto 36px, objetivo táctil ampliado a 48 con padding invisible. Seleccionado: fondo `--ink`, texto `--bg`. Nunca lima |
| **Table** | `ledger` (movimientos), `summary`, `grid` (captura editable) | Cabecera sticky, `--t-micro` en mayúsculas `--ink-2`, borde inferior `--rule-strong`; filas de alto `--fila`, separador `--rule`; números a la derecha; hover `--surface-2`; fila seleccionada con fondo `--surface-2` y borde izquierdo 2px `--ink`. Por debajo de 640px de contenedor se apila en filas de dos líneas (las etiquetas salen de `data-label`) |
| **Toast** | `info`, `undo`, `warn` | Popover `manual` abajo y centrado (sobre la barra inferior en móvil), `--surface` con `--sh-2`, radio `--r-2`. Undo: «Anotado · −RD$350.00 en Caja» + [Deshacer] durante 6s; deshacer = anular con motivo «Deshecho». `role="status"`. Nunca se usa para un error que exige acción |
| **EmptyState** | `first-use`, `no-results` | Renglones vacíos de fondo, una sola frase en `--ink-2` sobre el primer renglón y una acción. Sin ilustraciones (§10.16) |
| **AmountText** | tamaños `hero`, `l`, `m`, `row`, `table`; notación `sign`, `parens`, `columns`; `voided`, `highlight`, `animate` | Ver §5. Solo una instancia con `highlight` por pantalla (se verifica en desarrollo con un `console.warn`) |
| **Keypad** | `amount` (Nuevo movimiento), `opening` (saldos iniciales) | Ver §10.6. Las teclas son `<button>`, de alto `--key` y radio `--r-2`, con fondo `--surface-2` y `wght 560` 1.5rem; responden en `pointerdown`; `navigator.vibrate(8)` si existe |
| **Sparkline / Escalera / Barras** | `sparkline` (30 días, 64×20), `escalera` (flujo diario), `bars-h` (por categoría o dimensión) | SVG propio, sin librería. Barras sin pista de fondo, radio 2px solo en el extremo libre. Salidas con **trama diagonal** (`<pattern>` a 45°, 1.5px cada 4px). Siempre con alternativa en tabla («Ver como tabla», con `<details>`) |
| **Nav** | `bottom`, `rail`, `sidebar` | Destino activo con `aria-current="page"`; etiquetas siempre visibles en bottom y sidebar; en el riel, tooltip |
| **InfoTip** | — | Icono `Info` 16px + popover `hint`, para explicaciones como «Las transferencias y los saldos iniciales no cuentan como entrada ni salida.» Las explicaciones van aquí, no en cajas de colores |
| **Stamp (sello)** | `cuadra`, `anulado` | Ver §11 |
| **DoubleRule** | `single`, `double`, `animate` | Ver §5.6 y §11 |
| **Ledger list** | — | Contenedor con fondo de renglones: `background: repeating-linear-gradient(to bottom, transparent 0 calc(var(--fila) - 1px), var(--rule) calc(var(--fila) - 1px) var(--fila))`. Filas y cabeceras de día miden **exactamente** `--fila`, con texto en una línea y elipsis en el concepto (nunca en el monto) |

---

## 10. Pantallas

Hay 15 pantallas más los estados vacíos. Para cada una se indica qué se ve en móvil (compacta) y qué cambia en escritorio (expandida/amplia). Los textos son ejemplos reales de UI.

### 10.1 Bienvenida y plantilla (onboarding)

Son tres pasos con un indicador «1 de 3» en texto (sin puntos).

1. **Bienvenida.** Fondo `--bg`.
   - La palabra **«Cuadra»** va en `--t-display`, `wdth 125`, `wght 820`. Lleva un cuadrado lima de 0.22em como punto final: es el sello, relleno y con borde `--ink` de 1.5px.
   - Debajo se dibuja la doble raya (`--d-stamp`) y la frase «Tu libro de caja, al día y sin enredos.» en `--t-h2` `--ink-2`.
   - Abajo: [Empezar] (primary, ancho completo) y el enlace «Ver con datos de ejemplo».
2. **Plantilla y nombre.**
   - Campo «Nombre del espacio» (por ejemplo «Ferretería La Esquina»), con el selector de moneda al lado (RD$ por defecto).
   - Debajo, «¿Qué vas a llevar?» y las plantillas como **lomos**: Negocio pequeño, Despacho contable (un cliente), Organización, Finanzas personales y En blanco. Cada lomo mide 72px de alto, con franja de tinta de 8px a la izquierda, nombre en `wght 650` y una línea de resumen («3 cuentas · 14 categorías · centro de costo»).
   - Al tocar uno, se despliega (`<details name="plantilla">` + `interpolate-size`) y muestra sus cuentas y categorías reales como chips `info`.
   - Botón [Continuar].
3. **Saldos iniciales.** Aparece «¿Con cuánto empiezas?» y una fila por cuenta de la plantilla (Caja, Banco). Tocar una abre el Keypad `opening` en una hoja. Hay un enlace «Lo hago después». Al pulsar [Listo], se dibuja el sello de cuadre en el centro y la vista pasa a Inicio con una view transition.

**Escritorio:** columna de 36rem centrada. En el paso 2 los lomos van a la izquierda y la vista previa de la plantilla elegida a la derecha.

### 10.2 Selector de espacios

- **Móvil:** hoja completa con el título «Tus espacios» y un buscador fijo arriba («Buscar cliente o espacio»). Debajo van «Fijados» y «Todos», ordenados por actividad, con un segmentado «Recientes | A–Z».
- Cada Espacio es un **lomo** de 72px:
  - franja de tinta de 8px;
  - la inicial a 2.5rem en `wdth 62`, `wght 800` y con la tinta del Espacio;
  - el nombre en `--t-h3` 650 y, debajo, «Último movimiento hace 2 h» en `--ink-3`;
  - a la derecha, el saldo total (`AmountText row`).

  Pulsación larga o el botón ⋯ abre Fijar, Renombrar, Cambiar color y Archivar. Al final hay un renglón vacío con «+ Nuevo espacio», como escribir en la línea siguiente.
- **Escritorio:** popover anclado al selector de la barra lateral (máximo 480px de alto, con scroll), con la misma lista. También se llega con `Ctrl+K`.

### 10.3 Inicio del espacio

- **Móvil**, de arriba abajo:
  1. **Tarjeta de saldo** `forest` a sangre (sin margen lateral, radio `--r-3` solo abajo):
     - la etiqueta «Saldo total» en `--on-forest-2`;
     - el `AmountText hero highlight` en `--on-forest`, con el trazo lima *debajo* de la cifra (nunca detrás de los dígitos);
     - debajo, «en 3 cuentas · al 26 nov» en `--on-forest-2`.
  2. **Este mes:** dos columnas sobre `--surface`, «Entró» `+RD$84,200.00` y «Salió» `−RD$61,350.00`, cada una con el icono del tipo y debajo, en texto, «12 % más que octubre». Lleva un InfoTip sobre transferencias y saldos iniciales. El chip «Noviembre 2026» cambia el periodo.
  3. **Escalera** del mes (§11.4), de 160px de alto.
  4. **Cuentas:** tira horizontal con scroll-snap de fichas de 148px (icono del tipo, nombre, saldo y sparkline de 30 días). La última ficha es «+ Cuenta».
  5. **Recientes:** 5 filas de la lista de libro y el enlace «Ver todos los movimientos».
- **Escritorio** (rejilla de 12 columnas, separación 24px):
  - fila 1: la tarjeta de saldo en 5 columnas y la Escalera en 7;
  - fila 2: la tabla de cuentas (nombre, tipo, saldo y sparkline) en 5 columnas y la tabla de recientes en 7.

### 10.4 Cuentas

- **Móvil:** se agrupan por tipo (Efectivo, Banco, Tarjeta, Otra).
  - Cada grupo lleva título y subtotal con raya simple.
  - Cada cuenta es una fila de `--fila` con nombre, nota corta en `--ink-3` y el saldo a la derecha, más una sparkline de 30 días a partir de 400px de contenedor. Si el saldo es negativo, la fila muestra `−RD$4,350.00` en `--out` y un InfoTip con «Saldo negativo: revisa si falta una entrada.»
  - El **total general** va al final con doble raya.
  - Las cuentas archivadas van plegadas en «Archivadas (2)».
  - El último renglón dice «+ Nueva cuenta».
- **Escritorio:** tabla con las columnas Cuenta, Tipo, Movimientos (30 d), Saldo y Tendencia, con orden manual arrastrando la fila. Las flechas ↑/↓ son la alternativa con teclado.

### 10.5 Movimientos / Detalle de cuenta

Es la misma pantalla con o sin filtro de cuenta.

- **Encabezado (móvil):**
  - el nombre de la cuenta en H1 y el tipo como chip `info`;
  - el saldo en `AmountText l` con doble raya;
  - al hacer scroll, encoge a una línea (nombre y saldo) mediante una animación ligada al scroll.
- **Filtros:** fila de chips `filter` con scroll horizontal: Periodo («Este mes»), Tipo, Categoría, una por cada dimensión activa (Centro, Fondo, Contacto) y los campos personalizados de tipo lista. Cada chip abre un popover anclado, o una hoja si no hay anchor positioning. Las **vistas guardadas** van como pestañas encima de los chips («Todo», «Gastos fijos», «Por cobrar») con «Guardar vista» al final.
- **Lista de libro** sobre renglones, agrupada por día:
  - **cabecera de día** (de alto `--fila`, sticky): «Martes 24 nov» y, a la derecha, «neto +RD$3,200.00». Cuando queda pegada, se muestra con doble raya inferior si el navegador soporta `scroll-state`;
  - **fila**: el concepto («Compra de cemento») en `--t-body` 520, y debajo la meta «Materiales · Caja · n.º 0142» en `--ink-3`. A la derecha, el monto con signo y color y, debajo, el saldo corrido en `--ink-3` `--t-meta`;
  - **anulada**: concepto y monto tachados, con una mini-etiqueta «Anulado» en `--out`.
- **Acciones de fila:**
  - deslizar a la izquierda revela [Duplicar] [Anular] mediante scroll-snap. Las acciones no se ejecutan solas: son botones reales con `tabindex` gestionado;
  - pulsación larga o el botón ⋯ abre un menú con Ver, Editar, Duplicar y Anular;
  - tocar la fila abre el detalle (§10.10).
- **Escritorio:**
  - tabla `ledger` con las columnas Fecha, N.º, Concepto, Categoría, [dimensiones activas], **Entra**, **Sale** y **Saldo**. Los saldos negativos van entre paréntesis;
  - una casilla por fila y, al seleccionar, una barra de acciones en lote sticky abajo: «3 seleccionados · Anular · Exportar · Quitar selección»;
  - `J`/`K` mueven la selección y `Enter` abre el detalle en el inspector;
  - el selector de densidad (Cómoda/Compacta) está en el encabezado.

### 10.6 Nuevo movimiento (interacción estrella)

**Móvil:** `<dialog>` a altura completa, montado de antemano para abrir en menos de 100ms. El fondo de la hoja se tiñe con el lavado del tipo (`--out-wash` para salida) en `--d-micro`. De arriba abajo:

1. **Barra superior** (56px): [×] Cerrar a la izquierda y, en el centro, el **Segmented** Entrada | Salida | Transferencia, con subrayado del color del tipo.
2. **Monto** (unos 160px):
   - arriba a la derecha, la expresión en `--ink-3` `--t-small` (`1,500 + 350`);
   - debajo, el resultado en `AmountText hero highlight` alineado a la derecha, como en una calculadora, con el resaltador creciendo bajo la cifra al teclear (`background-size` de 0 a 100% en `--d-micro`);
   - a la izquierda, la palabra del tipo grande («Salida») en el color del tipo, `wdth 112`.

   El contenedor es un `<output role="status" aria-live="polite">`. El campo real es un `<input inputmode="none" enterkeyhint="done">` oculto pero enfocable, que recibe el teclado físico y el pegado.
3. **Concepto:** campo de una línea con la etiqueta «Concepto» y el ejemplo «Compra de cemento». Al tocarlo aparece el teclado del sistema y se oculta el Keypad. Debajo salen 3 sugerencias de conceptos recientes como chips. Al pulsar Enter vuelve el Keypad.
4. **Chips de contexto** (con scroll-snap, una fila):
   - `Caja ▾`, que es la cuenta usada la última vez;
   - `Hoy ▾`, que alterna Hoy, Ayer y Elegir fecha;
   - las 6 categorías más frecuentes como chips `choice`;
   - `Más campos`, que abre una subhoja con los campos personalizados y las dimensiones.

   Tocar `Caja ▾` cambia el Keypad por una lista de cuentas **en el mismo lugar**, sin navegar.
5. **Keypad** de 4×4 con teclas de 64px y separación de 8px:
   ```
   7   8   9   ⌫
   4   5   6   ×
   1   2   3   +
   00  0   .   −
   [ + otro ]  [   Anotar salida   ]
   ```
   - La última fila tiene «+ otro» (1 columna, `secondary`), que guarda y deja la hoja abierta con los mismos chips (es la Ráfaga), y **Anotar salida** (3 columnas, `primary` lima, 64px). El texto cambia con el tipo: «Anotar entrada», «Anotar salida», «Transferir».
   - Mantener `⌫` borra todo. Las operaciones son `+ − ×` con la precedencia normal. Si la expresión es inválida se muestra el último resultado válido.
   - `aria-label` de las teclas: «siete», «borrar», «por», «más», «menos», «punto decimal», «doble cero».
6. **Validaciones suaves:**
   - monto 0: la cifra tiembla (3 oscilaciones de 4px en 240ms) y aparece «Escribe un monto»;
   - monto 12 veces mayor que la mediana de esa categoría: InfoTip de aviso «Es mucho más que lo usual en Materiales. ¿Está bien?», que no bloquea;
   - fecha futura: aviso en el chip de fecha.
7. **Al guardar:** view transition de la cifra a su nueva fila en la lista (`view-transition-name: amount-new` temporal). El total del mes cuenta hasta el nuevo valor y sale el toast `undo`: «Anotado · −RD$1,850.00 en Caja» [Deshacer].

**Escritorio:** se abre en el inspector (o en una hoja lateral) como formulario vertical con este orden: Tipo (segmentado), Monto (`Field amount` grande, que acepta aritmética, con el resaltador), Concepto, Cuenta, Fecha, Categoría, dimensiones y campos personalizados, y Notas. El teclado físico va directo al campo de monto. `Ctrl+Enter` guarda y `Ctrl+Shift+Enter` guarda y abre otro. No se muestra el Keypad en pantalla (sí con `pointer: coarse` en tableta).

### 10.7 Transferencia

Se abre desde el segmentado de Nuevo movimiento.

- Los chips de contexto se cambian por **dos fichas de cuenta**, «Desde» y «Hacia», cada una con nombre, icono y saldo actual, unidas por un `IconButton` `ArrowsDownUp` («Invertir cuentas»).
- El monto y el Keypad no cambian. El color es `--xfer`.
- Debajo del monto aparece una vista previa en `--ink-2` `--t-small`:
  `Caja  RD$12,400.00 → RD$9,400.00`
  `Banco RD$3,100.00 → RD$6,100.00`
- InfoTip: «Una transferencia mueve dinero entre tus cuentas. No cuenta como entrada ni como salida.»
- Si la cuenta de origen quedaría en negativo, sale un aviso suave.
- En la lista aparece como **una sola fila**, «Caja → Banco», con el icono `ArrowsLeftRight`.

(La comisión vinculada queda fuera de la demo.)

### 10.8 Captura rápida (escritorio)

Ruta «Captura».

- **Barra de lote:**
  - «Lote» (nombre automático editable: «Lote 26 nov, 14:32»);
  - Cuenta por defecto, Fecha por defecto y Tipo por defecto;
  - **Total de control** (`Field amount`).
- **Rejilla** `Table grid` editable: Fecha | Tipo | Cuenta | Concepto | Categoría | [dimensiones] | Monto.
  - Siempre hay una fila de entrada abierta al final.
  - `Tab` pasa a la celda siguiente, `Enter` crea una fila nueva y `Alt+↓` copia la celda de arriba.
  - La celda de fecha entiende `15`, `ayer`, `-2`. La de monto entiende `1500+350`.
  - Las listas se autocompletan con la primera letra.
  - Las celdas con aviso llevan un borde de 2px en `--warn-ink` y un tooltip.
- **Cinta** (panel derecho de 300px, fondo `--surface`, borde perforado arriba hecho con `mask: radial-gradient(...)`):
  - cada línea es `+ 1,500.00` / `− 350.00` en `wdth 75`, `wght 520`, tabular;
  - al pie: «Suma RD$12,640.00», «Control RD$15,000.00» y **«Faltan RD$2,360.00»** en `--warn-ink`;
  - cuando la diferencia llega a 0, la cinta imprime **«Cuadra.»** en `wght 800`, se dibuja la doble raya y aparece el **sello de cuadre** (§11.1).
- **Acciones:** [Guardar lote] (primary, habilitado siempre y con confirmación si la diferencia ≠ 0: «La suma no cuadra con el control por RD$2,360.00. ¿Guardar igual?») y [Descartar].
- **Debajo:** «Lotes recientes», con fecha, cantidad, suma y [Anular lote]. Anular un lote anula todos sus movimientos y deja rastro.

### 10.9 Ráfaga (móvil)

Es el modo continuo de Nuevo movimiento. Se entra con «+ otro» o desde el menú de la pastilla.

- La hoja se queda abierta.
- Sobre el monto aparece una **minicinta** de 3 líneas (las últimas anotaciones) con «Suma RD$4,200.00». Si se definió un control, también «Faltan RD$800.00».
- Tocar la minicinta la despliega a lista completa, y tocar una línea la devuelve al visor para corregirla.
- Un botón de texto arriba a la derecha dice «Cerrar lote (6)». Si la diferencia ≠ 0, pide confirmación.
- Al cuadrar, el sello se dibuja sobre la minicinta.

### 10.10 Detalle de movimiento e historial

- **Móvil:** BottomSheet a altura alta. **Escritorio:** inspector.
- **Cabecera:**
  - «Salida n.º 0142 · Caja», en `--t-small` `--ink-2`;
  - el monto en `AmountText l`;
  - «Martes 24 nov 2026», y la fecha de registro si es distinta: «anotado el 25 nov».
- **Campos:** lista de definición sobre renglones, en dos columnas (etiqueta en `--ink-2`, valor en `--ink`): Concepto, Categoría, Centro, Fondo, Contacto, campos personalizados, Notas y Lote. Los campos vacíos no se muestran.
- **Acciones:** [Editar], [Duplicar] y [Anular] (`danger`). Anular pide un motivo opcional («Motivo (opcional)», con el ejemplo «Registrado dos veces»).
- **Anulado:**
  - el sello **ANULADO** (§11.5) va sobre la cabecera;
  - el monto se tacha;
  - se muestra «Anulado el 26 nov · Registrado dos veces»;
  - la acción cambia a [Restaurar].
- **Historial de cambios:** línea de tiempo vertical que solo crece, con trazo de 1px `--rule-strong`. Cada entrada lleva fecha y hora con la acción («26 nov 2026, 14:32 · Editado»). Debajo, cada cambio:
  `Monto  ~~RD$1,500.00~~ → RD$1,850.00`
  `Categoría  ~~Varios~~ → Materiales`

  El valor viejo va tachado en `--ink-3` y el nuevo en `--ink`. La primera entrada siempre es «Anotado».

### 10.11 Resumen

- **Arriba:** el chip de periodo («Noviembre 2026», con «Este mes», «Mes anterior», «Este año» y «Personalizado») y [Editar resumen].
- **Bloques** (cada uno es una Card, nunca anidados):
  - **Flujo:** la Escalera, en grande;
  - **Por categoría:** barras horizontales ordenadas de mayor a menor, con la etiqueta a la izquierda y el monto y el % a la derecha. Las salidas llevan trama;
  - **Por dimensión:** igual, con un selector de dimensión;
  - **Saldo por cuenta;**
  - **Mayores salidas:** top 5;
  - **Mes contra mes:** tabla con las columnas mes, entró, salió y neto, y doble raya.
- **Modo edición:**
  - cada bloque muestra un asa, ↑, ↓ y [Quitar];
  - al final, «+ Añadir bloque» abre una hoja con los bloques disponibles y una miniatura;
  - el orden se guarda por Espacio.
- **Escritorio:** rejilla de 12 columnas. Los bloques miden 6 o 12 columnas según su tipo.

### 10.12 Informes

- **Configuración** (panel izquierdo de 320px en escritorio; en móvil, una hoja con pasos):
  - **Tipo:** segmentado con Resumido y Detallado;
  - **Periodo**;
  - **Agrupar por:** hasta 2 dimensiones;
  - **Filtros:** chips;
  - el interruptor «Incluir anulados», apagado por defecto.
- **Vista previa:** una hoja de papel Carta (o A4, según el ajuste) a escala, sobre `--sunken`, con `--sh-2`. Lleva un encabezado con el Espacio, «Informe resumido por categoría», «1 al 30 de noviembre de 2026», los filtros aplicados y «Emitido el 26 nov 2026, 14:32».
  - El resumido muestra grupos con subtotal (raya simple) y total general (doble raya).
  - El detallado muestra Fecha, N.º, Concepto, Entra, Sale y Saldo.
  - Los negativos van entre paréntesis.
- **Exportar:** [Imprimir / PDF] (primary), [CSV], [XLSX] y [Compartir], que solo aparece si `navigator.canShare({ files })`.
- **`@media print`:** tinta negra sobre blanco, renglones a 0.5pt gris, sin navegación ni sombras, encabezado repetido en cada página (`thead`) y número de página.

### 10.13 Campos y listas

- **Lista de campos:** filas de `--fila` con el icono del tipo, el nombre («Centro de costo»), el tipo en `--ink-3` y tres chips-interruptor: «Formulario», «Filtros» y «Agrupar». A la derecha, el `Switch` Activo.
  - Los inactivos se muestran en `--ink-3` y van al final, en «Inactivos (1)».
  - Desactivar nunca borra.
- **Editor de campo** (hoja o inspector):
  - Nombre y Tipo. El tipo es fijo una vez que el campo tiene datos, y lo explica un InfoTip.
  - Para listas, el editor de opciones: cada opción es una fila con asa de arrastre, ↑ ↓, punto de tinta (8 tintas), nombre editable en línea y menú ⋯ con Desactivar y Fusionar con…
  - «Fusionar» pide la opción de destino y muestra «Se moverán 42 movimientos de "Varios" a "Otros gastos". Quedará en el historial.»
- **Escritorio:** a la derecha, una vista previa en vivo del formulario de Nuevo movimiento con los campos activos.

### 10.14 Respaldo, restauración e importación

- **Estado del respaldo:** Card con «Último respaldo» y, en `--t-h1`, «Hace 3 días». Pasa a `--warn-ink` con el icono de aviso después de 7 días. Debajo va el nombre del archivo.
  - [Descargar respaldo] (primary) genera `cuadra-respaldo-2026-11-26.cuadra`.
  - Antes de cualquier restauración o importación se hace una copia automática local, y lo explica un InfoTip.
- **Restaurar:**
  1. [Elegir archivo];
  2. resumen del contenido: «3 espacios · 9 cuentas · 1,284 movimientos · creado el 20 nov 2026»;
  3. Dialog `destructive`: «Esto reemplaza los datos actuales. Antes guardaremos una copia automática.» [Cancelar] [Restaurar];
  4. el sello de cuadre y el toast «Datos restaurados».
- **Importar CSV**, un asistente de 4 pasos con el indicador «Paso 2 de 4»:
  1. **Archivo:** se elige el archivo y se detectan solos el separador y la codificación.
  2. **Columnas:** cada columna del CSV es una fila con su nombre, 3 valores de muestra en `--ink-3` y un Select «Va a: Fecha / Concepto / Monto / Entra / Sale / Cuenta / Categoría / [campo] / Ignorar».
  3. **Vista previa:** 20 filas en `Table`. Las celdas con problema llevan fondo `--warn-wash` y tooltip («Fecha no reconocida: 31/02/2026»). El resumen dice «198 listas · 2 con avisos».
  4. **Importar:** se crea como **lote anulable**: «Importado como Lote "Banco nov.csv". Puedes anularlo entero.»

### 10.15 Más y Ajustes

En móvil, la página «Más» es una lista de grupos.

- **Libro:** Cuentas, Resumen, Informes, Captura (ráfaga), Historial general.
- **Configuración:** Campos y listas, Plantilla del espacio, Respaldo e importación.
- **Espacio:** nombre, tinta, moneda y formato.
- **Apariencia:** segmentado Sistema | Claro | Oscuro, y la densidad (en escritorio).
- **App:** [Instalar Cuadra] (solo si es instalable), Atajos de teclado y Acerca de.

En escritorio, Ajustes es una página con dos columnas: el índice a la izquierda y el contenido a la derecha.

### 10.16 Estados vacíos

Llevan renglones de fondo y **una sola línea** en `--ink-2`, `--t-h3`, colocada sobre el segundo renglón, más una acción. Sin ilustraciones ni emojis.

| Dónde | Texto | Acción |
|---|---|---|
| Movimientos, primer uso | «Aquí van tus movimientos.» | [Anotar el primero] (abre Nuevo movimiento) |
| Inicio, espacio nuevo | «Tu libro está en blanco. Empieza por lo que entró hoy.» | [Anotar] |
| Filtros sin resultados | «Nada con estos filtros.» | [Quitar filtros] |
| Resumen sin datos | «Cuando anotes movimientos, aquí verás en qué se va el dinero.» | — |
| Selector de espacios vacío | «Crea un espacio por negocio o por cliente.» | [+ Nuevo espacio] |
| Captura sin lotes | «Los lotes que guardes aparecerán aquí y podrás anularlos enteros.» | — |
| Errores de carga | «No pudimos abrir este espacio. Tus datos siguen en el dispositivo.» | [Reintentar] y [Ver respaldo] |

---

## 11. Detalles de firma

Son cinco y no hay más. Todos se desactivan o se muestran ya completos con `prefers-reduced-motion`.

1. **Sello de cuadre.** Es un SVG de 4 trazos (`<path>` por lado) que forman un cuadrado de esquinas vivas, con trazo de 3px en `--ink` y relleno `--lime` que entra al final.
   - **Animación:** cada lado anima `stroke-dashoffset` en secuencia (4 × 110ms) y luego el relleno aparece en 80ms, en total `--d-stamp`. Va acompañado de `navigator.vibrate([6, 40, 10])` si existe.
   - **Aparece en:** total de control cuadrado (Captura y Ráfaga), fin del onboarding y restauración completada.
   - **Es también el logotipo:** en el icono de la app va sobre `--forest`.
2. **Resaltador único.** Es un trazo lima bajo la cifra protagonista: alto 0.18em, `skewX(-8deg)`, desplazado 0.08em por debajo de la línea base y con los extremos ligeramente irregulares (`border-radius: 2px 6px 3px 5px`). Se dibuja con `background-size` de `0% 100%` a `100% 100%` en `--d-micro` cuando la cifra cambia. Uno por pantalla.
3. **Doble raya viva.** Bajo cada total van dos líneas de 1px con 2px de separación. Cuando el total cambia, se redibujan con `scaleX` de 0 a 1 desde la derecha en `--d-stamp`, a la vez que la cifra cuenta.
4. **Gráfica Escalera.**
   - **Trazado:** barras diarias espejadas sobre un eje horizontal, con las entradas hacia arriba en `--chart-in` y las salidas hacia abajo en `--chart-out` con trama diagonal. El saldo es una línea **escalonada** (`step-after`) de 2px en `--ink` en un eje propio.
   - **Interacción:** al arrastrar el dedo o mover el cursor, se fija un día: su barra toma `--chart-select` y la línea vertical se marca en `--rule-strong`. Arriba se lee «Mar 24 · +RD$5,200.00 · −RD$2,000.00 · saldo RD$41,300.00» en `AmountText m`.
   - **Teclado:** el gráfico es enfocable y ←/→ recorren los días, con un `aria-live` que anuncia cada uno.
   - **Alternativa:** «Ver como tabla».
5. **Correcciones visibles.** Lo que se cambia nunca se borra:
   - el historial tacha el valor viejo;
   - una fila anulada se tacha y queda en el libro;
   - en el detalle, el **sello ANULADO** es un recuadro de 2px en `--void` con «ANULADO» en `wght 800` `wdth 112` mayúsculas, rotado −4°, con `mix-blend-mode: multiply` en claro y `screen` en oscuro, y opacidad .9.

---

## 12. Accesibilidad

- **Contraste** verificado (WCAG 2.x, cálculo OKLCH → sRGB):
  - claro: `--ink` 15.1:1, `--ink-2` 7.8:1, `--ink-3` 5.1:1 (4.7 sobre `--surface-2`), `--accent-ink` 5.8:1, `--in`/`--out`/`--xfer` ≥5.2:1 sobre papel y sobre su lavado, `--on-lime` sobre `--lime` 13.3:1, `--on-forest` 11.8:1, `--control` 3.3–3.5:1;
  - oscuro: todos los textos ≥5.4:1 y `--control` ≥3.2:1.
  - El lima sobre papel claro mide 1.1:1, y por eso **nunca** es texto ni foco solo en claro.
- **Foco:** contorno de 2px `--focus-ring` (tinta en claro, lima en oscuro) a 2px de distancia, más un halo lima de 3px. Se ve en los dos temas y sobre el bosque. Al cerrar un diálogo u hoja, el foco vuelve al disparador. Tras una view transition, el foco pasa al título de la vista nueva cuando termina (`finished`).
- **Objetivos táctiles:** ≥48px, teclas de 64px, pastilla Anotar de 64px de alto.
- **Teclado propio:** el campo real es un `<input inputmode="none">` enfocable, que acepta teclado físico, pegado (que se sanea) y lectores de pantalla. En Ajustes hay una opción «Usar el teclado del sistema para montos» (cambia a `inputmode="decimal"`) para TalkBack o para quien la prefiera.
- **Anuncios:** el monto del visor y los totales que cambian usan `role="status"`. Los errores de formulario se anuncian con `aria-describedby` y foco al primer campo con error.
- **Gestos:** todo gesto tiene una alternativa visible. Deslizar fila → menú ⋯. Pulsación larga en Anotar → `CaretUp`. Arrastrar en la Escalera → flechas de teclado.
- **Escala de texto:** todo en `rem`, con `<meta name="text-scale" content="scale">`. A 200% no hay scroll horizontal. Como `--fila` está en rem, las filas y los renglones del fondo crecen juntos.
- **Movimiento reducido:** el conteo, el sello, la doble raya y el resaltador aparecen ya completos. Las view transitions y las hojas pasan a ser fundidos de 120ms, y no hay temblor de validación (en su lugar, borde de aviso).
- **Idioma:** `lang="es"` y `aria-label` con montos leídos en palabras (§5.8).

---

## 13. APIs modernas de plataforma y respaldo

Regla del proyecto: se puede usar lo que sea *Baseline* (incluido «newly available») si se detecta con `@supports` o en JS y degrada con elegancia, sin polyfills pesados. **Hay que probar también en WebKitGTK (Tauri en Linux)**, no solo en Chrome.

| API | Uso en Cuadra | Detección | Si no hay soporte |
|---|---|---|---|
| Container queries + `cqi` | Shell, tarjetas, tabla, tamaño de cifra | — (amplio soporte) | — |
| `<dialog>` + `showModal()` | Hojas, confirmaciones, paleta | — | — |
| `closedby="any"` | Cerrar hoja tocando fuera o con Atrás | `'closedBy' in HTMLDialogElement.prototype` | Manejador propio de clic en el fondo + Esc nativo + botón Cerrar siempre visible |
| `@starting-style` + `transition-behavior: allow-discrete` + `overlay` | Entrada y salida de hojas y popovers | `@supports` | Aparecen sin animación |
| Popover API (`popover`, `popovertarget`) | Menús, InfoTip, toasts, combobox | — (Baseline) | — |
| Anchor positioning (`anchor-name`, `position-anchor`, `position-try-fallbacks: flip-block`) | Menú de Anotar, filtros, InfoTip, combobox | `@supports (anchor-name: --a)` | Se muestran como hoja inferior en móvil y con posición fija calculada en escritorio |
| View Transitions (mismo documento) | Cifra → fila, lista → detalle, lomo → encabezado, pasos del onboarding | `document.startViewTransition` | Cambio instantáneo. En React: `startViewTransition(() => flushSync(update))`; los nombres de transición se asignan justo antes y se quitan al terminar |
| Animaciones ligadas al scroll (`animation-timeline: scroll()`) | Encabezado que se encoge en Inicio y en Cuenta | `@supports (animation-timeline: scroll())` | Encabezado estático completo |
| `scroll-state` container queries | Doble raya en la cabecera de día pegada | `@supports (container-type: scroll-state)` | Cabecera pegada sin ese estilo |
| Scroll snap | Chips, tira de cuentas, deslizar para revelar | — | — |
| `interpolate-size` / `calc-size()` | Desplegar plantillas y grupos plegados | `@supports (interpolate-size: allow-keywords)` | Se abren sin animación |
| `field-sizing: content` | Notas | `@supports` | `rows="3"` y crecimiento por JS |
| `text-wrap: balance / pretty` | Títulos y textos | — | Ajuste normal |
| `linear()` | Muelle de las hojas | `@supports (transition-timing-function: linear(0, 1))` redefine `--ease-spring` | `--ease-out` |
| `env(safe-area-inset-*)` + `dvh` | Barra inferior, hojas, teclado | — | — |
| `<meta name="text-scale">` | Escala de texto del sistema | — | Ignorado sin efecto |
| `navigator.vibrate` | Teclas (8ms), sello | `'vibrate' in navigator` | Solo respuesta visual |
| PWA: manifest + `shortcuts` + instalación | Instalar en Android, accesos directos | `<install>` / `navigator.install` → `beforeinstallprompt` → instrucciones | El botón «Instalar Cuadra» de Más solo aparece cuando hay vía; si no, «Cómo instalar» con pasos |
| Web Share con archivos | Compartir informe y respaldo | `navigator.canShare({ files })` | El botón no aparece; queda Descargar |
| `interestfor` (hint popovers) | Tooltips de IconButton | `'interestForElement' in HTMLButtonElement.prototype` | `title` + popover al enfocar |

---

## 14. Movimiento

- **Pulsación:** `scale(.97)` (teclas `.94`) en `--d-press`, que se dispara en `pointerdown`.
- **Hojas:** suben 24px con opacidad de 0 a 1 en `--d-sheet` `--ease-spring`. Salen en 200ms `--ease-out`.
- **Rutas:** fundido cruzado de 160ms y desplazamiento de 12px en la dirección de navegación (con `types` de view transition `adelante`/`atrás`).
- **Datos:** el conteo de totales va en `--d-count`. Las barras de las gráficas crecen desde el eje en 320ms, solo la primera vez que entran en pantalla.
- **Prohibido:** rebotes en datos, parallax, animar al hacer scroll algo distinto del encabezado, y animaciones en bucle salvo el cursor del visor (parpadeo de 1s, que se quita con movimiento reducido).

---

## 15. Prohibido

Son clichés de plantilla y errores que este proyecto no acepta:

- Texto con degradado, degradados morado-azul y glassmorphism o `backdrop-filter` decorativo.
- Fuentes Inter, Roboto, Poppins o la de sistema como fuente de marca. Más de una familia.
- Iconos dentro de círculos o cuadrados de color, cuadrículas de tres «tarjetas de característica» y emojis en la UI.
- Trío de tarjetas KPI con pastillas «+12% ↑» de colores en todas partes. Las comparaciones van en texto llano.
- Gráficas de dona o de pastel, ejes con 8 líneas de cuadrícula y leyendas que obligan a cruzar colores.
- Tarjetas dentro de tarjetas. Borde lateral de color como acento de tarjeta.
- Lima como texto sobre claro, más de un resaltador por pantalla y lima en pestañas, chips o gráficas.
- `#000` y `#fff` puros, y sombras grises neutras (todas van teñidas de bosque).
- Etiquetas en mayúsculas pequeñas encima de cada título.
- Placeholder usado como etiqueta, acciones visibles solo en hover y botones deshabilitados sin explicación.
- Montos truncados con «…», montos centrados en tablas, guion en lugar de signo menos y flotantes para dinero.
- Rojo/verde como única señal de tipo.
- Borrar en lugar de anular. Confirmaciones genéricas («¿Estás seguro?»): se nombra la consecuencia.
- Toasts para errores que exigen acción y modales centrados para el detalle en escritorio.
- Saludos falsos («¡Bienvenido de nuevo, Juan!»), avatares de personas inventadas y lorem ipsum. Los datos de ejemplo van rotulados como «Ejemplo».
- Shimmer de esqueleto en una app local: los datos cargan en milisegundos. Si tarda más de 300ms, se muestra un texto («Abriendo el libro…»).

---

## 16. Orden de construcción

Si falta tiempo, se construye en este orden:

1. **P0:** tokens y base; shell con las cuatro clases de ancho; `AmountText`; Ledger list; Nuevo movimiento móvil con Keypad, Segmented y chips; Inicio (tarjeta de saldo, Este mes, recientes); Movimientos / Detalle de cuenta; Detalle de movimiento con anular e historial.
2. **P1:** Transferencia; onboarding con plantillas; Cuentas; Captura de escritorio con cinta y sello; Informes con impresión y CSV; Respaldo y restauración.
3. **P2:** Escalera interactiva (antes, barras simples); Resumen configurable; Campos y listas con fusión; importación CSV; deslizar para revelar; view transitions; encabezado ligado al scroll; paleta de comandos; XLSX.

---

## 17. Origen de esta dirección

Para la próxima iteración: esta dirección parte del concepto **Renglón y Resaltador**, porque es el único que respeta la paleta de las referencias del usuario (lima sobre bosque y papel claro), usa una sola familia tipográfica y convierte la marca en la acción de cuadrar. De los otros dos conceptos se injertaron estas ideas:

- **De «Papel de columnas»:**
  - la doble raya en todos los totales;
  - los paréntesis y las columnas Entra/Sale, pero solo en tablas e informes;
  - el renglón de fondo atado a la misma variable `--fila` que la fila, para que nunca se desalinee;
  - la cinta de Captura que imprime «Cuadra.»;
  - la vista previa de saldos en transferencias.
- **De «Sumadora»:**
  - el campo real con `inputmode="none"` bajo el teclado propio;
  - la tecla «+ otro» como entrada visible a la ráfaga;
  - el toast «Anotado · Deshacer»;
  - los accesos directos del manifest;
  - el inspector fijo en escritorio;
  - la altura de fila según `pointer`.
- **Se descartó:**
  - el rosa como acento, que choca con las referencias y con un público conservador;
  - el flick de tipo, difícil de descubrir y fácil de disparar sin querer;
  - el odómetro dígito por dígito, sustituido por un conteo tabular;
  - deslizar sobre la cifra para cambiar de tipo, porque ya está el segmentado;
  - la segunda y la tercera familia tipográfica;
  - el margen rojo de libreta, que se confundía con la tinta de salida.
