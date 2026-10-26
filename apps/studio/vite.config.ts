import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5190,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3090', changeOrigin: true, rewrite: (path) => path.replace(/^\/api/, '') },
      '/site': { target: 'http://127.0.0.1:8899', changeOrigin: true, rewrite: (path) => path.replace(/^\/site/, '') },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
