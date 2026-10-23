import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/src/**/*.test.ts'],
    environment: 'node',
    // The car scene's checks (zfight.test.ts above all) hold every face of the map at once, more
    // than Node's default heap.
    execArgv: ['--max-old-space-size=6144'],
  },
});
