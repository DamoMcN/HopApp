// Shared settings and helpers for the database tests (npm run test:db).
//
// These tests call the real PHP on WAMP, which uses a separate MySQL database
// (hop_app_test by default), so your real hop_app_db data is never touched.
// Every setting can be changed with an environment variable:
//
//   HOP_APP_URL   where WAMP serves this folder   (default: worked out from the folder, e.g.
//                                                   http://localhost/HopApp/HopApp-tests/)
//   HOP_TEST_DB   test database name               (default: hop_app_test)
//   HOP_DB_HOST   MySQL host                       (default: localhost)
//   HOP_DB_USER   MySQL user                       (default: root)
//   HOP_DB_PASS   MySQL password                   (default: empty, as on WAMP)
//   HOP_MYSQL     path to mysql.exe                (default: newest one under C:\wamp64\bin\mysql)

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WAMP_WWW = process.env.HOP_WAMP_WWW || 'C:/wamp64/www';

const TEST_DB = process.env.HOP_TEST_DB || 'hop_app_test';
const DB_HOST = process.env.HOP_DB_HOST || '';      // empty = MySQL's default (localhost)
const DB_USER = process.env.HOP_DB_USER || 'root';
const DB_PASS = process.env.HOP_DB_PASS || '';
const LOCAL_CONFIG = path.join(ROOT, 'backend', 'db_config.local.php');
const LOCAL_CONFIG_MARK = '// Written by tests-db (npm run test:db). Deleted when the tests finish.';

function appUrl() {
  if (process.env.HOP_APP_URL) return process.env.HOP_APP_URL.replace(/\/?$/, '/');
  const rel = path.relative(WAMP_WWW, ROOT).split(path.sep).join('/');
  return 'http://localhost/' + rel + '/';
}

function mysqlPath() {
  if (process.env.HOP_MYSQL) return process.env.HOP_MYSQL;
  if (process.platform !== 'win32') return 'mysql';   // Linux / GitHub Actions: mysql is on the PATH
  const base = 'C:/wamp64/bin/mysql';
  const versions = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => /^mysql/.test(d)).sort() : [];
  if (!versions.length) throw new Error('mysql.exe not found. Set HOP_MYSQL to its full path.');
  return path.join(base, versions[versions.length - 1], 'bin', 'mysql.exe');
}

// Runs SQL with the mysql command line. Returns rows as arrays of strings (NULL -> null).
function runSql(sql, { database = TEST_DB } = {}) {
  const args = ['-u', DB_USER, '--batch', '--skip-column-names', '--default-character-set=utf8mb4'];
  if (DB_HOST) args.push('-h', DB_HOST);
  if (database) args.push(database);
  const out = execFileSync(mysqlPath(), args, {
    input: sql,
    encoding: 'utf8',
    env: { ...process.env, MYSQL_PWD: DB_PASS },   // keeps the password off the command line
    stdio: ['pipe', 'pipe', 'pipe']
  });
  return out.split(/\r?\n/).filter((line) => line !== '').map((line) =>
    line.split('\t').map((v) => (v === 'NULL' ? null : v)));
}

// Quotes a value for SQL. Only ever used with values the tests made themselves.
function q(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  return "'" + String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

function one(sql) {
  const rows = runSql(sql);
  return rows.length ? rows[0] : null;
}

// The PHP's db_config.local.php: the test database, plus host/user/password when they differ from WAMP's
function phpConfig() {
  const php = (v) => "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  const entries = { name: TEST_DB };
  if (DB_HOST) entries.host = DB_HOST;
  if (process.env.HOP_DB_USER) entries.user = DB_USER;
  if (process.env.HOP_DB_PASS !== undefined) entries.pass = DB_PASS;
  const body = Object.entries(entries).map(([k, v]) => `${php(k)} => ${php(v)}`).join(', ');
  return `<?php\n${LOCAL_CONFIG_MARK}\nreturn [${body}];\n`;
}

module.exports = {
  ROOT, TEST_DB, LOCAL_CONFIG, LOCAL_CONFIG_MARK, phpConfig,
  appUrl, runSql, q, one
};
