import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Mirrors the Next.js `@/` alias and JSX runtime so component modules can be imported in tests.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } },
  esbuild: { jsx: 'automatic' },
});
