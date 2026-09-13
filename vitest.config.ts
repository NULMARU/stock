import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Workspace test runner: pure packages, app logic units, and server jobs.
// DOM/browser behaviour is covered by build + manual evidence, not jsdom.
export default defineConfig({
  resolve: {
    alias: {
      '@stock/simulation-core': path.resolve(__dirname, './packages/simulation-core/src/index.ts'),
      '@stock/infrawheel-model': path.resolve(__dirname, './packages/infrawheel-model/src/index.ts'),
      '@stock/financial-analysis': path.resolve(__dirname, './packages/financial-analysis/src/index.ts'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'src/**/*.test.{ts,tsx}',
      'server/**/*.test.{ts,mjs}',
      'scripts/financials/**/*.test.mjs',
    ],
  },
})
