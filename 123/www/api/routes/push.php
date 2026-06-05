<?php
declare(strict_types=1);

$method = request_method();
$user = require_auth();

function push_public_payload(): array
{
    return [
        'ok' => true,
        'public_key' => PUSH_PUBLIC_KEY !== '' ? PUSH_PUBLIC_KEY : null,
        'configured' => push_configured(),
        'transport' => push_transport(),
    ];
}

if ($method === 'GET') {
    json_response(push_public_payload());
}

if ($method === 'POST' && ($parts[1] ?? '') === 'test') {
    push_notify_user((int)$user['id']);
    audit_log($user, 'PUSH_TEST', 'push_subscriptions', null);
    json_response(['ok' => true, 'sent' => true] + push_public_payload());
}

if ($method === 'POST') {
    $data = read_json();
    $subscription = is_array($data['subscription'] ?? null) ? $data['subscription'] : $data;
    $endpoint = trim((string)($subscription['endpoint'] ?? ''));
    if ($endpoint === '' || strlen($endpoint) > 4096 || !preg_match('~^https://~i', $endpoint)) {
        json_response(['ok' => false, 'error' => 'Invalid push endpoint'], 422);
    }
    $keys = is_array($subscription['keys'] ?? null) ? $subscription['keys'] : [];
    $endpointHash = hash('sha256', $endpoint);
    $employeeId = empty($user['employee_id']) ? null : (int)$user['employee_id'];
    $stmt = db()->prepare('INSERT INTO push_subscriptions (user_id,employee_id,endpoint_hash,endpoint,p256dh,auth,user_agent)
      VALUES (?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE user_id=VALUES(user_id), employee_id=VALUES(employee_id), endpoint=VALUES(endpoint), p256dh=VALUES(p256dh), auth=VALUES(auth), user_agent=VALUES(user_agent), updated_at=NOW()');
    $stmt->execute([
        (int)$user['id'],
        $employeeId,
        $endpointHash,
        $endpoint,
        substr((string)($keys['p256dh'] ?? ''), 0, 255) ?: null,
        substr((string)($keys['auth'] ?? ''), 0, 255) ?: null,
        substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255) ?: null,
    ]);
    audit_log($user, 'PUSH_SUBSCRIBE', 'push_subscriptions', null, [
        'employee_id' => $employeeId,
        'endpoint_hash' => $endpointHash,
    ]);
    json_response(['ok' => true, 'subscribed' => true] + push_public_payload());
}

if ($method === 'DELETE') {
    $data = read_json();
    $endpoint = trim((string)($data['endpoint'] ?? ''));
    if ($endpoint !== '') {
        db()->prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint_hash = ?')->execute([(int)$user['id'], hash('sha256', $endpoint)]);
    } else {
        db()->prepare('DELETE FROM push_subscriptions WHERE user_id = ?')->execute([(int)$user['id']]);
    }
    audit_log($user, 'PUSH_UNSUBSCRIBE', 'push_subscriptions', null, ['endpoint' => $endpoint !== '' ? hash('sha256', $endpoint) : 'all']);
    json_response(['ok' => true]);
}

json_response(['ok' => false, 'error' => 'Push route not found'], 404);
