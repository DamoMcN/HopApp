// Before the database tests: build a fresh test database and point the PHP at it.

const fs = require('fs');
const path = require('path');
const { ROOT, TEST_DB, LOCAL_CONFIG, LOCAL_CONFIG_MARK, appUrl, runSql, phpConfig } = require('./db');

module.exports = async () => {
  if (!/^[A-Za-z0-9_]+$/.test(TEST_DB) || TEST_DB === 'hop_app_db') {
    throw new Error(`HOP_TEST_DB must be a separate database, not "${TEST_DB}".`);
  }

  // Never overwrite a db_config.local.php someone made by hand
  if (fs.existsSync(LOCAL_CONFIG) && !fs.readFileSync(LOCAL_CONFIG, 'utf8').includes(LOCAL_CONFIG_MARK)) {
    throw new Error('backend/db_config.local.php already exists and was not made by the tests. ' +
      'Move it away before running npm run test:db.');
  }

  // 1. Fresh database from the schema (hop_app_db.sql already includes every migration)
  try {
    runSql(`DROP DATABASE IF EXISTS \`${TEST_DB}\`; CREATE DATABASE \`${TEST_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
      { database: null });
  } catch (error) {
    throw new Error('Could not reach MySQL. Is WAMP running? ' + String(error.stderr || error.message).trim());
  }
  runSql(fs.readFileSync(path.join(ROOT, 'database', 'hop_app_db.sql'), 'utf8'));

  // 2. Point the PHP at it
  fs.writeFileSync(LOCAL_CONFIG, phpConfig());

  // 3. Check WAMP serves this folder and the PHP really uses the test database
  let reply;
  try {
    reply = await fetch(appUrl() + 'backend/auth/login.php', {
      method: 'POST',
      body: new URLSearchParams({ user_email: 'setup-check@example.test', user_password: 'x' })
    });
  } catch (error) {
    fs.rmSync(LOCAL_CONFIG, { force: true });
    throw new Error(`Could not reach ${appUrl()}. Is WAMP running? Set HOP_APP_URL if this folder is served elsewhere.`);
  }
  const text = await reply.text();
  if (!text.includes('bad_credentials')) {
    fs.rmSync(LOCAL_CONFIG, { force: true });
    throw new Error(`${appUrl()}backend/auth/login.php did not answer as expected: ${text.slice(0, 200)}`);
  }
};
