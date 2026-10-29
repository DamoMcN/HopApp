<?php
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
    respond(false, 'Invalid request method: ' . $_SERVER['REQUEST_METHOD']);
}

try {
    $pdo = new PDO($dsn, $user, $pass, $options);
} catch (PDOException $e) {
    respond(false, 'Database connection failed: ' . $e->getMessage());
}

// ---------- Read input ----------
$firstName   = trim($_POST['first_name'] ?? '');
$lastName    = trim($_POST['last_name'] ?? '');
$phone       = trim($_POST['phone_number'] ?? '');
$nationality = trim($_POST['nationality'] ?? '');
$email       = trim($_POST['user_email'] ?? '');
$password    = $_POST['user_password'] ?? '';
$dob         = $_POST['dob'] ?? '';
$isStudent   = isset($_POST['is-student']) ? 1 : 0;
$cardType    = $_POST['card_type'] ?? '';

// ---------- Validation ----------
if ($firstName === '' || $lastName === '' || $email === '' || $password === '' || $dob === '') {
    respond(false, 'Please fill in all required fields.');
}

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    respond(false, 'Please enter a valid email address.');
}

if (strlen($password) < 8
    || !preg_match('/[0-9]/', $password)
    || !preg_match('/[A-Z]/', $password)
    || !preg_match('/[a-z]/', $password)
    || !preg_match('/[^A-Za-z0-9]/', $password)) {
    respond(false, 'Password must be at least 8 characters and include a digit, an uppercase letter, a lowercase letter and a symbol.');
}

$dobDate = DateTime::createFromFormat('Y-m-d', $dob);
if (!$dobDate || $dobDate > new DateTime()) {
    respond(false, 'Please enter a valid date of birth.');
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
        respond(false, 'This email is already registered.');
    }
} catch (PDOException $e) {
    respond(false, 'Database error during email check: ' . $e->getMessage());
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
    respond(false, 'Database error generating card number: ' . $e->getMessage());
}

// ---------- Insert ----------
$sql = 'INSERT INTO users
            (f_name, l_name, card_number, phone_number, nationality, email, password_hash, dob, is_student, card_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

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
    respond(false, 'Failed to write to database: ' . $e->getMessage());
}