<?php
declare(strict_types=1);

$method = request_method();
$parts = explode('/', request_path());
$id = isset($parts[1]) ? (int)$parts[1] : null;
$sub = $parts[2] ?? '';

function chat_body(): array
{
    if (isset($GLOBALS['chat_request_body']) && is_array($GLOBALS['chat_request_body'])) {
        return $GLOBALS['chat_request_body'];
    }
    if (!empty($_POST) || !empty($_FILES)) {
        $GLOBALS['chat_request_body'] = $_POST;
        return $GLOBALS['chat_request_body'];
    }
    $GLOBALS['chat_request_body'] = read_json();
    return $GLOBALS['chat_request_body'];
}

function chat_requested_employee_id(?array $body = null): ?int
{
    $value = $_GET['employee_id'] ?? ($body['employee_id'] ?? null);
    if ($value === null || $value === '') {
        return null;
    }
    return (int)$value;
}

function chat_channel_request(?array $body = null): string
{
    $value = $_GET['channel'] ?? ($body['channel'] ?? 'direct');
    return in_array($value, ['category', 'peer'], true) ? $value : 'direct';
}

function chat_employee_id_for_user(array $user, ?int $requestedId): int
{
    if (has_global_scope($user)) {
        if (!$requestedId) {
            json_response(['ok' => false, 'error' => 'employee_id is required'], 422);
        }
        return $requestedId;
    }

    $ownId = (int)($user['employee_id'] ?? 0);
    if (!$ownId) {
        json_response(['ok' => false, 'error' => 'Employee profile is not linked'], 403);
    }
    if ($requestedId && $requestedId !== $ownId) {
        json_response(['ok' => false, 'error' => 'Permission denied'], 403);
    }
    return $ownId;
}

function chat_employee(int $employeeId): array
{
    $stmt = db()->prepare('SELECT e.id, e.name, e.phone, e.email, e.warehouse_email, e.company_id, e.object_id, e.avatar_path,
                                  c.name AS company_name, o.name AS object_name, o.work_type AS object_work_type
                           FROM employees e
                           LEFT JOIN companies c ON c.id = e.company_id
                           LEFT JOIN objects o ON o.id = e.object_id
                           WHERE e.id = ? LIMIT 1');
    $stmt->execute([$employeeId]);
    $employee = $stmt->fetch();
    if (!$employee) {
        json_response(['ok' => false, 'error' => 'Employee not found'], 404);
    }
    return $employee;
}

function chat_category_for_employee(array $employee): array
{
    $text = strtolower(trim(implode(' ', [
        $employee['company_name'] ?? '',
        $employee['object_name'] ?? '',
        $employee['object_work_type'] ?? '',
        $employee['email'] ?? '',
        $employee['warehouse_email'] ?? '',
    ])));

    if (strpos($text, 'rohlik') !== false || strpos($text, 'roshpit') !== false || strpos($text, '@brno1.rohlik.cz') !== false) {
        return ['key' => 'category:rohlik-brno', 'label' => 'Rohlik Brno'];
    }
    if (strpos($text, 'stavba') !== false || strpos($text, 'fasada') !== false || strpos($text, 'fasáda') !== false) {
        return ['key' => 'category:stavba', 'label' => 'Stavba'];
    }
    if (!empty($employee['object_id'])) {
        return ['key' => 'object:' . (int)$employee['object_id'], 'label' => (string)($employee['object_name'] ?: 'Objekt')];
    }
    if (!empty($employee['company_id'])) {
        return ['key' => 'company:' . (int)$employee['company_id'], 'label' => (string)($employee['company_name'] ?: 'Firma')];
    }
    return ['key' => 'category:general', 'label' => 'Obecny chat'];
}

function chat_peers_for_employee(array $employee): array
{
    if (!empty($employee['object_id'])) {
        $stmt = db()->prepare('SELECT e.id, e.name, e.phone, e.email, e.avatar_path, c.name AS company_name, o.name AS object_name
                               FROM employees e
                               LEFT JOIN companies c ON c.id = e.company_id
                               LEFT JOIN objects o ON o.id = e.object_id
                               WHERE e.status = "active" AND e.object_id = ? AND e.id <> ?
                               ORDER BY e.name');
        $stmt->execute([(int)$employee['object_id'], (int)$employee['id']]);
        return $stmt->fetchAll();
    }
    if (!empty($employee['company_id'])) {
        $stmt = db()->prepare('SELECT e.id, e.name, e.phone, e.email, e.avatar_path, c.name AS company_name, o.name AS object_name
                               FROM employees e
                               LEFT JOIN companies c ON c.id = e.company_id
                               LEFT JOIN objects o ON o.id = e.object_id
                               WHERE e.status = "active" AND e.company_id = ? AND e.id <> ?
                               ORDER BY e.name');
        $stmt->execute([(int)$employee['company_id'], (int)$employee['id']]);
        return $stmt->fetchAll();
    }
    return [];
}

function chat_peer_channel(array $employee, int $peerId): array
{
    if ($peerId <= 0) {
        json_response(['ok' => false, 'error' => 'peer_employee_id is required'], 422);
    }
    $peer = null;
    foreach (chat_peers_for_employee($employee) as $row) {
        if ((int)$row['id'] === $peerId) {
            $peer = $row;
            break;
        }
    }
    if (!$peer) {
        json_response(['ok' => false, 'error' => 'Peer is not from the same object'], 403);
    }
    $ids = [(int)$employee['id'], (int)$peer['id']];
    sort($ids, SORT_NUMERIC);
    return [
        'key' => 'peer:' . $ids[0] . ':' . $ids[1],
        'label' => (string)($peer['name'] ?? 'Kolega'),
        'peer' => $peer,
    ];
}

function chat_public_message(array $row, array $user): array
{
    $senderRole = (string)($row['sender_role'] ?? 'worker');
    $row['id'] = (int)$row['id'];
    $row['employee_id'] = (int)$row['employee_id'];
    $row['sender_user_id'] = $row['sender_user_id'] === null ? null : (int)$row['sender_user_id'];
    $row['sender_employee_id'] = $row['sender_employee_id'] === null ? null : (int)$row['sender_employee_id'];
    $row['attachment_size'] = $row['attachment_size'] === null ? null : (int)$row['attachment_size'];
    $row['is_mine'] = $row['sender_user_id'] !== null && (int)$row['sender_user_id'] === (int)$user['id'];
    $row['sender_label'] = $senderRole === 'worker'
        ? ($row['sender_employee_name'] ?: 'Pracovnik')
        : ($row['sender_user_name'] ?: ($senderRole === 'coordinator' ? 'Koordinator' : 'Admin'));
    return $row;
}

function chat_messages_for(int $employeeId, array $user, ?string $channelKey = null): array
{
    $deletedSql = has_global_scope($user) ? ' AND m.deleted_by_admin_at IS NULL' : ' AND m.deleted_by_worker_at IS NULL';
    if ($channelKey) {
        $stmt = db()->prepare("SELECT m.*, u.name AS sender_user_name, se.name AS sender_employee_name
                               FROM employee_chat_messages m
                               LEFT JOIN users u ON u.id = m.sender_user_id
                               LEFT JOIN employees se ON se.id = m.sender_employee_id
                               WHERE m.channel_key = ?
                               $deletedSql
                               ORDER BY m.created_at ASC, m.id ASC
                               LIMIT 250");
        $stmt->execute([$channelKey]);
    } else {
        $stmt = db()->prepare("SELECT m.*, u.name AS sender_user_name, se.name AS sender_employee_name
                               FROM employee_chat_messages m
                               LEFT JOIN users u ON u.id = m.sender_user_id
                               LEFT JOIN employees se ON se.id = m.sender_employee_id
                               WHERE m.employee_id = ? AND (m.channel_key IS NULL OR m.channel_key = '')
                               $deletedSql
                               ORDER BY m.created_at ASC, m.id ASC
                               LIMIT 250");
        $stmt->execute([$employeeId]);
    }
    return array_map(static fn(array $row): array => chat_public_message($row, $user), $stmt->fetchAll());
}

function chat_safe_file_part(string $name): string
{
    $name = preg_replace('/[^A-Za-z0-9._-]+/', '-', $name);
    return trim((string)$name, '.-') ?: 'file';
}

function chat_upload_dir(int $employeeId): string
{
    $dir = dirname(__DIR__, 2) . '/uploads/chat/' . $employeeId;
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
    return $dir;
}

function chat_store_attachment(int $employeeId): ?array
{
    if (empty($_FILES['attachment']) || (int)($_FILES['attachment']['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
        return null;
    }
    if (!is_uploaded_file($_FILES['attachment']['tmp_name'])) {
        json_response(['ok' => false, 'error' => 'Upload failed'], 422);
    }
    if ((int)$_FILES['attachment']['size'] > 12 * 1024 * 1024) {
        json_response(['ok' => false, 'error' => 'File is too large'], 422);
    }
    $original = chat_safe_file_part((string)$_FILES['attachment']['name']);
    $ext = strtolower((string)pathinfo($original, PATHINFO_EXTENSION));
    $blocked = ['php', 'phtml', 'phar', 'php3', 'php4', 'php5', 'php7', 'php8', 'htaccess'];
    if ($ext && in_array($ext, $blocked, true)) {
        json_response(['ok' => false, 'error' => 'This file type is not allowed'], 422);
    }
    $storedName = date('Ymd-His') . '-' . bin2hex(random_bytes(4)) . ($ext ? '.' . chat_safe_file_part($ext) : '');
    $target = chat_upload_dir($employeeId) . '/' . $storedName;
    if (!move_uploaded_file($_FILES['attachment']['tmp_name'], $target)) {
        json_response(['ok' => false, 'error' => 'Upload failed'], 500);
    }
    return [
        'path' => 'uploads/chat/' . $employeeId . '/' . $storedName,
        'name' => $original,
        'mime' => $_FILES['attachment']['type'] ?? 'application/octet-stream',
        'size' => (int)$_FILES['attachment']['size'],
    ];
}

function chat_can_access_message(array $user, array $message): bool
{
    if (has_global_scope($user)) {
        return true;
    }
    $ownId = (int)($user['employee_id'] ?? 0);
    if (!$ownId) {
        return false;
    }
    if ((int)$message['employee_id'] === $ownId || (int)($message['sender_employee_id'] ?? 0) === $ownId) {
        return true;
    }
    $key = (string)($message['channel_key'] ?? '');
    if ($key === '') {
        return false;
    }
    if (strpos($key, 'peer:') === 0) {
        return in_array((string)$ownId, array_slice(explode(':', $key), 1), true);
    }
    $employee = chat_employee($ownId);
    $category = chat_category_for_employee($employee);
    if ($key === $category['key']) {
        return true;
    }
    if (strpos($key, 'object:') === 0 && !empty($employee['object_id'])) {
        return $key === 'object:' . (int)$employee['object_id'];
    }
    if (strpos($key, 'company:') === 0 && !empty($employee['company_id'])) {
        return $key === 'company:' . (int)$employee['company_id'];
    }
    return false;
}

function chat_stream_attachment(array $message): void
{
    $relative = (string)($message['attachment_path'] ?? '');
    if ($relative === '') {
        json_response(['ok' => false, 'error' => 'File not found'], 404);
    }
    $path = dirname(__DIR__, 2) . '/' . $relative;
    if (!is_file($path)) {
        json_response(['ok' => false, 'error' => 'File not found'], 404);
    }
    $fileName = chat_safe_file_part((string)($message['attachment_name'] ?? basename($path)));
    $mime = (string)($message['attachment_mime'] ?? 'application/octet-stream') ?: 'application/octet-stream';
    if (!preg_match('~^[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+$~', $mime)) {
        $mime = 'application/octet-stream';
    }
    header('Content-Type: ' . $mime);
    header('Content-Length: ' . (string)filesize($path));
    header('Content-Disposition: inline; filename="' . $fileName . '"');
    header('Cache-Control: private, max-age=0, must-revalidate');
    readfile($path);
    exit;
}

function chat_admin_conversations(array $user): array
{
    if (!has_global_scope($user)) {
        json_response(['ok' => false, 'error' => 'Permission denied'], 403);
    }
    [$filterSql, $filterParams] = current_employee_filter($user, 'e');
    $stmt = db()->prepare("SELECT m.*, e.name AS employee_name, e.avatar_path AS employee_avatar_path,
                                  e.company_id, e.object_id, c.name AS company_name, o.name AS object_name,
                                  u.name AS sender_user_name, se.name AS sender_employee_name
                           FROM employee_chat_messages m
                           JOIN employees e ON e.id = m.employee_id
                           LEFT JOIN companies c ON c.id = e.company_id
                           LEFT JOIN objects o ON o.id = e.object_id
                           LEFT JOIN users u ON u.id = m.sender_user_id
                           LEFT JOIN employees se ON se.id = m.sender_employee_id
                           WHERE m.deleted_by_admin_at IS NULL {$filterSql}
                           ORDER BY m.created_at DESC, m.id DESC
                           LIMIT 600");
    $stmt->execute($filterParams);
    $groups = [];
    foreach ($stmt->fetchAll() as $row) {
        $key = $row['channel_key'] ?: ('direct:' . (int)$row['employee_id']);
        if (!isset($groups[$key])) {
            $title = $row['channel_key'] ? ($row['channel_label'] ?: 'Skupina') : ($row['employee_name'] ?: 'Pracovnik');
            $subtitle = $row['channel_key']
                ? (($row['employee_name'] ?: 'Pracovnik') . ' / ' . ($row['object_name'] ?: $row['company_name'] ?: '-'))
                : (($row['company_name'] ?: '-') . ' / ' . ($row['object_name'] ?: '-'));
            $groups[$key] = [
                'key' => $key,
                'employee_id' => (int)$row['employee_id'],
                'employee_name' => $row['employee_name'],
                'employee_avatar_path' => $row['employee_avatar_path'],
                'company_name' => $row['company_name'],
                'object_name' => $row['object_name'],
                'channel_key' => $row['channel_key'],
                'channel_label' => $row['channel_label'],
                'title' => $title,
                'subtitle' => $subtitle,
                'last_message' => $row['message'],
                'last_at' => $row['created_at'],
                'sender_label' => $row['sender_role'] === 'worker' ? ($row['sender_employee_name'] ?: 'Pracovnik') : ($row['sender_user_name'] ?: 'Admin'),
                'unread' => 0,
            ];
        }
        if ((int)$row['is_read_by_admin'] === 0) {
            $groups[$key]['unread']++;
        }
    }
    $employeeStmt = db()->prepare("SELECT e.id, e.name AS employee_name, e.avatar_path AS employee_avatar_path,
                                          e.company_id, e.object_id, c.name AS company_name, o.name AS object_name
                                   FROM employees e
                                   LEFT JOIN companies c ON c.id = e.company_id
                                   LEFT JOIN objects o ON o.id = e.object_id
                                   WHERE e.status = 'active' {$filterSql}
                                   ORDER BY e.name");
    $employeeStmt->execute($filterParams);
    foreach ($employeeStmt->fetchAll() as $employee) {
        $key = 'direct:' . (int)$employee['id'];
        if (isset($groups[$key])) {
            continue;
        }
        $groups[$key] = [
            'key' => $key,
            'employee_id' => (int)$employee['id'],
            'employee_name' => $employee['employee_name'],
            'employee_avatar_path' => $employee['employee_avatar_path'],
            'company_name' => $employee['company_name'],
            'object_name' => $employee['object_name'],
            'channel_key' => null,
            'channel_label' => null,
            'title' => $employee['employee_name'] ?: 'Pracovnik',
            'subtitle' => (($employee['company_name'] ?: '-') . ' / ' . ($employee['object_name'] ?: '-')),
            'last_message' => '',
            'last_at' => null,
            'sender_label' => '',
            'unread' => 0,
        ];
    }
    return array_values($groups);
}

if ($method === 'GET' && $id && $sub === 'download') {
    $user = require_permission('chat.view');
    $stmt = db()->prepare('SELECT * FROM employee_chat_messages WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $message = $stmt->fetch();
    if (!$message) {
        json_response(['ok' => false, 'error' => 'Message not found'], 404);
    }
    if (!chat_can_access_message($user, $message)) {
        json_response(['ok' => false, 'error' => 'Permission denied'], 403);
    }
    chat_stream_attachment($message);
}

if ($method === 'DELETE' && ($parts[1] ?? '') === 'clear') {
    $user = require_permission('chat.write');
    $body = chat_body();
    $employeeId = chat_employee_id_for_user($user, chat_requested_employee_id($body));
    require_employee_access($user, $employeeId);
    $employee = chat_employee($employeeId);

    $channelKey = null;
    $channelLabel = null;
    if (has_global_scope($user) && !empty($body['channel_key'])) {
        $channelKey = substr(trim((string)$body['channel_key']), 0, 80);
        $channelLabel = substr(trim((string)($body['channel_label'] ?? 'Skupina')), 0, 120);
    } else {
        $channel = chat_channel_request($body);
        if ($channel === 'category') {
            $info = chat_category_for_employee($employee);
            $channelKey = $info['key'];
            $channelLabel = $info['label'];
        } elseif ($channel === 'peer') {
            $info = chat_peer_channel($employee, (int)($body['peer_employee_id'] ?? 0));
            $channelKey = $info['key'];
            $channelLabel = $info['label'];
        }
    }

    if ($channelKey) {
        $stmt = db()->prepare('UPDATE employee_chat_messages SET deleted_by_admin_at = NOW(), deleted_by_worker_at = NOW() WHERE channel_key = ?');
        $stmt->execute([$channelKey]);
    } else {
        $stmt = db()->prepare("UPDATE employee_chat_messages SET deleted_by_admin_at = NOW(), deleted_by_worker_at = NOW() WHERE employee_id = ? AND (channel_key IS NULL OR channel_key = '')");
        $stmt->execute([$employeeId]);
    }
    audit_log($user, 'CHAT_CLEAR', 'employee_chat_messages', $employeeId, [
        'channel' => $channelKey ?: 'direct',
        'label' => $channelLabel,
        'scope' => 'all_participants',
    ]);
    json_response(['ok' => true]);
}

if ($method === 'GET') {
    $user = require_permission('chat.view');
    if (!empty($_GET['all'])) {
        json_response(['ok' => true, 'data' => chat_admin_conversations($user)]);
    }

    $employeeId = chat_employee_id_for_user($user, chat_requested_employee_id());
    require_employee_access($user, $employeeId);
    $employee = chat_employee($employeeId);
    if (!empty($_GET['peers'])) {
        json_response([
            'ok' => true,
            'employee' => $employee,
            'data' => chat_peers_for_employee($employee),
        ]);
    }

    $channelInfo = null;
    $channelKey = null;
    if (has_global_scope($user) && !empty($_GET['channel_key'])) {
        $channelKey = substr(trim((string)$_GET['channel_key']), 0, 80);
        $channelInfo = [
            'key' => $channelKey,
            'label' => substr(trim((string)($_GET['channel_label'] ?? 'Skupina')), 0, 120),
        ];
    } else {
        $channel = chat_channel_request();
        if ($channel === 'category') {
            $channelInfo = chat_category_for_employee($employee);
        } elseif ($channel === 'peer') {
            $channelInfo = chat_peer_channel($employee, (int)($_GET['peer_employee_id'] ?? 0));
        }
        $channelKey = $channelInfo['key'] ?? null;
    }

    if (has_global_scope($user)) {
        $sql = $channelKey
            ? 'UPDATE employee_chat_messages SET is_read_by_admin = 1 WHERE channel_key = ?'
            : "UPDATE employee_chat_messages SET is_read_by_admin = 1 WHERE employee_id = ? AND (channel_key IS NULL OR channel_key = '')";
    } else {
        $sql = $channelKey
            ? 'UPDATE employee_chat_messages SET is_read_by_worker = 1 WHERE channel_key = ?'
            : "UPDATE employee_chat_messages SET is_read_by_worker = 1 WHERE employee_id = ? AND (channel_key IS NULL OR channel_key = '')";
    }
    db()->prepare($sql)->execute([$channelKey ?: $employeeId]);

    json_response([
        'ok' => true,
        'employee' => $employee,
        'channel' => $channelInfo ?: ['key' => null, 'label' => 'Kancelar'],
        'data' => chat_messages_for($employeeId, $user, $channelKey),
    ]);
}

if ($method === 'POST') {
    $user = require_permission('chat.write');
    $body = chat_body();
    $employeeId = chat_employee_id_for_user($user, chat_requested_employee_id($body));
    require_employee_access($user, $employeeId);
    $employee = chat_employee($employeeId);

    $channelInfo = null;
    if (has_global_scope($user) && !empty($body['channel_key'])) {
        $channelInfo = [
            'key' => substr(trim((string)$body['channel_key']), 0, 80),
            'label' => substr(trim((string)($body['channel_label'] ?? 'Skupina')), 0, 120),
        ];
    } else {
        $channel = chat_channel_request($body);
        if ($channel === 'category') {
            $channelInfo = chat_category_for_employee($employee);
        } elseif ($channel === 'peer') {
            $channelInfo = chat_peer_channel($employee, (int)($body['peer_employee_id'] ?? 0));
        }
    }

    $attachment = chat_store_attachment($employeeId);
    $message = trim((string)($body['message'] ?? ''));
    if ($message === '' && $attachment) {
        $message = 'Priloha: ' . $attachment['name'];
    }
    if ($message === '') {
        json_response(['ok' => false, 'error' => 'Message is required'], 422);
    }
    if (strlen($message) > 4000) {
        json_response(['ok' => false, 'error' => 'Message is too long'], 422);
    }

    $isWorker = !has_global_scope($user);
    $senderRole = $isWorker ? 'worker' : (($user['role'] ?? '') === 'coordinator' ? 'coordinator' : 'admin');
    $stmt = db()->prepare('INSERT INTO employee_chat_messages
      (employee_id, channel_key, channel_label, sender_user_id, sender_employee_id, sender_role, message, attachment_path, attachment_name, attachment_mime, attachment_size, is_read_by_worker, is_read_by_admin)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $stmt->execute([
        $employeeId,
        $channelInfo['key'] ?? null,
        $channelInfo['label'] ?? null,
        (int)$user['id'],
        $user['employee_id'] === null ? null : (int)$user['employee_id'],
        $senderRole,
        $message,
        $attachment['path'] ?? null,
        $attachment['name'] ?? null,
        $attachment['mime'] ?? null,
        $attachment['size'] ?? null,
        $isWorker ? 1 : 0,
        $isWorker ? 0 : 1,
    ]);
    $newId = (int)db()->lastInsertId();
    audit_log($user, 'CHAT_MESSAGE', 'employee_chat_messages', $newId, [
        'employee_id' => $employeeId,
        'channel' => $channelInfo['key'] ?? 'direct',
        'attachment' => $attachment['name'] ?? null,
    ]);
    if ($isWorker) {
        if (!empty($channelInfo['peer']['id'])) {
            push_notify_employee((int)$channelInfo['peer']['id'], (int)$user['id']);
        } else {
            push_notify_admins((int)$user['id']);
        }
    } else {
        push_notify_employee($employeeId, (int)$user['id']);
    }

    json_response([
        'ok' => true,
        'id' => $newId,
        'channel' => $channelInfo ?: ['key' => null, 'label' => 'Kancelar'],
        'data' => chat_messages_for($employeeId, $user, $channelInfo['key'] ?? null),
    ], 201);
}

json_response(['ok' => false, 'error' => 'Method not allowed'], 405);
