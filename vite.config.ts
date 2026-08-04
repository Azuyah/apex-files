import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // The desktop/customer bundle keeps relative assets for Electron. The
  // standalone admin service also serves /admin, so its assets must resolve
  // from the service root instead of /admin/assets.
  base: process.env.VITE_APP_MODE === 'admin' ? '/' : './',
  build: {
    outDir: 'app-dist',
    emptyOutDir: true,
  },
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: process.env.DEV_API_TARGET || 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
});
