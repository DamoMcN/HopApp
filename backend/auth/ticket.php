<?php
// Buy a bus ticket with the Hop Card balance (HOP Up Priority Payment).
//
//   GET  ticket.php                          -> ticket price for this user's card type, balance, card status
//   POST ticket.php {action:"buy", route, idempotency_key}
//        -> takes the price off users.wallet_balance and saves the ticket.
//           Declined if the card isn't active or the balance is too low.
//
// The price is always worked out here from the card type, never taken from the request.

session_start();
header('Content-Type: application/json');
header('Cache-Control: no-store');

// Single journey fares in cents, from the 2026 TFI Leap fares.
// (These go up in January 2027: Adult 230, Young Adult/Student 115, Child 75.)
const FARES_CENTS = [
    'Adult'       => 200,
    'Young Adult' => 100,
    'Student'     => 100,
    'Child'       => 65,
];

function respond(array $data, int $status = 200): void {
    http_response_code($status);
    echo json_encode($data);
    exit;
}

if (!isset($_SESSION['email'])) {
    respond(['logged_in' => false], 401);
}

require_once __DIR__ . '/../db_connect.php';
try {
    $pdo = hop_pdo();
} catch (PDOException $e) {
    error_log('[HopApp ticket] Database connection failed: ' . $e->getMessage());
    respond(['logged_in' => true, 'success' => false, 'error' => 'Database connection failed'], 500);
}

$stmt = $pdo->prepare('SELECT user_id, card_type, card_status, wallet_balance FROM users WHERE email = ?');
$stmt->execute([$_SESSION['email']]);
$user = $stmt->fetch();
if (!$user) {
    session_destroy();
    respond(['logged_in' => false], 401);
}
$userId = (int) $user['user_id'];
$priceCents = FARES_CENTS[$user['card_type']] ?? FARES_CENTS['Adult'];

// ---------- GET: price before paying ----------
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    respond([
        'logged_in'   => true,
        'card_type'   => $user['card_type'],
        'card_status' => $user['card_status'],
        'price'       => $priceCents / 100,
        'balance'     => (float) $user['wallet_balance'],
    ]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(['success' => false, 'error' => 'Invalid request method'], 405);
}
// JSON only: a form on another website can't send this, so it can't spend the user's balance
if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) {
    respond(['success' => false, 'error' => 'Content-Type must be application/json'], 415);
}

$body  = json_decode(file_get_contents('php://input'), true);
$route = is_array($body) ? trim((string) ($body['route'] ?? '')) : '';
$key   = is_array($body) ? ($body['idempotency_key'] ?? '') : '';

if (!is_array($body) || ($body['action'] ?? '') !== 'buy') {
    respond(['success' => false, 'error' => 'Unknown action'], 400);
}
if ($route === '' || mb_strlen($route) > 100) {
    respond(['success' => false, 'error' => 'Choose a journey first'], 400);
}
if (!is_string($key) || !preg_match('/^[A-Za-z0-9-]{8,64}$/', $key)) {
    respond(['success' => false, 'error' => 'Missing or invalid idempotency key'], 400);
}

$ref    = 'ticket_' . $key;   // stored in transactions.stripe_payment_id, which is unique
$amount = number_format($priceCents / 100, 2, '.', '');

try {
    $pdo->beginTransaction();

    // Lock the user's row so two purchases can't both spend the same balance
    $lock = $pdo->prepare('SELECT card_status, wallet_balance FROM users WHERE user_id = ? FOR UPDATE');
    $lock->execute([$userId]);
    $now = $lock->fetch();

    // Same key again (double tap or retry): the ticket was already bought
    $dup = $pdo->prepare('SELECT 1 FROM transactions WHERE stripe_payment_id = ? AND user_id = ?');
    $dup->execute([$ref, $userId]);
    if ($dup->fetch()) {
        $pdo->rollBack();
        respond(['success' => true, 'replayed' => true, 'price' => $priceCents / 100,
                 'balance' => (float) $now['wallet_balance']]);
    }

    if ($now['card_status'] !== 'active') {
        $pdo->rollBack();
        respond(['success' => false, 'declined' => 'card_not_active', 'price' => $priceCents / 100,
                 'balance' => (float) $now['wallet_balance'],
                 'error' => 'Your card is not active, so it cannot be used to pay.']);
    }
    if (round((float) $now['wallet_balance'] * 100) < $priceCents) {
        $pdo->rollBack();
        respond(['success' => false, 'declined' => 'insufficient_balance', 'price' => $priceCents / 100,
                 'balance' => (float) $now['wallet_balance'],
                 'error' => 'Not enough balance on your Hop Card.']);
    }

    $ticket = $pdo->prepare("INSERT INTO tickets (user_id, qr_token, route, status) VALUES (?, ?, ?, 'active')");
    $ticket->execute([$userId, bin2hex(random_bytes(16)), $route]);
    $ticketId = (int) $pdo->lastInsertId();

    $tx = $pdo->prepare(
        "INSERT INTO transactions (user_id, type, amount, stripe_payment_id, ticket_id) VALUES (?, 'ticket purchase', ?, ?, ?)"
    );
    $tx->execute([$userId, $amount, $ref, $ticketId]);

    $upd = $pdo->prepare('UPDATE users SET wallet_balance = wallet_balance - ? WHERE user_id = ?');
    $upd->execute([$amount, $userId]);

    $pdo->commit();
} catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    error_log('[HopApp ticket] Purchase failed: ' . $e->getMessage());
    respond(['success' => false, 'error' => 'Payment failed, you have not been charged. Please try again.'], 500);
}

$bal = $pdo->prepare('SELECT wallet_balance FROM users WHERE user_id = ?');
$bal->execute([$userId]);
respond(['success' => true, 'replayed' => false, 'price' => $priceCents / 100,
         'balance' => (float) $bal->fetchColumn(), 'ticket_id' => $ticketId]);
