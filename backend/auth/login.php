<?php
session_start();
header('Content-Type: application/json');

$host    = 'localhost';
$db      = 'hop_app_db';
$user    = 'root';
$pass    = '';
$charset = 'utf8mb4';

$dsn = "mysql:host=$host;dbname=$db;charset=$charset";
$options = [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false,
];

function respond($success, $message = '') {
    echo json_encode(['success' => $success, 'message' => $message]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(false, 'Invalid request method.');
}

try {
    $pdo = new PDO($dsn, $user, $pass, $options);
} catch (PDOException $e) {
    respond(false, 'Database connection failed: ' . $e->getMessage());
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
    respond(false, 'Database error: ' . $e->getMessage());
}

// Same message for "no such email" and "wrong password" so attackers can't tell which
if (!$foundUser || !password_verify($password, $foundUser['password_hash'])) {
    respond(false, 'Incorrect email or password.');
}

// Remember who is logged in, for card.html and other pages later
session_regenerate_id(true);
$_SESSION['email']     = $foundUser['email'];
$_SESSION['f_name']    = $foundUser['f_name'];
$_SESSION['card_type'] = $foundUser['card_type'];
$_SESSION['card_number'] = $foundUser['card_number'];

respond(true, 'Logged in.');
