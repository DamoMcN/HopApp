<?php
session_start();
header('Content-Type: application/json');

require_once __DIR__ . '/../db_connect.php';   // database settings live in one place

// $code lets the front end pick a friendly message (for example 'bad_credentials')
function respond($success, $message = '', $code = null) {
    echo json_encode(['success' => $success, 'message' => $message, 'code' => $code]);
    exit;
}

// Technical details go to the PHP error log, never to the person using the app
function server_error($detail) {
    error_log('[HopApp login] ' . $detail);
    respond(false, 'Something went wrong on our side. Please try again in a moment.', 'server_error');
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(false, 'Invalid request.', 'bad_request');
}

try {
    $pdo = hop_pdo();
} catch (PDOException $e) {
    server_error('Database connection failed: ' . $e->getMessage());
}

$email    = trim($_POST['user_email'] ?? '');
$password = $_POST['user_password'] ?? '';

if ($email === '' || $password === '') {
    respond(false, 'Please enter your email and password.');
}

try {
    $stmt = $pdo->prepare('SELECT * FROM users WHERE email = ?');
    $stmt->execute([$email]);
    $foundUser = $stmt->fetch();
} catch (PDOException $e) {
    server_error('Lookup failed: ' . $e->getMessage());
}

// Same message for "no such email" and "wrong password" so attackers can't tell which
if (!$foundUser || !password_verify($password, $foundUser['password_hash'])) {
    respond(false, 'Incorrect email or password.', 'bad_credentials');
}

// Remember who is logged in, for card.html and other pages later
session_regenerate_id(true);
$_SESSION['email']     = $foundUser['email'];
$_SESSION['f_name']    = $foundUser['f_name'];
$_SESSION['card_type'] = $foundUser['card_type'];
$_SESSION['card_number'] = $foundUser['card_number'];

respond(true, 'Logged in.');
