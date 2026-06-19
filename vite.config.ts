import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
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
