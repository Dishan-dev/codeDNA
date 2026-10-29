import { build } from 'esbuild';
await Promise.all([
  build({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['vscode'],
    outfile: 'dist/extension.cjs',
    sourcemap: true,
  }),
  build({
    entryPoints: ['src/worker.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: 'dist/worker.cjs',
    sourcemap: true,
  }),
  build({
    entryPoints: ['src/webview/main.tsx'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    outfile: 'dist/webview.js',
    loader: { '.woff': 'file', '.woff2': 'file' },
    sourcemap: true,
  }),
]);
