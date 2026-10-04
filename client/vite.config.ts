import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/ws': { target: 'ws://localhost:7777', ws: true },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
});
