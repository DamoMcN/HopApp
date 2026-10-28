<?php
// Tell the browser to expect a JSON response
header('Content-Type: application/json');

// WampServer default database connection settings
$host = 'localhost';
$db   = 'hop_app_db'; 
$user = 'root';
$pass = ''; 
$charset = 'utf8mb4';

$dsn = "mysql:host=$host;dbname=$db;charset=$charset";
$options = [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false,
];

try {
    $pdo = new PDO($dsn, $user, $pass, $options);
} catch (\PDOException $e) {
    echo json_encode(['success' => false, 'message' => 'Database connection failed.']);
    exit;
}

if ($_SERVER["REQUEST_METHOD"] == "POST") {
    // Retrieve POST data matching the 'name' attributes in HTML
    $email = $_POST['user_email'] ?? '';
    $password = $_POST['password'] ?? '';
    $dob = $_POST['dob'] ?? '';
    
    // Checkboxes are only sent if checked, so we check if it is set
    $isStudent = isset($_POST['is-student']) ? 1 : 0; 

    if (empty($email) || empty($password)) {
        echo json_encode(['success' => false, 'message' => 'Email and password are required.']);
        exit;
    }

    // Always hash passwords before storing them in the database
    $hashedPassword = password_hash($password, PASSWORD_DEFAULT);

    // Check if the email is already in the database
    $stmt = $pdo->prepare("SELECT id FROM users WHERE email = ?");
    $stmt->execute([$email]);
    if ($stmt->fetch()) {
        echo json_encode(['success' => false, 'message' => 'This email is already registered.']);
        exit;
    }

    // Insert the new user into the database
    $sql = "INSERT INTO users (email, password, dob, is_student) VALUES (?, ?, ?, ?)";
    $stmt = $pdo->prepare($sql);
    
    try {
        $stmt->execute([$email, $hashedPassword, $dob, $isStudent]);
        // Send a success signal back to auth.js to trigger the modal
        echo json_encode(['success' => true]);
    } catch (\PDOException $e) {
        echo json_encode(['success' => false, 'message' => 'Failed to write to database.']);
    }
}
?>