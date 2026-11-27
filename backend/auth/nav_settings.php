<?php
// The person's own bottom bar and start page (Settings > Customise app).
//
//   GET  nav_settings.php                          -> { tabs: [...], start_page: "card" }
//   POST nav_settings.php {tabs: [...], start_page: "card"}
//        -> saves them. Declined (422) if a page is unknown or repeated, if Card or Top Up is missing,
//           or if there are fewer than 2 or more than 5 buttons.
//
// Saved in the existing `settings` table: navbar_layout (JSON list of page ids) and default_tab.
// Someone who has never saved anything gets the default bar.

session_start();
header('Content-Type: application/json');
header('Cache-Control: no-store');

const NAV_PAGES    = ['card', 'topup', 'map', 'tickets', 'support'];
const NAV_REQUIRED = ['card', 'topup'];          // always in the bar
const NAV_DEFAULT  = ['card', 'topup', 'map', 'tickets'];
const NAV_MIN      = 2;
const NAV_MAX      = 5;
const NAV_ALIASES  = ['home' => 'card'];         // names older rows use for a page

function respond(array $data, int $status = 200): void {
    http_response_code($status);
    echo json_encode($data);
    exit;
}

if (!isset($_SESSION['email'])) {
    respond(['logged_in' => false], 401);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if (!in_array($method, ['GET', 'POST'], true)) {
    respond(['error' => 'Invalid request method'], 405);
}

// A saved list, checked again on the way out so an old or edited row can never break the bar
function clean_tabs($value): array {
    $list = is_array($value) ? $value : [];
    $tabs = [];
    foreach ($list as $id) {
        if (!is_string($id)) continue;
        $id = NAV_ALIASES[$id] ?? $id;
        if (in_array($id, NAV_PAGES, true) && !in_array($id, $tabs, true)) $tabs[] = $id;
    }
    foreach (array_reverse(NAV_REQUIRED) as $id) {
        if (!in_array($id, $tabs, true)) array_unshift($tabs, $id);
    }
    return count($tabs) >= NAV_MIN ? array_slice($tabs, 0, NAV_MAX) : NAV_DEFAULT;
}

function clean_start($value): string {
    $id = is_string($value) ? (NAV_ALIASES[$value] ?? $value) : '';
    return in_array($id, NAV_PAGES, true) ? $id : 'card';
}

require_once __DIR__ . '/../db_connect.php';
try {
    $pdo = hop_pdo();
    $userQuery = $pdo->prepare('SELECT user_id FROM users WHERE email = ?');
    $userQuery->execute([$_SESSION['email']]);
    $userId = $userQuery->fetchColumn();
    if ($userId === false) {
        session_destroy();
        respond(['logged_in' => false], 401);
    }
    $userId = (int) $userId;

    if ($method === 'GET') {
        $query = $pdo->prepare('SELECT navbar_layout, default_tab FROM settings WHERE user_id = ?');
        $query->execute([$userId]);
        $row = $query->fetch();
        $saved = $row && $row['navbar_layout'] !== null ? json_decode($row['navbar_layout'], true) : null;
        respond([
            'logged_in'  => true,
            'tabs'       => $saved === null ? NAV_DEFAULT : clean_tabs($saved),
            'start_page' => $row ? clean_start($row['default_tab']) : 'card',
        ]);
    }

    // ---------- POST: save ----------
    if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) {
        respond(['error' => 'Content-Type must be application/json'], 415);
    }
    $input = json_decode(file_get_contents('php://input'), true);
    if (!is_array($input) || !isset($input['tabs']) || !is_array($input['tabs'])) {
        respond(['error' => 'Invalid settings data'], 400);
    }

    $tabs = $input['tabs'];
    $seen = [];
    foreach ($tabs as $id) {
        if (!is_string($id) || !in_array($id, NAV_PAGES, true)) {
            respond(['error' => 'One of the pages is not known.'], 422);
        }
        if (in_array($id, $seen, true)) {
            respond(['error' => 'A page can only be in the bar once.'], 422);
        }
        $seen[] = $id;
    }
    foreach (NAV_REQUIRED as $id) {
        if (!in_array($id, $seen, true)) {
            respond(['error' => 'Card and Top Up always stay in the bar.'], 422);
        }
    }
    if (count($seen) < NAV_MIN || count($seen) > NAV_MAX) {
        respond(['error' => 'The bar needs between ' . NAV_MIN . ' and ' . NAV_MAX . ' buttons.'], 422);
    }
    $start = $input['start_page'] ?? 'card';
    if (!is_string($start) || !in_array($start, NAV_PAGES, true)) {
        respond(['error' => 'Choose a page that exists to open first.'], 422);
    }

    $save = $pdo->prepare(
        'INSERT INTO settings (user_id, default_tab, navbar_layout) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE default_tab = VALUES(default_tab), navbar_layout = VALUES(navbar_layout)'
    );
    $save->execute([$userId, $start, json_encode($seen)]);

    respond(['success' => true, 'tabs' => $seen, 'start_page' => $start]);
} catch (PDOException $e) {
    error_log('[HopApp nav_settings] ' . $e->getMessage());
    respond(['error' => 'Could not load or save your settings. Please try again.'], 500);
}
