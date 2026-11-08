<?php
// Wallet top up.
//
//   GET  topup.php                         -> saved cards, balance, payments mode
//   POST topup.php {action:"top_up", ...}  -> add money to users.wallet_balance
//        source "saved_card" | "new_card" | "wallet_demo". With "new_card" and
//        save:true the card is saved for next time.
//   POST topup.php {action:"remove_card", card_id}  -> delete one of the user's saved cards
//
// The full card number and CVC never reach this server: the browser sends only
// brand, last 4 digits and expiry. A real provider (e.g. Stripe) would take the
// card details itself and give back a token for provider_payment_method_id.
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

const CARD_BRANDS = ['Visa', 'Mastercard', 'Amex'];

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
        'SELECT card_id, brand, last4, exp_month, exp_year FROM saved_cards WHERE user_id = ? ORDER BY card_id'
    );
    $stmt->execute([$userId]);
    return array_map(function ($r) {
        return [
            'id'        => (int) $r['card_id'],
            'brand'     => $r['brand'],
            'last4'     => $r['last4'],
            'exp_month' => $r['exp_month'] === null ? null : (int) $r['exp_month'],
            'exp_year'  => $r['exp_year'] === null ? null : (int) $r['exp_year'],
        ];
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

// ---------- POST remove_card ----------
if ($action === 'remove_card') {
    $cardId = $body['card_id'] ?? null;
    if (!is_int($cardId)) {
        respond(['success' => false, 'error' => 'Choose a card to remove'], 400);
    }
    try {
        // user_id in the WHERE: people can only remove their own cards
        $del = $pdo->prepare('DELETE FROM saved_cards WHERE card_id = ? AND user_id = ?');
        $del->execute([$cardId, $userId]);
        if ($del->rowCount() === 0) {
            respond(['success' => false, 'error' => 'Saved card not found'], 404);
        }
        respond(['success' => true, 'cards' => saved_cards($pdo, $userId)]);
    } catch (PDOException $e) {
        error_log('[HopApp topup] Could not remove card: ' . $e->getMessage());
        respond(['success' => false, 'error' => 'Could not remove the card'], 500);
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
} elseif ($source === 'new_card') {
    // Only brand, last 4 and expiry are used. Anything else in the request is ignored.
    $c = $body['card'] ?? null;
    $month = is_array($c) ? ($c['exp_month'] ?? null) : null;
    $year  = is_array($c) ? ($c['exp_year'] ?? null) : null;
    $thisYear = (int) date('Y');
    if (!is_array($c) || !in_array($c['brand'] ?? '', CARD_BRANDS, true)
        || !is_string($c['last4'] ?? null) || !preg_match('/^\d{4}$/', $c['last4'])
        || !is_int($month) || $month < 1 || $month > 12
        || !is_int($year) || $year > $thisYear + 20
        || $year * 100 + $month < (int) date('Ym')) {
        respond(['success' => false, 'error' => 'Check your card details'], 400);
    }
    $card = ['brand' => $c['brand'], 'last4' => $c['last4'], 'exp_month' => $month, 'exp_year' => $year];
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

    // "Save this card" ticked: keep it for next time (same card again just updates the expiry)
    $saved = $source === 'new_card' && ($body['save'] ?? false) === true;
    if ($saved) {
        $save = $pdo->prepare(
            'INSERT INTO saved_cards (user_id, brand, last4, exp_month, exp_year) VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE exp_month = VALUES(exp_month), exp_year = VALUES(exp_year)'
        );
        $save->execute([$userId, $card['brand'], $card['last4'], $card['exp_month'], $card['exp_year']]);
    }

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

respond([
    'success'    => true,
    'replayed'   => false,
    'balance'    => current_balance($pdo, $userId),
    'card_saved' => $saved,
    'cards'      => saved_cards($pdo, $userId),
]);
