<?php
$host = 'localhost';
$dbname = 'hop_app_db';
$username = 'root';
$password = '';

try {
    // Create a new PDO instance
    $pdo = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8mb4", $username, $password);

    // Set the PDO error mode to exception to catch any bugs easily
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    // echo "Connected successfully"; // Uncomment this line to test the connection
} catch (PDOException $e) {
    die("Database connection failed: " . $e->getMessage());
}
?>