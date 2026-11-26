<?php
// Buy a bus ticket with the Hop Card balance (HOP Up Priority Payment).
//
//   GET  ticket.php                          -> ticket price for this user's card type, balance, card status,
//                                               the times a ticket can be bought for, and the user's tickets
//   POST ticket.php {action:"buy", route, travel_date, travel_time, idempotency_key}
//        -> takes the price off users.wallet_balance and saves the ticket with its QR token.
//           Declined if the card isn't active, the balance is too low, or the date/time isn't available.
//
// The price is always worked out here from the card type, never taken from the request.
// A ticket is for one date and time (Irish time) and is valid for 90 minutes from then.

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

// When tickets can be bought for: every 15 minutes from 06:00 to 23:00, up to 30 days ahead
const TRAVEL_TZ        = 'Europe/Dublin';
const FIRST_DEPARTURE  = '06:00';
const LAST_DEPARTURE   = '23:00';
const DEPARTURE_STEP   = 15;    // minutes
const DAYS_AHEAD       = 30;
const VALID_MINUTES    = 90;    // a ticket can be used for this long after its time

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
$tz  = new DateTimeZone(TRAVEL_TZ);
$now = new DateTimeImmutable('now', $tz);

// Checks the chosen date and time. Returns [DateTimeImmutable, null] or [null, message for the user].
function travel_time(?string $date, ?string $time, DateTimeImmutable $now, DateTimeZone $tz): array {
    if (!is_string($date) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) ||
        !is_string($time) || !preg_match('/^\d{2}:\d{2}$/', $time)) {
        return [null, 'Choose a date and time for your journey.'];
    }
    $at = DateTimeImmutable::createFromFormat('!Y-m-d H:i', $date . ' ' . $time, $tz);
    if (!$at || $at->format('Y-m-d H:i') !== $date . ' ' . $time) {
        return [null, 'That date or time is not valid.'];
    }
    if ($time < FIRST_DEPARTURE || $time > LAST_DEPARTURE) {
        return [null, 'Buses are not available at ' . $time . '. Choose a time between ' .
                      FIRST_DEPARTURE . ' and ' . LAST_DEPARTURE . '.'];
    }
    if (((int) substr($time, 3, 2)) % DEPARTURE_STEP !== 0) {
        return [null, 'There is no departure at ' . $time . '. Choose one from the list.'];
    }
    // The departure that is just leaving can still be bought
    if ($at < $now->modify('-' . DEPARTURE_STEP . ' minutes')) {
        return [null, 'That time has already passed. Choose a later time.'];
    }
    if ($at->format('Y-m-d') > $now->modify('+' . DAYS_AHEAD . ' days')->format('Y-m-d')) {
        return [null, 'Tickets can only be bought up to ' . DAYS_AHEAD . ' days ahead.'];
    }
    return [$at, null];
}

// The user's tickets, newest journey first. Tickets past their 90 minutes are marked expired first.
function user_tickets(PDO $pdo, int $userId, DateTimeImmutable $now): array {
    $cutoff = $now->modify('-' . VALID_MINUTES . ' minutes')->format('Y-m-d H:i:s');
    $pdo->prepare("UPDATE tickets SET status = 'expired' WHERE user_id = ? AND status = 'active' AND travel_at < ?")
        ->execute([$userId, $cutoff]);

    $stmt = $pdo->prepare(
        'SELECT ticket_id, qr_token, route, travel_at, status, purchased_at FROM tickets
         WHERE user_id = ? ORDER BY travel_at IS NULL, travel_at DESC, ticket_id DESC LIMIT 20'
    );
    $stmt->execute([$userId]);
    return array_map(function ($t) {
        return [
            'id'        => (int) $t['ticket_id'],
            'route'     => $t['route'],
            'travel_at' => $t['travel_at'],
            'status'    => $t['status'],
            // Only a ticket that can still be used gets its QR code
            'qr_token'  => $t['status'] === 'active' ? $t['qr_token'] : null,
        ];
    }, $stmt->fetchAll());
}

// ---------- GET: price before paying ----------
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    respond([
        'logged_in'   => true,
        'card_type'   => $user['card_type'],
        'card_status' => $user['card_status'],
        'price'       => $priceCents / 100,
        'balance'     => (float) $user['wallet_balance'],
        'times'       => [
            'first'      => FIRST_DEPARTURE,
            'last'       => LAST_DEPARTURE,
            'step'       => DEPARTURE_STEP,
            'days_ahead' => DAYS_AHEAD,
            'valid_minutes' => VALID_MINUTES,
            'today'      => $now->format('Y-m-d'),
            'now'        => $now->format('H:i'),
        ],
        'tickets'     => user_tickets($pdo, $userId, $now),
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
[$travelAt, $timeError] = travel_time($body['travel_date'] ?? null, $body['travel_time'] ?? null, $now, $tz);

$ref    = 'ticket_' . $key;   // stored in transactions.stripe_payment_id, which is unique
$amount = number_format($priceCents / 100, 2, '.', '');

try {
    $pdo->beginTransaction();

    // Lock the user's row so two purchases can't both spend the same balance
    $lock = $pdo->prepare('SELECT card_status, wallet_balance FROM users WHERE user_id = ? FOR UPDATE');
    $lock->execute([$userId]);
    $balanceRow = $lock->fetch();

    // Same key again (double tap or retry): the ticket was already bought
    $dup = $pdo->prepare('SELECT ticket_id FROM transactions WHERE stripe_payment_id = ? AND user_id = ?');
    $dup->execute([$ref, $userId]);
    $dupRow = $dup->fetch();
    if ($dupRow) {
        $pdo->rollBack();
        respond(['success' => true, 'replayed' => true, 'price' => $priceCents / 100,
                 'balance' => (float) $balanceRow['wallet_balance'], 'ticket_id' => (int) $dupRow['ticket_id']]);
    }

    // Not available: nothing is charged
    if ($timeError) {
        $pdo->rollBack();
        respond(['success' => false, 'declined' => 'time_unavailable', 'error' => $timeError,
                 'price' => $priceCents / 100, 'balance' => (float) $balanceRow['wallet_balance']]);
    }

    if ($balanceRow['card_status'] !== 'active') {
        $pdo->rollBack();
        respond(['success' => false, 'declined' => 'card_not_active', 'price' => $priceCents / 100,
                 'balance' => (float) $balanceRow['wallet_balance'],
                 'error' => 'Your card is not active, so it cannot be used to pay.']);
    }
    if (round((float) $balanceRow['wallet_balance'] * 100) < $priceCents) {
        $pdo->rollBack();
        respond(['success' => false, 'declined' => 'insufficient_balance', 'price' => $priceCents / 100,
                 'balance' => (float) $balanceRow['wallet_balance'],
                 'error' => 'Not enough balance on your Hop Card.']);
    }

    $ticket = $pdo->prepare(
        "INSERT INTO tickets (user_id, qr_token, route, travel_at, status) VALUES (?, ?, ?, ?, 'active')"
    );
    $ticket->execute([$userId, bin2hex(random_bytes(16)), $route, $travelAt->format('Y-m-d H:i:s')]);
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
         'balance' => (float) $bal->fetchColumn(), 'ticket_id' => $ticketId,
         'tickets' => user_tickets($pdo, $userId, $now)]);
