<?php
// Wallet top up.
//
//   GET  topup.php                         -> saved cards, balance, payments mode
//   POST topup.php {action:"add_card"}     -> save a demo card (brand + last 4 only)
//   POST topup.php {action:"top_up", ...}  -> add money to users.wallet_balance
//
// PAYMENTS_MODE is 'mock': no payment provider is contacted and no real money
// moves. A real provider (e.g. Stripe test mode) would be added inside
// charge_payment() below, which is the only place a payment is made.

session_start();
header('Content-Type: application/json');
header('Cache-Control: no-store');

const PAYMENTS_MODE = 'mock';
const MIN_CENTS     = 100;     // EUR 1.00
const MAX_CENTS     = 50000;   // EUR 500.00

// Demo cards offered by "add card". Brand + last 4 only, a full card number is never stored.
const DEMO_CARDS = [
    ['brand' => 'Visa',       'last4' => '4242'],
    ['brand' => 'Mastercard', 'last4' => '4444'],
    ['brand' => 'Amex',       'last4' => '0005'],
];

function respond(array $data, int $status = 200): void {
    http_response_code($status);
    echo json_encode($data);
    exit;
}

if (!isset($_SESSION['email'])) {
    respond(['logged_in' => false], 401);
}

require_once __DIR__ . '/../db_connect.php';   // database settings live in one place
try {
    $pdo = hop_pdo();
} catch (PDOException $e) {
    error_log('[HopApp topup] Database connection failed: ' . $e->getMessage());
    respond(['logged_in' => true, 'success' => false, 'error' => 'Database connection failed'], 500);
}

// The user always comes from the session, never from the request.
$stmt = $pdo->prepare('SELECT user_id, card_status, wallet_balance FROM users WHERE email = ?');
$stmt->execute([$_SESSION['email']]);
$user = $stmt->fetch();

if (!$user) {
    session_destroy();
    respond(['logged_in' => false], 401);
}
$userId = (int) $user['user_id'];

function saved_cards(PDO $pdo, int $userId): array {
    $stmt = $pdo->prepare(
        'SELECT card_id, brand, last4 FROM saved_cards WHERE user_id = ? ORDER BY card_id'
    );
    $stmt->execute([$userId]);
    return array_map(function ($r) {
        return ['id' => (int) $r['card_id'], 'brand' => $r['brand'], 'last4' => $r['last4']];
    }, $stmt->fetchAll());
}

function current_balance(PDO $pdo, int $userId): float {
    $stmt = $pdo->prepare('SELECT wallet_balance FROM users WHERE user_id = ?');
    $stmt->execute([$userId]);
    return (float) $stmt->fetchColumn();
}

// The single place a payment is made. Mock mode always succeeds.
// Returns a reference string stored in transactions.stripe_payment_id.
function charge_payment(string $idempotencyKey, int $amountCents, ?array $card): string {
    return 'mock_' . $idempotencyKey;
}

// ---------- GET: page data ----------
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    try {
        respond([
            'logged_in' => true,
            'mode'      => PAYMENTS_MODE,
            'balance'   => (float) $user['wallet_balance'],
            'cards'     => saved_cards($pdo, $userId),
            'min_cents' => MIN_CENTS,
            'max_cents' => MAX_CENTS,
        ]);
    } catch (PDOException $e) {
        error_log('[HopApp topup] Could not load cards: ' . $e->getMessage());
        respond(['logged_in' => true, 'error' => 'Database error'], 500);
    }
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(['success' => false, 'error' => 'Invalid request method'], 405);
}

// Only accept JSON. A cross-site HTML form cannot send this content type, so
// another website can't trigger a top up using the user's session cookie.
if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) {
    respond(['success' => false, 'error' => 'Content-Type must be application/json'], 415);
}

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) {
    respond(['success' => false, 'error' => 'Invalid request body'], 400);
}

$action = $body['action'] ?? '';

// ---------- POST add_card ----------
if ($action === 'add_card') {
    try {
        $have = [];
        foreach (saved_cards($pdo, $userId) as $c) {
            $have[$c['brand'] . $c['last4']] = true;
        }
        foreach (DEMO_CARDS as $demo) {
            if (isset($have[$demo['brand'] . $demo['last4']])) continue;
            $ins = $pdo->prepare('INSERT INTO saved_cards (user_id, brand, last4) VALUES (?, ?, ?)');
            $ins->execute([$userId, $demo['brand'], $demo['last4']]);
            respond(['success' => true, 'cards' => saved_cards($pdo, $userId)]);
        }
        respond(['success' => false, 'error' => 'All demo cards are already saved'], 409);
    } catch (PDOException $e) {
        error_log('[HopApp topup] Could not save card: ' . $e->getMessage());
        respond(['success' => false, 'error' => 'Could not save card'], 500);
    }
}

// ---------- POST top_up ----------
if ($action !== 'top_up') {
    respond(['success' => false, 'error' => 'Unknown action'], 400);
}

$cents  = $body['amount_cents'] ?? null;
$source = $body['source'] ?? '';
$key    = $body['idempotency_key'] ?? '';

if (!is_int($cents) || $cents < MIN_CENTS || $cents > MAX_CENTS) {
    respond(['success' => false, 'error' => 'Amount must be between €1 and €500'], 400);
}
if (!is_string($key) || !preg_match('/^[A-Za-z0-9-]{8,64}$/', $key)) {
    respond(['success' => false, 'error' => 'Missing or invalid idempotency key'], 400);
}
if ($user['card_status'] !== 'active') {
    respond(['success' => false, 'error' => 'This card is not active, so it cannot be topped up'], 403);
}

$card = null;
if ($source === 'saved_card') {
    $cardId = $body['card_id'] ?? null;
    if (!is_int($cardId)) {
        respond(['success' => false, 'error' => 'Choose a saved card'], 400);
    }
    foreach (saved_cards($pdo, $userId) as $c) {
        if ($c['id'] === $cardId) { $card = $c; break; }   // must belong to this user
    }
    if (!$card) {
        respond(['success' => false, 'error' => 'Saved card not found'], 404);
    }
} elseif ($source === 'wallet_demo') {
    if (PAYMENTS_MODE !== 'mock') {
        respond(['success' => false, 'error' => 'The demo wallet is only available in mock mode'], 400);
    }
} else {
    respond(['success' => false, 'error' => 'Unknown payment source'], 400);
}

$amount = number_format($cents / 100, 2, '.', '');

try {
    $pdo->beginTransaction();

    // Lock this user's row so two top ups can't read the same balance.
    $lock = $pdo->prepare('SELECT wallet_balance FROM users WHERE user_id = ? FOR UPDATE');
    $lock->execute([$userId]);

    // Same key twice (a retry or double click) must not credit twice.
    $ref = 'mock_' . $key;
    $dup = $pdo->prepare('SELECT 1 FROM transactions WHERE stripe_payment_id = ? AND user_id = ?');
    $dup->execute([$ref, $userId]);
    if ($dup->fetch()) {
        $pdo->rollBack();
        respond(['success' => true, 'replayed' => true, 'balance' => current_balance($pdo, $userId)]);
    }

    $ref = charge_payment($key, $cents, $card);

    $ins = $pdo->prepare(
        "INSERT INTO transactions (user_id, type, amount, stripe_payment_id) VALUES (?, 'top up', ?, ?)"
    );
    $ins->execute([$userId, $amount, $ref]);

    $upd = $pdo->prepare('UPDATE users SET wallet_balance = wallet_balance + ? WHERE user_id = ?');
    $upd->execute([$amount, $userId]);

    $pdo->commit();
} catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    // 23000 = unique key hit: the same idempotency key was submitted at the same moment
    if ($e->getCode() === '23000') {
        respond(['success' => true, 'replayed' => true, 'balance' => current_balance($pdo, $userId)]);
    }
    error_log('[HopApp topup] Top up failed: ' . $e->getMessage());
    respond(['success' => false, 'error' => 'Top up failed, you have not been charged'], 500);
}

respond(['success' => true, 'replayed' => false, 'balance' => current_balance($pdo, $userId)]);
