import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5190,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3090' },
      '/site': { target: 'http://127.0.0.1:3090' },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
