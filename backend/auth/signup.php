<?php
header('Content-Type: application/json');

require_once __DIR__ . '/../db_connect.php';   // database settings live in one place

// $field is the form field the front end should highlight, $code lets it
// pick a special message (for example 'email_taken')
function respond($success, $message = '', $field = null, $code = null) {
    echo json_encode(['success' => $success, 'message' => $message, 'field' => $field, 'code' => $code]);
    exit;
}

// Technical details go to the PHP error log, never to the person using the app
function server_error($detail) {
    error_log('[HopApp signup] ' . $detail);
    respond(false, 'Something went wrong on our side. Please try again in a moment.', null, 'server_error');
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(false, 'Invalid request.', null, 'bad_request');
}

try {
    $pdo = hop_pdo();
} catch (PDOException $e) {
    server_error('Database connection failed: ' . $e->getMessage());
}

// ---------- Read input ----------
$firstName   = trim($_POST['first_name'] ?? '');
$lastName    = trim($_POST['last_name'] ?? '');
$phone       = trim($_POST['phone_number'] ?? '');
$nationality = trim($_POST['nationality'] ?? '');
$email       = trim($_POST['user_email'] ?? '');
$password    = $_POST['user_password'] ?? '';
$confirm     = $_POST['confirm_password'] ?? '';
$dob         = $_POST['dob'] ?? '';
$isStudent   = isset($_POST['is-student']) ? 1 : 0;
$cardType    = $_POST['card_type'] ?? '';

// ---------- Validation ----------
if ($firstName === '' || $lastName === '' || $email === '' || $password === '' || $dob === '') {
    respond(false, 'Please fill in all required fields.');
}

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    respond(false, 'Please enter a valid email address.', 'signup-email');
}

if ($password !== $confirm) {
    respond(false, "The two passwords don't match. Please type the same password in both boxes.", 'confirm-password', 'password_mismatch');
}

if (strlen($password) < 8
    || !preg_match('/[0-9]/', $password)
    || !preg_match('/[A-Z]/', $password)
    || !preg_match('/[a-z]/', $password)
    || !preg_match('/[^A-Za-z0-9]/', $password)) {
    respond(false, 'Password must be at least 8 characters and include a digit, an uppercase letter, a lowercase letter and a symbol.', 'signup-password', 'weak_password');
}

$dobDate = DateTime::createFromFormat('Y-m-d', $dob);
if (!$dobDate || $dobDate > new DateTime()) {
    respond(false, 'Please enter a valid date of birth.', 'dob');
}

// Map the values auth.js sends to the DB enum values
$cardMap = [
    'adult'       => 'Adult',
    'young-adult' => 'Young Adult',
    'student'     => 'Student',
    'child'       => 'Child',
];
if (!isset($cardMap[$cardType])) {
    respond(false, 'Please choose a card type.');
}
$cardTypeDb = $cardMap[$cardType];

// ---------- Email already taken? ----------
try {
    $stmt = $pdo->prepare('SELECT email FROM users WHERE email = ?');
    $stmt->execute([$email]);
    if ($stmt->fetch()) {
        respond(false, 'This email is already registered.', 'signup-email', 'email_taken');
    }
} catch (PDOException $e) {
    server_error('Email check failed: ' . $e->getMessage());
}

// ---------- Hash the password ----------
$hashedPassword = password_hash($password, PASSWORD_DEFAULT);

// ---------- Generate a unique 8-digit card number ----------
try {
    do {
        $cardNumber = '';
        for ($i = 0; $i < 8; $i++) {
            $cardNumber .= random_int(0, 9);
        }
        $chk = $pdo->prepare('SELECT 1 FROM users WHERE card_number = ?');
        $chk->execute([$cardNumber]);
    } while ($chk->fetch());
} catch (PDOException $e) {
    server_error('Card number generation failed: ' . $e->getMessage());
}

// ---------- Insert ----------
$sql = 'INSERT INTO users
            (f_name, l_name, card_number, card_expiry, phone_number, nationality, email, password_hash, dob, is_student, card_type)
        VALUES (?, ?, ?, DATE_ADD(CURRENT_DATE, INTERVAL 1 YEAR), ?, ?, ?, ?, ?, ?, ?)';
// A new card is valid for exactly one year from the day it is created
// (created 5 Nov 2026 -> expires 5 Nov 2027). The database works the date out
// so it always matches created_at.

try {
    $stmt = $pdo->prepare($sql);
    $stmt->execute([
        $firstName,
        $lastName,
        $cardNumber,
        $phone,
        $nationality,
        $email,
        $hashedPassword,
        $dob,
        $isStudent,
        $cardTypeDb
    ]);
    respond(true, 'Account created successfully.');
} catch (PDOException $e) {
    // 23000 = duplicate key: someone registered this email a moment ago
    if ($e->getCode() === '23000') {
        respond(false, 'This email is already registered.', 'signup-email', 'email_taken');
    }
    server_error('Insert failed: ' . $e->getMessage());
}