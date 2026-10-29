import { defineConfig, devices } from '@playwright/test';
// Pré-requisito: scripts/e2e-up.sh (Postgres + gateway de teste + build de produção + vite preview em 4173).
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    ...devices['Pixel 7'],
    launchOptions: { executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' },
    trace: 'retain-on-failure',
  },
});
