<?php
// Recurring top up (one per user).
//
//   GET  recurring.php                                 -> the recurring top up (or null), saved cards, balance
//   POST recurring.php {action:"save", ...}            -> set it up, or change it
//   POST recurring.php {action:"set_enabled", enabled} -> turn it on (true) or off (false)
//   POST recurring.php {action:"cancel"}               -> delete it
//
// "save" needs: amount_cents (500, 1000, 2000 or 5000), interval ('weekly' | 'fortnightly' | 'monthly'),
//               start_date ('YYYY-MM-DD', today or later), card_id (a saved card id, or null for the demo wallet)
//
// If the first top up is today, it is added straight away.

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

require_once __DIR__ . '/../db_connect.php';
require_once __DIR__ . '/recurring_lib.php';

try {
    $pdo = hop_pdo();
} catch (PDOException $e) {
    error_log('[HopApp recurring] Database connection failed: ' . $e->getMessage());
    respond(['success' => false, 'error' => 'Database connection failed'], 500);
}

// The user always comes from the session, never from the request.
$stmt = $pdo->prepare('SELECT user_id, card_status FROM users WHERE email = ?');
$stmt->execute([$_SESSION['email']]);
$user = $stmt->fetch();
if (!$user) {
    session_destroy();
    respond(['logged_in' => false], 401);
}
$userId = (int) $user['user_id'];

// Everything the page shows, in one reply
function page_data(PDO $pdo, int $userId, int $addedNow = 0): array {
    $stmt = $pdo->prepare('SELECT wallet_balance FROM users WHERE user_id = ?');
    $stmt->execute([$userId]);
    $balance = (float) $stmt->fetchColumn();

    $stmt = $pdo->prepare('SELECT card_id, brand, last4 FROM saved_cards WHERE user_id = ? ORDER BY card_id');
    $stmt->execute([$userId]);
    $cards = array_map(function ($c) {
        return ['id' => (int) $c['card_id'], 'label' => $c['brand'] . ' •••• ' . $c['last4']];
    }, $stmt->fetchAll());

    return [
        'logged_in' => true,
        'success'   => true,
        'today'     => recurring_today(),
        'balance'   => $balance,
        'cards'     => $cards,
        'recurring' => recurring_load($pdo, $userId),
        'added_now' => $addedNow,   // how many top ups were added by this request
    ];
}

try {
    // ---------- GET ----------
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $added = recurring_run_due($pdo, $userId);
        respond(page_data($pdo, $userId, $added));
    }

    // Only accept JSON (same CSRF guard as topup.php)
    if ($_SERVER['REQUEST_METHOD'] !== 'POST' || stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) {
        respond(['success' => false, 'error' => 'Invalid request'], 400);
    }
    $body   = json_decode(file_get_contents('php://input'), true) ?: [];
    $action = $body['action'] ?? '';
    $today  = recurring_today();

    // ---------- POST save ----------
    if ($action === 'save') {
        $cents    = $body['amount_cents'] ?? null;
        $interval = $body['interval'] ?? '';
        $start    = $body['start_date'] ?? '';
        $cardId   = $body['card_id'] ?? null;

        if (!in_array($cents, RECURRING_AMOUNTS, true)) {
            respond(['success' => false, 'error' => 'Choose an amount'], 400);
        }
        if (!isset(RECURRING_INTERVALS[$interval])) {
            respond(['success' => false, 'error' => 'Choose how often to top up'], 400);
        }
        $date = DateTime::createFromFormat('!Y-m-d', (string) $start);
        if (!$date || $date->format('Y-m-d') !== $start || $start < $today) {
            respond(['success' => false, 'error' => 'Choose a first top up date from today onwards'], 400);
        }
        if ($cardId !== null) {
            // The card must belong to this user
            $stmt = $pdo->prepare('SELECT 1 FROM saved_cards WHERE card_id = ? AND user_id = ?');
            $stmt->execute([$cardId, $userId]);
            if (!is_int($cardId) || !$stmt->fetch()) {
                respond(['success' => false, 'error' => 'Choose one of your saved cards'], 400);
            }
        }
        if ($user['card_status'] !== 'active') {
            respond(['success' => false, 'error' => 'Your Hop card is not active'], 403);
        }

        // Insert, or replace the user's existing one (user_id is UNIQUE)
        $pdo->prepare(
            'INSERT INTO recurring_topups (user_id, amount, interval_type, card_id, start_date, next_run_date, enabled)
             VALUES (?, ?, ?, ?, ?, ?, 1)
             ON DUPLICATE KEY UPDATE amount = VALUES(amount), interval_type = VALUES(interval_type),
                 card_id = VALUES(card_id), start_date = VALUES(start_date),
                 next_run_date = VALUES(next_run_date), enabled = 1'
        )->execute([$userId, $cents / 100, $interval, $cardId, $start, $start]);

        $added = recurring_run_due($pdo, $userId);   // adds the first top up now if it's today
        respond(page_data($pdo, $userId, $added));
    }

    // ---------- POST set_enabled ----------
    if ($action === 'set_enabled') {
        $enabled = ($body['enabled'] ?? null) === true;
        $r = recurring_load($pdo, $userId);
        if (!$r) {
            respond(['success' => false, 'error' => 'You have no recurring top up'], 404);
        }

        // Turning it back on: skip the days that passed while it was off
        $next = $r['next_run_date'];
        while ($enabled && $next < $today) {
            $next = recurring_next_date($next, $r['interval'], $r['start_date']);
        }
        $pdo->prepare('UPDATE recurring_topups SET enabled = ?, next_run_date = ? WHERE user_id = ?')
            ->execute([$enabled ? 1 : 0, $next, $userId]);

        $added = $enabled ? recurring_run_due($pdo, $userId) : 0;
        respond(page_data($pdo, $userId, $added));
    }

    // ---------- POST cancel ----------
    if ($action === 'cancel') {
        $pdo->prepare('DELETE FROM recurring_topups WHERE user_id = ?')->execute([$userId]);
        respond(page_data($pdo, $userId));
    }

    respond(['success' => false, 'error' => 'Unknown action'], 400);
} catch (Throwable $e) {
    error_log('[HopApp recurring] Failed: ' . $e->getMessage());
    respond(['success' => false, 'error' => 'Something went wrong, please try again'], 500);
}
