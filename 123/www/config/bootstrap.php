<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/security.php';
require_once __DIR__ . '/payroll.php';
require_once __DIR__ . '/push.php';

date_default_timezone_set('Europe/Prague');

function is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}

session_name(SESSION_NAME);
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'domain' => '',
    'secure' => is_https(),
    'httponly' => true,
    'samesite' => 'Lax',
]);

if (session_status() !== PHP_SESSION_ACTIVE) {
    session_start();
}

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: same-origin');
header('Permissions-Policy: geolocation=(self), camera=(), microphone=(), payment=()');
header("Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; frame-src https://www.openstreetmap.org; connect-src 'self'; object-src 'none'; form-action 'self'; base-uri 'self'; frame-ancestors 'self'; upgrade-insecure-requests");
if (is_https()) {
    header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
}

function json_response(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function read_json(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        return [];
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        json_response(['ok' => false, 'error' => 'Invalid JSON'], 400);
    }
    return $data;
}

function request_method(): string
{
    return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
}

function request_path(): string
{
    $uri = parse_url($_SERVER['REQUEST_URI'] ?? '/api', PHP_URL_PATH) ?: '/api';
    if (preg_match('~/api/index\.php$~', $uri)) {
        return trim($_GET['route'] ?? '', '/');
    }
    $pos = strpos($uri, '/api/');
    if ($pos === false) {
        return trim($_GET['route'] ?? '', '/');
    }
    return trim(substr($uri, $pos + 5), '/');
}

function ensure_csrf_token(): string
{
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

function require_csrf(): void
{
    if (in_array(request_method(), ['GET', 'HEAD', 'OPTIONS'], true)) {
        return;
    }
    $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    $known = $_SESSION['csrf_token'] ?? '';
    if (!$sent || !$known || !hash_equals($known, $sent)) {
        json_response(['ok' => false, 'error' => 'CSRF token mismatch'], 419);
    }
}

function current_user(): ?array
{
    if (empty($_SESSION['user_id'])) {
        return null;
    }
    $stmt = db()->prepare('SELECT id,email,name,role,employee_id,created_at FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([(int)$_SESSION['user_id']]);
    $user = $stmt->fetch();
    return $user ?: null;
}

function require_auth(): array
{
    $user = current_user();
    if (!$user) {
        json_response(['ok' => false, 'error' => 'Authentication required'], 401);
    }
    return $user;
}

function require_permission(string $permission): array
{
    $user = require_auth();
    if (!can($user, $permission)) {
        json_response(['ok' => false, 'error' => 'Permission denied'], 403);
    }
    return $user;
}

function audit_log(?array $user, string $action, string $entity, ?int $entityId = null, ?array $data = null, ?array $oldData = null): void
{
    try {
        $stmt = db()->prepare('INSERT INTO audit_logs (user_id,user_name,action,entity,entity_id,old_data,new_data,ip_address) VALUES (?,?,?,?,?,?,?,?)');
        $stmt->execute([
            $user['id'] ?? null,
            $user['name'] ?? $user['email'] ?? null,
            $action,
            $entity,
            $entityId,
            $oldData ? json_encode($oldData, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null,
            $data ? json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null,
            $_SERVER['REMOTE_ADDR'] ?? null,
        ]);
    } catch (Throwable $e) {
        error_log('Audit log failed: ' . $e->getMessage());
    }
}

function first_string(array $data, string $key, int $max = 255): string
{
    return substr(trim((string)($data[$key] ?? '')), 0, $max);
}

function nullable_string(array $data, string $key, int $max = 65535): ?string
{
    $value = trim((string)($data[$key] ?? ''));
    return $value === '' ? null : substr($value, 0, $max);
}

function normalize_email(string $value, int $max = 255): string
{
    $email = trim($value);
    $email = preg_replace('/[\s\x{00A0}\x{200B}-\x{200D}\x{FEFF}]+/u', '', $email) ?? $email;
    $replacements = [
        '/[\x{0410}\x{0430}]/u' => 'a',
        '/[\x{0412}\x{0432}]/u' => 'b',
        '/[\x{0415}\x{0435}]/u' => 'e',
        '/[\x{041A}\x{043A}]/u' => 'k',
        '/[\x{041C}\x{043C}]/u' => 'm',
        '/[\x{041D}\x{043D}]/u' => 'h',
        '/[\x{041E}\x{043E}]/u' => 'o',
        '/[\x{0420}\x{0440}]/u' => 'p',
        '/[\x{0421}\x{0441}]/u' => 'c',
        '/[\x{0422}\x{0442}]/u' => 't',
        '/[\x{0423}\x{0443}]/u' => 'y',
        '/[\x{0425}\x{0445}]/u' => 'x',
        '/[\x{0406}\x{0456}\x{0407}\x{0457}]/u' => 'i',
    ];
    foreach ($replacements as $pattern => $replacement) {
        $email = preg_replace($pattern, $replacement, $email) ?? $email;
    }
    return substr(strtolower($email), 0, $max);
}

function clean_email(string $value, int $max = 255): string
{
    $email = trim($value);
    $email = preg_replace('/[\s\x{00A0}\x{200B}-\x{200D}\x{FEFF}]+/u', '', $email) ?? $email;
    return substr(strtolower($email), 0, $max);
}

function email_with_ascii_domain(string $email): ?string
{
    if (substr_count($email, '@') !== 1) {
        return null;
    }
    [$local, $domain] = explode('@', $email, 2);
    if ($local === '' || $domain === '') {
        return null;
    }
    $ascii = null;
    if (function_exists('idn_to_ascii')) {
        if (defined('INTL_IDNA_VARIANT_UTS46')) {
            $ascii = idn_to_ascii($domain, defined('IDNA_DEFAULT') ? IDNA_DEFAULT : 0, INTL_IDNA_VARIANT_UTS46);
        } else {
            $ascii = idn_to_ascii($domain);
        }
    }
    if (!$ascii && normalize_email($domain) === 'kravets.cz') {
        $ascii = 'xn--kravts-6of.cz';
    }
    return $ascii ? strtolower($local . '@' . $ascii) : null;
}

function email_login_candidates(string $value): array
{
    $raw = clean_email($value);
    $latin = normalize_email($value);
    $candidates = [$raw, $latin, email_with_ascii_domain($raw), email_with_ascii_domain($latin)];
    return array_values(array_unique(array_filter($candidates, static fn($email): bool => is_string($email) && $email !== '')));
}

function money_value(array $data, string $key): float
{
    return round((float)str_replace(',', '.', (string)($data[$key] ?? 0)), 2);
}

function int_or_null(array $data, string $key): ?int
{
    $value = $data[$key] ?? null;
    return ($value === null || $value === '') ? null : (int)$value;
}

function date_or_null(array $data, string $key): ?string
{
    $value = trim((string)($data[$key] ?? ''));
    if ($value === '') {
        return null;
    }
    return preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) ? $value : null;
}

function datetime_or_null(array $data, string $key): ?string
{
    $value = trim((string)($data[$key] ?? ''));
    if ($value === '') {
        return null;
    }
    $value = str_replace('T', ' ', $value);
    if (preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/', $value)) {
        return $value . ':00';
    }
    if (preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $value)) {
        return $value;
    }
    return null;
}

function require_fields(array $data, array $fields): void
{
    foreach ($fields as $field) {
        if (!isset($data[$field]) || trim((string)$data[$field]) === '') {
            json_response(['ok' => false, 'error' => 'Missing field: ' . $field], 422);
        }
    }
}
