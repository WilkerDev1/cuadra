// Regenera los iconos PWA (pwa-*.png, maskable, apple-touch, favicon.ico) a partir de public/favicon.svg.
// Uso: pnpm icons
import { execFileSync } from 'node:child_process';

execFileSync('pnpm', ['exec', 'pwa-assets-generator', '--config', 'pwa-assets.config.ts'], { stdio: 'inherit' });
