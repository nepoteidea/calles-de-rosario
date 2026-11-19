import { defineConfig, devices } from '@playwright/test';

const PORT = 4175;
const landscape = (d: (typeof devices)[string]) => ({
  ...d,
  viewport: { width: d.viewport.height, height: d.viewport.width },
});

// Browsers to run. CI sets E2E_BROWSERS=all to cover Chrome, Firefox and Safari (WebKit).
const all = process.env.E2E_BROWSERS === 'all';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile\.spec/ },
    { name: 'android-chrome', use: landscape(devices['Pixel 7']) },
    ...(all
      ? [
          { name: 'desktop-firefox', use: { ...devices['Desktop Firefox'] }, testIgnore: /mobile\.spec/ },
          { name: 'desktop-safari', use: { ...devices['Desktop Safari'] }, testIgnore: /mobile\.spec/ },
          { name: 'ios-safari', use: landscape(devices['iPhone 15']) },
        ]
      : []),
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
