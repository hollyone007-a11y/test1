<?php
declare(strict_types=1);

$parts = explode('/', request_path());
$action = $parts[1] ?? 'me';
$method = request_method();

if ($method === 'GET' && $action === 'csrf') {
    json_response(['ok' => true, 'csrf' => ensure_csrf_token()]);
}

if ($method === 'GET' && $action === 'me') {
    $user = current_user();
    json_response(['ok' => true, 'user' => $user ? public_user($user) : null, 'csrf' => ensure_csrf_token()]);
}

if ($method === 'POST' && $action === 'login') {
    require_csrf();
    $data = read_json();
    require_fields($data, ['email', 'password']);
    $email = normalize_email((string)$data['email']);
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    $throttle = db()->prepare("SELECT COUNT(*) FROM audit_logs WHERE action = 'LOGIN_FAILED' AND ip_address = ? AND created_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)");
    $throttle->execute([$ip]);
    if ((int)$throttle->fetchColumn() >= 5) {
        audit_log(null, 'LOGIN_BLOCKED', 'auth', null, ['email' => $email]);
        json_response(['ok' => false, 'error' => 'Too many login attempts. Try again later.'], 429);
    }
    $emailCandidates = email_login_candidates((string)$data['email']);
    $placeholders = implode(',', array_fill(0, count($emailCandidates), '?'));
    $stmt = db()->prepare("SELECT id,email,password_hash,name,role,employee_id,created_at FROM users WHERE email IN ($placeholders) LIMIT 1");
    $stmt->execute($emailCandidates);
    $user = $stmt->fetch();
    if (!$user || !password_verify((string)$data['password'], (string)$user['password_hash'])) {
        audit_log(null, 'LOGIN_FAILED', 'auth', null, ['email' => $email, 'typed_email' => $data['email'] ?? '']);
        json_response(['ok' => false, 'error' => 'Invalid login or password'], 401);
    }
    session_regenerate_id(true);
    $_SESSION['user_id'] = (int)$user['id'];
    ensure_csrf_token();
    db()->prepare('UPDATE users SET last_login_at = NOW() WHERE id = ?')->execute([(int)$user['id']]);
    audit_log($user, 'LOGIN', 'auth', (int)$user['id']);
    json_response(['ok' => true, 'user' => public_user($user), 'csrf' => $_SESSION['csrf_token']]);
}

if ($method === 'POST' && $action === 'logout') {
    require_csrf();
    $user = current_user();
    if ($user) {
        audit_log($user, 'LOGOUT', 'auth', (int)$user['id']);
    }
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], (bool)$params['secure'], (bool)$params['httponly']);
    }
    session_destroy();
    json_response(['ok' => true]);
}

if ($method === 'POST' && $action === 'password') {
    require_csrf();
    $user = require_auth();
    $data = read_json();
    require_fields($data, ['current_password', 'new_password']);
    if (strlen((string)$data['new_password']) < 8) {
        json_response(['ok' => false, 'error' => 'New password must have at least 8 characters'], 422);
    }
    $stmt = db()->prepare('SELECT password_hash FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([(int)$user['id']]);
    $hash = (string)$stmt->fetchColumn();
    if (!$hash || !password_verify((string)$data['current_password'], $hash)) {
        audit_log($user, 'PASSWORD_CHANGE_FAILED', 'auth', (int)$user['id']);
        json_response(['ok' => false, 'error' => 'Current password is not correct'], 422);
    }
    db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([
        password_hash((string)$data['new_password'], PASSWORD_DEFAULT),
        (int)$user['id'],
    ]);
    audit_log($user, 'PASSWORD_CHANGE', 'auth', (int)$user['id']);
    json_response(['ok' => true]);
}

json_response(['ok' => false, 'error' => 'Auth route not found'], 404);
