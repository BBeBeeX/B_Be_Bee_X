import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: 'main/index.ts' } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    // CJS: a sandboxed preload cannot be an ES module.
    build: {
      rollupOptions: { input: 'preload/index.ts', output: { format: 'cjs', entryFileNames: 'index.cjs' } },
    },
  },
  renderer: {
    root: 'renderer',
    plugins: [react()],
    build: { rollupOptions: { input: 'renderer/index.html' } },
  },
})
