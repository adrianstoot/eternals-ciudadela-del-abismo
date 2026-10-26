import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: { entries: ['index.html'] },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/_chrome_tmp*/**', '**/_work/**', '**/output/**', '**/tools/**'] },
  },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 2500,
  },
});
