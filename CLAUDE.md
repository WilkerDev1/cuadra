# CLAUDE.md

Cuadra: libreta financiera (libro de caja, no partida doble) para negocios pequeños y medianos y contadores independientes. Web/PWA primero, cáscara Tauri 2 para escritorio. Interfaz y documentación en español; código e identificadores en inglés.

Lee antes de tocar nada: [docs/PLAN.md](docs/PLAN.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) y [docs/DESIGN.md](docs/DESIGN.md). Si un documento y el código discrepan, gana el código y se corrige el documento.

## Comandos

```bash
pnpm install
pnpm dev          # Vite
pnpm test         # Vitest (núcleo y datos)
pnpm lint         # tsc --noEmit
pnpm build        # compilación web/PWA
pnpm tauri dev    # escritorio (opcional)
```

## Reglas

- Pruebas primero en `src/core` y `src/data`: ninguna regla de dinero sin prueba.
- Capas: `core` no importa nada de React ni del DOM; `features/*` no se importan entre sí; todo acceso a datos pasa por los servicios del núcleo.
- Montos: enteros en unidad menor. Nunca flotantes para dinero.
- Nada se borra: se anula o se desactiva, y queda en el historial.
- UI: usa los tokens de `src/ui/tokens.css`; no colores ni medidas sueltas. Antes de escribir HTML/CSS/JS de interfaz, consulta la skill `modern-web-guidance` (`.claude/skills/modern-web-guidance`).
- **Browser Support:** se permiten funciones "Baseline Newly available" si se detectan con `@supports`/feature detection y degradan con elegancia; sin polyfills pesados.
- Solo se reutiliza código de licencias permisivas (MIT, Apache-2.0, BSD, ISC). De proyectos GPL/AGPL solo ideas.
- Conventional Commits.
