// Database tests: the real PHP on WAMP with a separate MySQL test database.
// Run with: npm run test:db   (WAMP must be running)
// They are kept apart from the normal tests (npm test), which need no PHP or MySQL,
// so GitHub Actions only runs the normal ones.

const { defineConfig } = require('@playwright/test');
const { appUrl } = require('./tests-db/db');

module.exports = defineConfig({
  testDir: './tests-db',
  testMatch: '*.db.spec.js',
  globalSetup: './tests-db/global-setup.js',
  globalTeardown: './tests-db/global-teardown.js',
  workers: 1,              // one shared database, so run one test at a time
  timeout: 30_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-db' }]],
  outputDir: 'test-results-db',
  use: {
    baseURL: appUrl(),
  },
});
