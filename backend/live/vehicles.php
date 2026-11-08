<?php
// Live bus positions for the Hop map. Runs on WAMP/Apache like the rest of the PHP, so nothing extra
// needs installing or starting.
//
//   GET vehicles.php?route_id=XYZ   ->  [{ "id", "lat", "lon", "speed", "timestamp" }, ...]
//   route_id is optional; leave it out to get every bus.
//
// The National Transport Authority (NTA) key lives in config.local.php (see config.local.php.example).
// That file is git-ignored and PHP never sends it to the browser.

declare(strict_types=1);

require __DIR__ . '/gtfsr.php';

const NTA_URL = 'https://api.nationaltransport.ie/gtfsr/v2/vehicles';
const CACHE_SECONDS = 10;        // many people refreshing = one request to the NTA
const STALE_OK_SECONDS = 90;     // if the NTA is briefly down, keep showing the last positions this long

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

// When this file is hosted somewhere other than the site that shows the map (for example on Azure),
// the browser only allows the map to read it if the map's address is listed here.
// Set ALLOWED_ORIGINS on the host (comma separated, no trailing slash), for example:
//   http://localhost,http://127.0.0.1
// On WAMP, where this file is on the same site as the map, nothing is needed.
$allowedOrigins = array_filter(array_map('trim', explode(',',
    (string) (getenv('ALLOWED_ORIGINS') ?: 'http://localhost,http://127.0.0.1'))));
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '' && in_array($origin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}

function fail(int $status, string $message, string $detail = ''): void
{
    if ($detail !== '') {
        // Technical detail stays on the server: the PHP error log and a private log next to this file
        error_log('[HopApp live] ' . $detail);
        @file_put_contents(__DIR__ . '/live-error.log', date('c') . ' ' . $detail . "\n", FILE_APPEND | LOCK_EX);
    }
    http_response_code($status);
    echo json_encode(['error' => $message]);
    exit;
}

function load_key(): string
{
    $file = __DIR__ . '/config.local.php';
    if (is_file($file)) {
        $config = require $file;
        if (is_array($config) && !empty($config['nta_api_key'])) {
            return trim((string) $config['nta_api_key']);
        }
    }
    return trim((string) getenv('NTA_API_KEY'));
}

// A list of trusted certificate authorities for HTTPS. WAMP's PHP often has none set up, which
// makes secure requests fail with "unable to get local issuer certificate". We never switch the
// check off: we find a certificate file, or ask Windows to use its own certificate store.
function find_ca_bundle(): string
{
    $candidates = [];

    $config = is_file(__DIR__ . '/config.local.php') ? require __DIR__ . '/config.local.php' : [];
    if (is_array($config) && !empty($config['ca_bundle'])) {
        $candidates[] = (string) $config['ca_bundle'];
    }

    $candidates[] = (string) ini_get('curl.cainfo');
    $candidates[] = (string) ini_get('openssl.cafile');
    $candidates[] = dirname(PHP_BINARY) . '/extras/ssl/cacert.pem';
    foreach ([
        'C:/wamp64/bin/php/*/extras/ssl/cacert.pem',
        'C:/wamp64/bin/apache/*/bin/curl-ca-bundle.crt',
        'C:/wamp64/bin/apache/*/conf/cacert.pem',
        'C:/wamp/bin/php/*/extras/ssl/cacert.pem',
    ] as $pattern) {
        foreach (glob($pattern) ?: [] as $found) {
            $candidates[] = $found;
        }
    }

    foreach ($candidates as $file) {
        if ($file !== '' && is_file($file)) {
            return $file;
        }
    }
    return '';
}

function fetch_feed(string $key): string
{
    if (!function_exists('curl_init')) {
        throw new RuntimeException('The PHP cURL extension is switched off (enable it in WAMP: PHP > PHP extensions > curl)');
    }

    $ch = curl_init(NTA_URL . '?subscription-key=' . rawurlencode($key));
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT        => 8,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_HTTPHEADER     => [
            'Cache-Control: no-cache',
            'Ocp-Apim-Subscription-Key: ' . $key,
        ],
    ]);
    $bundle = find_ca_bundle();
    if ($bundle !== '') {
        curl_setopt($ch, CURLOPT_CAINFO, $bundle);
    }
    if (defined('CURLSSLOPT_NATIVE_CA')) {
        curl_setopt($ch, CURLOPT_SSL_OPTIONS, CURLSSLOPT_NATIVE_CA);   // also trust the operating system's certificates
    }

    $body = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $error = curl_error($ch);
    curl_close($ch);

    if ($body === false) {
        throw new RuntimeException('Could not reach the NTA: ' . $error .
            ' [PHP ' . PHP_VERSION . ', certificate file: ' . ($bundle !== '' ? $bundle : 'none found') .
            ', native CA option: ' . (defined('CURLSSLOPT_NATIVE_CA') ? 'yes' : 'no (PHP older than 8.2)') . ']');
    }
    if ($status !== 200) {
        $hint = '';
        if ($status === 401 || $status === 403) {
            $hint = ' (the NTA rejected the key: check config.local.php)';
        } elseif ($status === 429) {
            $hint = ' (too many requests)';
        }
        throw new RuntimeException('NTA responded with ' . $status . $hint);
    }
    return (string) $body;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    fail(405, 'Invalid request.');
}

$cacheFile = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'hop_live_vehicles.json';
$cacheAge = is_file($cacheFile) ? time() - (int) filemtime($cacheFile) : PHP_INT_MAX;
$vehicles = null;

if ($cacheAge < CACHE_SECONDS) {
    $vehicles = json_decode((string) file_get_contents($cacheFile), true);
}

if (!is_array($vehicles)) {
    $key = load_key();
    if ($key === '' || $key === 'put-your-key-here') {
        fail(503, 'Live bus data is not set up on this server.',
            'No NTA key. Copy backend/live/config.local.php.example to config.local.php and add your key.');
    }

    try {
        $vehicles = decode_vehicles(fetch_feed($key));
        file_put_contents($cacheFile, json_encode($vehicles), LOCK_EX);
    } catch (Throwable $e) {
        if ($cacheAge < STALE_OK_SECONDS) {
            $vehicles = json_decode((string) file_get_contents($cacheFile), true);
        }
        if (!is_array($vehicles)) {
            fail(502, 'Live bus data is not available right now.', $e->getMessage());
        }
    }
}

$routeId = isset($_GET['route_id']) ? (string) $_GET['route_id'] : '';
$result = [];
foreach ($vehicles as $v) {
    if ($routeId !== '' && ($v['routeId'] ?? null) !== $routeId) {
        continue;
    }
    unset($v['routeId']);
    $result[] = $v;
}

echo json_encode($result);
