import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    watch: {
      usePolling: process.env.MARGIN_DEV_POLLING === '1',
      interval: 250,
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4174,
    strictPort: true,
  },
  build: {
    target: 'esnext',
  },
})
