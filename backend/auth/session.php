<?php
session_start();
header('Content-Type: application/json');
header('Cache-Control: no-store');

// Check if the user is actually logged in
if (!isset($_SESSION['email'])) {
    echo json_encode(['logged_in' => false]);
    exit;
}

require_once __DIR__ . '/../db_connect.php';   // database settings live in one place
try {
    $pdo = hop_pdo();
} catch (PDOException $e) {
    error_log('[HopApp session] Database connection failed: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['logged_in' => false, 'error' => 'Database connection failed']);
    exit;
}

// Add any recurring top ups that are due, so the balance below includes them.
// A problem here is only logged: it must not stop the card page from loading.
require_once __DIR__ . '/recurring_lib.php';
try {
    $stmt = $pdo->prepare('SELECT user_id FROM users WHERE email = ?');
    $stmt->execute([$_SESSION['email']]);
    $userId = $stmt->fetchColumn();
    if ($userId) recurring_run_due($pdo, (int) $userId);
} catch (Throwable $e) {
    error_log('[HopApp session] Recurring top ups failed: ' . $e->getMessage());
}

// Read fresh values from the database so the balance is always current
try {
    $stmt = $pdo->prepare(
        'SELECT f_name, card_type, card_number, card_status, card_expiry, wallet_balance
         FROM users WHERE email = ?'
    );
    $stmt->execute([$_SESSION['email']]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
} catch (PDOException $e) {
    error_log('[HopApp session] Database error: ' . $e->getMessage());
    echo json_encode(['logged_in' => false, 'error' => 'Database error']);
    exit;
}

// Account was deleted while the session was still alive
if (!$row) {
    session_destroy();
    echo json_encode(['logged_in' => false]);
    exit;
}

echo json_encode([
    'logged_in'      => true,
    'f_name'         => $row['f_name'],
    'card_type'      => $row['card_type'],
    'card_number'    => $row['card_number'],
    'card_status'    => $row['card_status'],
    'card_expiry'    => $row['card_expiry'],   // 'YYYY-MM-DD', or null when not known
    'wallet_balance' => (float) $row['wallet_balance']
]);