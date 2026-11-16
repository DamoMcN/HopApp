<?php
// The one place the database connection settings live.
//
// Every PHP endpoint in backend/auth/ calls hop_pdo(), so to change the host,
// database name, user or password you only need to edit this file.
//
// hop_pdo() throws a PDOException if it can't connect. Each endpoint catches
// that and replies with a friendly JSON error (nothing technical is shown to
// the person using the app).

// Optional override, git-ignored: backend/db_config.local.php can return
// ['host' => ..., 'name' => ..., 'user' => ..., 'pass' => ...] (any of them).
// The database tests (npm run test:db) use it to point the app at the
// hop_app_test database while they run, then delete it.
$hopDbLocal = is_file(__DIR__ . '/db_config.local.php') ? (require __DIR__ . '/db_config.local.php') : [];
if (!is_array($hopDbLocal)) $hopDbLocal = [];

define('HOP_DB_HOST', $hopDbLocal['host'] ?? 'localhost');
define('HOP_DB_NAME', $hopDbLocal['name'] ?? 'hop_app_db');
define('HOP_DB_USER', $hopDbLocal['user'] ?? 'root');
define('HOP_DB_PASS', $hopDbLocal['pass'] ?? '');
const HOP_DB_CHARSET = 'utf8mb4';

function hop_pdo(): PDO {
    $dsn = 'mysql:host=' . HOP_DB_HOST . ';dbname=' . HOP_DB_NAME . ';charset=' . HOP_DB_CHARSET;

    return new PDO($dsn, HOP_DB_USER, HOP_DB_PASS, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
}
