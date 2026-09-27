import { defineConfig, devices } from '@playwright/test';

// Testene kjøres mot et produksjonsbygg servert under samme base-sti som
// GitHub Pages (/<repo>/), så feil i base-stien fanges opp før publisering.
const base = process.env.VITE_BASE ?? '/Leilighet-3d/';
const port = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}${base}`,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        launchOptions: {
          // WebGL i hodeløs Chromium via SwiftShader.
          args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
        },
      },
    },
  ],
  webServer: {
    command: `npx vite build && npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}${base}`,
    env: { VITE_BASE: base },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
