import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte()],
  build: {
    target: 'es2022',
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/game/**/*.ts'],
      // Canvas painting, DOM glue and Svelte screens are covered by the Playwright suite.
      exclude: ['src/game/render/**', 'src/game/host.ts'],
      thresholds: { lines: 88, functions: 90, branches: 75, statements: 85 },
    },
  },
});
