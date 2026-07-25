import { isAbsolute, resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // The hash worker (spec 20.2) is a second entry so it is emitted as its own
        // `out/main/hashWorker.js`. Electron-vite's Node build does not apply Vite's
        // browser-worker transform to `new Worker(new URL(...))`, so the worker must
        // be produced explicitly; `storage/hash.ts` resolves it at runtime.
        input: {
          index: resolve(import.meta.dirname, 'src/main/index.ts'),
          hashWorker: resolve(import.meta.dirname, 'src/main/storage/hashWorker.ts'),
        },
        // Setting `input` drops externalizeDepsPlugin's external list, which would
        // inline every dependency (fastify, ciao, @peculiar/x509 — the native/shim
        // deps that must stay external, per the dev-loop notes). Re-assert it: bundle
        // only our own relative/absolute source, externalize every bare + node:
        // specifier.
        external: (source) => !source.startsWith('.') && !isAbsolute(source),
      },
    },
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
