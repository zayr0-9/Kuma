import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // electron must stay external (the runtime built-in) — bundling pulls in
        // the npm installer shim, which requires child_process and dies inside
        // the sandbox. Belt and braces with externalizeDepsPlugin above.
        external: ['electron'],
        // Sandboxed preload scripts (spec 20.1) cannot be ESM; emit CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    plugins: [react()],
  },
});
