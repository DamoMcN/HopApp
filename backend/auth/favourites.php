<?php
// Favourite bus routes and stops.
//
//   GET  favourites.php                                          -> the user's favourites, newest first
//   POST favourites.php {action:"add", type, item_id, label}     -> save a route or stop
//   POST favourites.php {action:"remove", type, item_id}         -> remove it again
//
// type is "route" or "stop". item_id is the route_id or stop id from the map data.

session_start();
header('Content-Type: application/json');
header('Cache-Control: no-store');

const FAV_TYPES = ['route', 'stop'];

function respond(array $data, int $status = 200): void {
    http_response_code($status);
    echo json_encode($data);
    exit;
}

if (!isset($_SESSION['email'])) {
    respond(['logged_in' => false], 401);
}

require_once __DIR__ . '/../db_connect.php';   // database settings live in one place
try {
    $pdo = hop_pdo();
} catch (PDOException $e) {
    error_log('[HopApp favourites] Database connection failed: ' . $e->getMessage());
    respond(['logged_in' => true, 'success' => false, 'error' => 'Database connection failed'], 500);
}

// The user always comes from the session, never from the request.
$stmt = $pdo->prepare('SELECT user_id FROM users WHERE email = ?');
$stmt->execute([$_SESSION['email']]);
$userId = $stmt->fetchColumn();

if (!$userId) {
    session_destroy();
    respond(['logged_in' => false], 401);
}
$userId = (int) $userId;

function favourites(PDO $pdo, int $userId): array {
    $stmt = $pdo->prepare(
        'SELECT fav_type, item_id, label FROM favourites WHERE user_id = ? ORDER BY favourite_id DESC'
    );
    $stmt->execute([$userId]);
    return array_map(function ($r) {
        return ['type' => $r['fav_type'], 'item_id' => $r['item_id'], 'label' => $r['label']];
    }, $stmt->fetchAll());
}

try {
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        respond(['logged_in' => true, 'success' => true, 'favourites' => favourites($pdo, $userId)]);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        respond(['success' => false, 'error' => 'Method not allowed'], 405);
    }

    // A JSON body can't be sent by a plain HTML form on another site (simple CSRF guard)
    if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) {
        respond(['success' => false, 'error' => 'Content-Type must be application/json'], 415);
    }

    $body   = json_decode(file_get_contents('php://input'), true);
    $action = is_array($body) ? ($body['action'] ?? '') : '';
    $type   = is_array($body) ? ($body['type'] ?? '') : '';
    $itemId = is_array($body) ? trim((string) ($body['item_id'] ?? '')) : '';

    if (!in_array($type, FAV_TYPES, true) || $itemId === '' || strlen($itemId) > 255) {
        respond(['success' => false, 'error' => 'Invalid favourite'], 400);
    }

    if ($action === 'add') {
        $label = trim((string) ($body['label'] ?? ''));
        if ($label === '') $label = ($type === 'route' ? 'Route ' : 'Stop ') . $itemId;
        $label = mb_substr($label, 0, 255);

        // Saving something that is already saved just keeps it (and refreshes its name)
        $stmt = $pdo->prepare(
            'INSERT INTO favourites (user_id, fav_type, item_id, label) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE label = VALUES(label)'
        );
        $stmt->execute([$userId, $type, $itemId, $label]);
    } elseif ($action === 'remove') {
        $stmt = $pdo->prepare('DELETE FROM favourites WHERE user_id = ? AND fav_type = ? AND item_id = ?');
        $stmt->execute([$userId, $type, $itemId]);
    } else {
        respond(['success' => false, 'error' => 'Unknown action'], 400);
    }

    respond(['logged_in' => true, 'success' => true, 'favourites' => favourites($pdo, $userId)]);
} catch (PDOException $e) {
    error_log('[HopApp favourites] Database error: ' . $e->getMessage());
    respond(['logged_in' => true, 'success' => false, 'error' => 'Database error'], 500);
}
