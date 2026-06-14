import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['bench/node/**/*.bench.ts'],
  },
  benchmark: {
    include: ['bench/node/**/*.bench.ts'],
    outputFile: 'bench/results/node-results.json',
  },
});
