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