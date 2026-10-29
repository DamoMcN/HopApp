<?php
session_start();
header('Content-Type: application/json');
header('Cache-Control: no-store');

// Check if the user is actually logged in
if (!isset($_SESSION['email'])) {
    echo json_encode(['logged_in' => false]);
    exit;
}

// Same connection settings as login.php / signup.php
$dsn = 'mysql:host=localhost;dbname=hop_app_db;charset=utf8mb4';
try {
    $pdo = new PDO($dsn, 'root', '', [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['logged_in' => false, 'error' => 'Database connection failed']);
    exit;
}

// Read fresh values from the database so the balance is always current
try {
    $stmt = $pdo->prepare(
        'SELECT f_name, card_type, card_number, card_status, wallet_balance
         FROM users WHERE email = ?'
    );
    $stmt->execute([$_SESSION['email']]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
} catch (PDOException $e) {
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
    'wallet_balance' => (float) $row['wallet_balance']
]);