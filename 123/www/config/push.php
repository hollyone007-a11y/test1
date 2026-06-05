<?php
declare(strict_types=1);

function push_base64url(string $value): string
{
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}

function push_decode_length(string $der, int &$offset): int
{
    $length = ord($der[$offset++]);
    if ($length < 128) {
        return $length;
    }
    $bytes = $length & 0x7f;
    $length = 0;
    for ($i = 0; $i < $bytes; $i++) {
        $length = ($length << 8) | ord($der[$offset++]);
    }
    return $length;
}

function push_der_to_jose(string $der): string
{
    $offset = 0;
    if (ord($der[$offset++]) !== 0x30) {
        throw new RuntimeException('Invalid ECDSA signature.');
    }
    push_decode_length($der, $offset);
    if (ord($der[$offset++]) !== 0x02) {
        throw new RuntimeException('Invalid ECDSA R signature.');
    }
    $rLength = push_decode_length($der, $offset);
    $r = substr($der, $offset, $rLength);
    $offset += $rLength;
    if (ord($der[$offset++]) !== 0x02) {
        throw new RuntimeException('Invalid ECDSA S signature.');
    }
    $sLength = push_decode_length($der, $offset);
    $s = substr($der, $offset, $sLength);
    $r = str_pad(ltrim($r, "\x00"), 32, "\x00", STR_PAD_LEFT);
    $s = str_pad(ltrim($s, "\x00"), 32, "\x00", STR_PAD_LEFT);
    return substr($r, -32) . substr($s, -32);
}

function push_configured(): bool
{
    return PUSH_PUBLIC_KEY !== ''
        && PUSH_PRIVATE_PEM !== ''
        && function_exists('openssl_sign')
        && (function_exists('curl_init') || (bool)ini_get('allow_url_fopen'));
}

function push_transport(): ?string
{
    if (function_exists('curl_init')) {
        return 'curl';
    }
    return (bool)ini_get('allow_url_fopen') ? 'stream' : null;
}

function push_audience(string $endpoint): string
{
    $parts = parse_url($endpoint);
    if (empty($parts['scheme']) || empty($parts['host'])) {
        return '';
    }
    $port = empty($parts['port']) ? '' : ':' . (int)$parts['port'];
    return $parts['scheme'] . '://' . $parts['host'] . $port;
}

function push_vapid_token(string $audience): string
{
    $header = push_base64url(json_encode(['typ' => 'JWT', 'alg' => 'ES256'], JSON_UNESCAPED_SLASHES));
    $claims = push_base64url(json_encode([
        'aud' => $audience,
        'exp' => time() + 12 * 3600,
        'sub' => PUSH_SUBJECT,
    ], JSON_UNESCAPED_SLASHES));
    $body = $header . '.' . $claims;
    $signature = '';
    if (!openssl_sign($body, $signature, PUSH_PRIVATE_PEM, OPENSSL_ALGO_SHA256)) {
        throw new RuntimeException('Push signing failed.');
    }
    return $body . '.' . push_base64url(push_der_to_jose($signature));
}

function push_send_subscription(array $subscription): bool
{
    if (!push_configured()) {
        return false;
    }
    $endpoint = trim((string)($subscription['endpoint'] ?? ''));
    $audience = $endpoint !== '' ? push_audience($endpoint) : '';
    if ($audience === '') {
        return false;
    }
    try {
        $token = push_vapid_token($audience);
        $headers = [
            'TTL: 300',
            'Urgency: normal',
            'Authorization: vapid t=' . $token . ', k=' . PUSH_PUBLIC_KEY,
            'Content-Length: 0',
        ];
        if (function_exists('curl_init')) {
            $ch = curl_init($endpoint);
            curl_setopt_array($ch, [
                CURLOPT_POST => true,
                CURLOPT_HTTPHEADER => $headers,
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_HEADER => true,
                CURLOPT_TIMEOUT => 8,
            ]);
            curl_exec($ch);
            $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            curl_close($ch);
        } else {
            $context = stream_context_create([
                'http' => [
                    'method' => 'POST',
                    'header' => implode("\r\n", $headers) . "\r\n",
                    'content' => '',
                    'ignore_errors' => true,
                    'timeout' => 8,
                ],
            ]);
            @file_get_contents($endpoint, false, $context);
            $statusLine = $http_response_header[0] ?? '';
            $code = preg_match('~\s(\d{3})\s~', $statusLine, $m) ? (int)$m[1] : 0;
        }
        if (in_array($code, [404, 410], true) && !empty($subscription['id'])) {
            db()->prepare('DELETE FROM push_subscriptions WHERE id = ?')->execute([(int)$subscription['id']]);
        }
        return $code >= 200 && $code < 300;
    } catch (Throwable $e) {
        error_log('Push send failed: ' . $e->getMessage());
        return false;
    }
}

function push_send_rows(array $rows): void
{
    foreach ($rows as $row) {
        push_send_subscription($row);
    }
}

function push_notify_user(int $userId, ?int $excludeUserId = null): void
{
    if ($userId <= 0 || ($excludeUserId !== null && $userId === $excludeUserId)) {
        return;
    }
    $stmt = db()->prepare('SELECT * FROM push_subscriptions WHERE user_id = ? ORDER BY updated_at DESC, created_at DESC');
    $stmt->execute([$userId]);
    push_send_rows($stmt->fetchAll());
}

function push_notify_employee(int $employeeId, ?int $excludeUserId = null): void
{
    if ($employeeId <= 0) {
        return;
    }
    $stmt = db()->prepare('SELECT ps.* FROM push_subscriptions ps JOIN users u ON u.id = ps.user_id WHERE u.employee_id = ? ORDER BY ps.updated_at DESC, ps.created_at DESC');
    $stmt->execute([$employeeId]);
    $rows = array_filter($stmt->fetchAll(), static fn(array $row): bool => $excludeUserId === null || (int)$row['user_id'] !== $excludeUserId);
    push_send_rows($rows);
}

function push_notify_admins(?int $excludeUserId = null): void
{
    $stmt = db()->prepare("SELECT ps.* FROM push_subscriptions ps JOIN users u ON u.id = ps.user_id WHERE u.role IN ('admin','coordinator') ORDER BY ps.updated_at DESC, ps.created_at DESC");
    $stmt->execute();
    $rows = array_filter($stmt->fetchAll(), static fn(array $row): bool => $excludeUserId === null || (int)$row['user_id'] !== $excludeUserId);
    push_send_rows($rows);
}
