<?php
session_start();
header('Content-Type: application/json');
header('Cache-Control: no-store');

function respond(array $data, int $status = 200): void {
    http_response_code($status);
    echo json_encode($data);
    exit;
}

if (!isset($_SESSION['email'])) {
    respond(['logged_in' => false], 401);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if (!in_array($method, ['GET', 'POST'], true)) {
    respond(['error' => 'Invalid request method'], 405);
}

$input = [];
if ($method === 'POST') {
    if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) {
        respond(['error' => 'Content-Type must be application/json'], 415);
    }
    $input = json_decode(file_get_contents('php://input'), true);
    if (!is_array($input)) {
        respond(['error' => 'Invalid settings data'], 400);
    }
}

require_once __DIR__ . '/../db_connect.php';
try {
    $pdo = hop_pdo();
    $userQuery = $pdo->prepare('SELECT user_id FROM users WHERE email = ?');
    $userQuery->execute([$_SESSION['email']]);
    $userId = $userQuery->fetchColumn();
    if ($userId === false) {
        session_destroy();
        respond(['logged_in' => false], 401);
    }
    $userId = (int) $userId;

    if ($method === 'GET') {
        $query = $pdo->prepare(
            'SELECT auto_top_up_enabled, auto_top_up_amount_eur, auto_top_up_card_id
             FROM user_preferences WHERE user_id = ?'
        );
        $query->execute([$userId]);
        $settings = $query->fetch();
        respond([
            'logged_in' => true,
            'configured' => true,
            'settings' => [
                'auto_top_up_enabled' => $settings ? (bool) $settings['auto_top_up_enabled'] : false,
                'auto_top_up_amount_eur' => $settings ? (int) $settings['auto_top_up_amount_eur'] : 10,
                'auto_top_up_card_id' => $settings && $settings['auto_top_up_card_id'] !== null
                    ? (int) $settings['auto_top_up_card_id'] : null,
            ],
        ]);
    }

    $enabled = $input['auto_top_up_enabled'] ?? false;
    $amount = filter_var($input['auto_top_up_amount_eur'] ?? null, FILTER_VALIDATE_INT);
    $cardId = $input['auto_top_up_card_id'] ?? null;
    if (!is_bool($enabled) || $amount === false || $amount < 5 || $amount > 100 || $amount % 5 !== 0) {
        respond(['error' => 'Choose a valid automatic top-up amount.'], 422);
    }
    if ($cardId !== null) {
        $cardId = filter_var($cardId, FILTER_VALIDATE_INT);
        if ($cardId === false || $cardId < 1) {
            respond(['error' => 'Choose a valid saved card.'], 422);
        }
        $cardQuery = $pdo->prepare('SELECT card_id FROM saved_cards WHERE card_id = ? AND user_id = ?');
        $cardQuery->execute([$cardId, $userId]);
        if (!$cardQuery->fetchColumn()) {
            respond(['error' => 'That saved card is not available for this account.'], 422);
        }
    }
    if ($enabled && $cardId === null) {
        respond(['error' => 'Save a card before enabling automatic top up.'], 422);
    }

    $save = $pdo->prepare(
        'INSERT INTO user_preferences (user_id, auto_top_up_enabled, auto_top_up_amount_eur, auto_top_up_card_id)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE auto_top_up_enabled = VALUES(auto_top_up_enabled),
             auto_top_up_amount_eur = VALUES(auto_top_up_amount_eur),
             auto_top_up_card_id = VALUES(auto_top_up_card_id)'
    );
    $save->execute([$userId, $enabled ? 1 : 0, $amount, $cardId]);
    respond(['success' => true]);
} catch (PDOException $e) {
    error_log('[HopApp user_settings] Database error: ' . $e->getMessage());
    if (strpos(strtolower($e->getMessage()), 'user_preferences') !== false) {
        respond([
            'error' => 'Account settings are not installed yet. Import database/user_preferences_migration.sql in phpMyAdmin.',
        ], 503);
    }
    respond(['error' => 'Could not access account settings. Check the database connection.'], 500);
}