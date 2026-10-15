import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/standalone',
  fullyParallel: false,
  workers: 1,
  use: {
    trace: 'on-first-retry',
    launchOptions: {
      args: ['--host-resolver-rules=MAP textify.test 127.0.0.1'],
    },
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  snapshotPathTemplate: 'tests/standalone/__screenshots__/{testFilePath}/{arg}-{projectName}{ext}',
});
