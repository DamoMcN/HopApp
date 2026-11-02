<?php
// The one place the database connection settings live.
//
// Every PHP endpoint in backend/auth/ calls hop_pdo(), so to change the host,
// database name, user or password you only need to edit this file.
//
// hop_pdo() throws a PDOException if it can't connect. Each endpoint catches
// that and replies with a friendly JSON error (nothing technical is shown to
// the person using the app).

const HOP_DB_HOST    = 'localhost';
const HOP_DB_NAME    = 'hop_app_db';
const HOP_DB_USER    = 'root';
const HOP_DB_PASS    = '';
const HOP_DB_CHARSET = 'utf8mb4';

function hop_pdo(): PDO {
    $dsn = 'mysql:host=' . HOP_DB_HOST . ';dbname=' . HOP_DB_NAME . ';charset=' . HOP_DB_CHARSET;

    return new PDO($dsn, HOP_DB_USER, HOP_DB_PASS, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
}
