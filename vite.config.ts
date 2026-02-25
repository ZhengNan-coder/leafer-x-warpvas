import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  root: 'demo',
  resolve: {
    alias: {
      'leafer-x-warpvas': resolve(__dirname, 'src/index.ts'),
    },
  },
  server: {
    port: 5174,
    open: true,
  },
  build: {
    outDir: '../dist',
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'LeaferXWarpvas',
      fileName: 'leafer-x-warpvas',
    },
    rollupOptions: {
      external: ['leafer-ui', '@leafer-ui/core'],
    },
  },
})
