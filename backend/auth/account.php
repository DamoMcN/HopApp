<?php
// Change your own account details from Settings: name, email, phone number or password.
//
// POST JSON (Content-Type: application/json) with one "action":
//   { "action": "name",     "first_name": "...", "last_name": "..." }
//   { "action": "email",    "new_email": "...", "current_password": "..." }
//   { "action": "phone",    "new_phone": "..." }
//   { "action": "password", "current_password": "...", "new_password": "...", "confirm_password": "..." }
//
// Replies { success: true, message, f_name?, l_name?, email?, phone_last4? } or
//         { success: false, message, field, code } (field = the input to highlight).
// Email and password changes need the current password, so someone using an
// unlocked phone can't take over the account.

session_start();
header('Content-Type: application/json');
header('Cache-Control: no-store');

require_once __DIR__ . '/../db_connect.php';   // database settings live in one place

function respond(array $data, int $status = 200): void {
    http_response_code($status);
    echo json_encode($data);
    exit;
}

function fail(string $message, ?string $field = null, ?string $code = null, int $status = 422): void {
    respond(['success' => false, 'message' => $message, 'field' => $field, 'code' => $code], $status);
}

// Technical details go to the PHP error log, never to the person using the app
function server_error(string $detail): void {
    error_log('[HopApp account] ' . $detail);
    fail('Something went wrong on our side. Please try again in a moment.', null, 'server_error', 500);
}

if (!isset($_SESSION['email'])) {
    respond(['logged_in' => false], 401);
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    fail('Invalid request.', null, 'bad_request', 405);
}
// JSON only: a plain form on another website can't send this, so it can't change details for you
if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) {
    fail('Invalid request.', null, 'bad_request', 415);
}
$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
    fail('Invalid request.', null, 'bad_request', 400);
}

// Text fields only: anything else (numbers, lists) counts as empty
$text = static fn(string $key): string => is_string($input[$key] ?? null) ? $input[$key] : '';

try {
    $pdo = hop_pdo();
    $stmt = $pdo->prepare('SELECT user_id, email, password_hash FROM users WHERE email = ?');
    $stmt->execute([$_SESSION['email']]);
    $user = $stmt->fetch();
} catch (PDOException $e) {
    server_error('Lookup failed: ' . $e->getMessage());
}
if (!$user) {
    session_destroy();
    respond(['logged_in' => false], 401);
}
$userId = (int) $user['user_id'];

$checkCurrentPassword = static function (string $password) use ($user): void {
    if ($password === '') {
        fail('Enter your current password.', 'current_password', 'current_password_missing');
    }
    if (!password_verify($password, $user['password_hash'])) {
        fail('Your current password is not right.', 'current_password', 'wrong_password');
    }
};

$action = $text('action');

// ---------- Name ----------
if ($action === 'name') {
    $first = trim($text('first_name'));
    $last  = trim($text('last_name'));
    foreach (['first_name' => [$first, 'first name'], 'last_name' => [$last, 'last name']] as $field => [$value, $label]) {
        if ($value === '') fail('Enter your ' . $label . '.', $field, 'missing');
        if (mb_strlen($value) > 50) fail('Your ' . $label . ' can be up to 50 characters.', $field, 'too_long');
        if (preg_match('/[\x00-\x1F\x7F<>]/u', $value) || !preg_match('//u', $value)) {
            fail('Your ' . $label . ' has characters we can\'t use.', $field, 'bad_characters');
        }
    }
    try {
        $pdo->prepare('UPDATE users SET f_name = ?, l_name = ? WHERE user_id = ?')->execute([$first, $last, $userId]);
    } catch (PDOException $e) {
        server_error('Name update failed: ' . $e->getMessage());
    }
    $_SESSION['f_name'] = $first;
    respond(['success' => true, 'message' => 'Your name has been updated.', 'f_name' => $first, 'l_name' => $last]);
}

// ---------- Email ----------
if ($action === 'email') {
    $newEmail = trim($text('new_email'));
    if ($newEmail === '' || mb_strlen($newEmail) > 255 || !filter_var($newEmail, FILTER_VALIDATE_EMAIL)) {
        fail('Enter a valid email address.', 'new_email', 'bad_email');
    }
    if (strcasecmp($newEmail, $user['email']) === 0) {
        fail('That is already your email address.', 'new_email', 'same_email');
    }
    $checkCurrentPassword($text('current_password'));
    try {
        $taken = $pdo->prepare('SELECT 1 FROM users WHERE email = ? AND user_id <> ?');
        $taken->execute([$newEmail, $userId]);
        if ($taken->fetch()) {
            fail('Another account already uses this email.', 'new_email', 'email_taken');
        }
        $pdo->prepare('UPDATE users SET email = ? WHERE user_id = ?')->execute([$newEmail, $userId]);
    } catch (PDOException $e) {
        // 23000 = duplicate key: someone took this email a moment ago
        if ($e->getCode() === '23000') fail('Another account already uses this email.', 'new_email', 'email_taken');
        server_error('Email update failed: ' . $e->getMessage());
    }
    // The session is keyed on the email, so it has to follow the change
    session_regenerate_id(true);
    $_SESSION['email'] = $newEmail;
    respond(['success' => true, 'message' => 'Your email has been updated. Use it the next time you log in.', 'email' => $newEmail]);
}

// ---------- Phone number ----------
if ($action === 'phone') {
    // Spaces, dashes, dots and brackets are tidied away; a leading + is kept
    $phone = trim($text('new_phone'));
    $clean = preg_replace('/[\s\-.()]/', '', $phone);
    $digits = ltrim($clean, '+');
    if ($phone === '' || !preg_match('/^\+?\d+$/', $clean) || strlen($digits) < 7 || strlen($digits) > 15) {
        fail('Enter a valid phone number, for example 087 123 4567 or +353 87 123 4567.', 'new_phone', 'bad_phone');
    }
    try {
        $pdo->prepare('UPDATE users SET phone_number = ? WHERE user_id = ?')->execute([$clean, $userId]);
    } catch (PDOException $e) {
        server_error('Phone update failed: ' . $e->getMessage());
    }
    // Only the last four digits go back, the same as session.php
    respond(['success' => true, 'message' => 'Your phone number has been updated.', 'phone_last4' => substr($digits, -4)]);
}

// ---------- Password ----------
if ($action === 'password') {
    $current = $text('current_password');
    $new     = $text('new_password');
    $confirm = $text('confirm_password');
    $checkCurrentPassword($current);
    // Same rules as signing up (backend/auth/signup.php)
    if (strlen($new) < 8 || strlen($new) > 72
        || !preg_match('/[0-9]/', $new)
        || !preg_match('/[A-Z]/', $new)
        || !preg_match('/[a-z]/', $new)
        || !preg_match('/[^A-Za-z0-9]/', $new)) {
        fail('Your new password needs 8 to 72 characters, with a digit, an uppercase letter, a lowercase letter and a symbol.',
            'new_password', 'weak_password');
    }
    if ($new !== $confirm) {
        fail("The two new passwords don't match.", 'confirm_password', 'password_mismatch');
    }
    if ($new === $current) {
        fail('Your new password must be different from your current one.', 'new_password', 'same_password');
    }
    try {
        $pdo->prepare('UPDATE users SET password_hash = ? WHERE user_id = ?')
            ->execute([password_hash($new, PASSWORD_DEFAULT), $userId]);
    } catch (PDOException $e) {
        server_error('Password update failed: ' . $e->getMessage());
    }
    session_regenerate_id(true);
    respond(['success' => true, 'message' => 'Your password has been changed.']);
}

fail('Invalid request.', null, 'bad_request', 400);
