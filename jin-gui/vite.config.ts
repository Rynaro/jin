import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [{
    name: 'jin-deterministic-fixture-cache-bust',
    transformIndexHtml(html) {
      return html.replace(
        '/tools/tauri-fixture-init.js',
        '/tools/tauri-fixture-init.js?v=notification-center-v1',
      );
    },
  }],
  // jin-gui uses Tauri — the dev server binds to a non-default port
  // (matches tauri.conf.json devUrl).
  server: {
    port: 1420,
    strictPort: true,
    host: '127.0.0.1',
  },
  // Vite uses '/' normally; Tauri uses the custom protocol in production.
  base: './',
  // Test config (vitest).
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    globals: false,
  },
});
