const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests', reporter: [
  ['list'],
  ['html', { open: 'never' }]
],
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:5500',
    browserName: 'chromium',
    headless: true,
  },
  webServer: {
    command: 'npx http-server . -p 5500 -a 127.0.0.1 -c-1',
    url: 'http://127.0.0.1:5500',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
