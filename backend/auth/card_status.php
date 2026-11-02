<?php
// Freeze, unfreeze or report the logged-in user's card.
//
//   POST card_status.php {"action":"freeze"}         active          -> frozen
//   POST card_status.php {"action":"unfreeze"}       frozen          -> active
//   POST card_status.php {"action":"report_lost"}    active, frozen  -> reported_lost
//   POST card_status.php {"action":"report_stolen"}  active, frozen  -> reported_stolen
//
// Reporting is permanent: a reported card can't be changed here, it needs
// support and a replacement card. The user always comes from the session,
// never from the request.

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

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(['success' => false, 'error' => 'Invalid request method'], 405);
}

// JSON only. A cross-site HTML form can't send this content type, so another
// website can't freeze or report a card using the user's session cookie.
if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) {
    respond(['success' => false, 'error' => 'Content-Type must be application/json'], 415);
}

$body   = json_decode(file_get_contents('php://input'), true);
$action = is_array($body) ? ($body['action'] ?? '') : '';

// For each action: the status it sets, and the statuses it may start from
$actions = [
    'freeze'        => ['to' => 'frozen',          'from' => ['active']],
    'unfreeze'      => ['to' => 'active',          'from' => ['frozen']],
    'report_lost'   => ['to' => 'reported_lost',   'from' => ['active', 'frozen']],
    'report_stolen' => ['to' => 'reported_stolen', 'from' => ['active', 'frozen']],
];

if (!is_string($action) || !isset($actions[$action])) {
    respond(['success' => false, 'error' => 'Unknown action'], 400);
}
$to   = $actions[$action]['to'];
$from = $actions[$action]['from'];

require_once __DIR__ . '/../db_connect.php';   // database settings live in one place
try {
    $pdo = hop_pdo();
} catch (PDOException $e) {
    error_log('[HopApp card_status] Database connection failed: ' . $e->getMessage());
    respond(['success' => false, 'error' => 'Database connection failed'], 500);
}

try {
    $stmt = $pdo->prepare('SELECT user_id FROM users WHERE email = ?');
    $stmt->execute([$_SESSION['email']]);
    $userId = $stmt->fetchColumn();

    if ($userId === false) {
        session_destroy();
        respond(['logged_in' => false], 401);
    }

    // Only change the status if it is currently one this action may start from.
    // A reported card is never overwritten, and a double tap does nothing twice.
    $marks = implode(',', array_fill(0, count($from), '?'));
    $upd = $pdo->prepare("UPDATE users SET card_status = ? WHERE user_id = ? AND card_status IN ($marks)");
    $upd->execute(array_merge([$to, $userId], $from));

    $chk = $pdo->prepare('SELECT card_status FROM users WHERE user_id = ?');
    $chk->execute([$userId]);
    $status = $chk->fetchColumn();
} catch (PDOException $e) {
    error_log('[HopApp card_status] Database error: ' . $e->getMessage());
    respond(['success' => false, 'error' => 'Database error'], 500);
}

// Now in the requested state (including "it already was"): success
if ($status === $to) {
    respond(['success' => true, 'card_status' => $status]);
}

// Already reported, as the other kind: it can't be changed here
$reported = ['reported_lost' => 'lost', 'reported_stolen' => 'stolen'];
if (isset($reported[$status])) {
    respond([
        'success'     => false,
        'card_status' => $status,
        'error'       => 'This card was already reported ' . $reported[$status]
                       . '. Contact Help & Support for a replacement.'
    ], 403);
}

respond(['success' => false, 'card_status' => $status, 'error' => 'The card status could not be changed'], 409);
