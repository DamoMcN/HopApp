<?php
session_start();
header('Content-Type: application/json');
header('Cache-Control: no-store');

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

try {
    $stmt = $pdo->prepare(
        'SELECT t.transaction_id, t.type, t.amount, t.created_at, k.route
         FROM transactions t
         JOIN users u ON u.user_id = t.user_id
         LEFT JOIN tickets k ON k.ticket_id = t.ticket_id
         WHERE u.email = ?
         ORDER BY t.created_at DESC, t.transaction_id DESC
         LIMIT 50'
    );
    $stmt->execute([$_SESSION['email']]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['logged_in' => true, 'error' => 'Database error']);
    exit;
}

$transactions = array_map(function ($r) {
    return [
        'id'         => (int) $r['transaction_id'],
        'type'       => $r['type'],
        // Ticket purchases take money off the card; both kinds of top up add to it
        'direction'  => $r['type'] === 'ticket purchase' ? 'out' : 'in',
        'amount'     => abs((float) $r['amount']),
        'route'      => $r['route'],
        'created_at' => $r['created_at'],
    ];
}, $rows);

echo json_encode(['logged_in' => true, 'transactions' => $transactions]);