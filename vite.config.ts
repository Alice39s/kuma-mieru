import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiPort = Number.parseInt(process.env.KUMA_MIERU_V2_API_PORT ?? '3882', 10);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@v2': resolve(import.meta.dirname, 'src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 3881,
    proxy: {
      '/api': `http://127.0.0.1:${apiPort}`,
      '/health': `http://127.0.0.1:${apiPort}`,
    },
  },
  build: {
    outDir: 'dist/v2/client',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
  },
});
