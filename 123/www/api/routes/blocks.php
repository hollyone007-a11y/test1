<?php
declare(strict_types=1);

$method = request_method();
$parts = explode('/', request_path());
$id = isset($parts[1]) ? (int)$parts[1] : null;
$sub = $parts[2] ?? '';

if ($method === 'GET') {
    require_permission('permissions.write');
    $rows = db()->query('SELECT * FROM permission_blocks ORDER BY name')->fetchAll();
    foreach ($rows as &$row) {
        $decoded = json_decode((string)($row['permissions'] ?? '[]'), true);
        $row['permissions'] = is_array($decoded) ? $decoded : [];
    }
    json_response(['ok' => true, 'data' => $rows, 'permissions' => permission_labels()]);
}

if ($method === 'POST') {
    $user = require_permission('permissions.write');
    $data = read_json();
    require_fields($data, ['name']);
    $permissions = [];
    foreach (permission_labels() as $key => $_) {
        if (!empty($data[$key])) {
            $permissions[] = $key;
        }
    }
    $stmt = db()->prepare('INSERT INTO permission_blocks (name,description,permissions) VALUES (?,?,?)');
    $stmt->execute([first_string($data, 'name'), nullable_string($data, 'description'), json_encode($permissions, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
    $newId = (int)db()->lastInsertId();
    audit_log($user, 'CREATE', 'permission_blocks', $newId, ['name' => $data['name'], 'permissions' => $permissions]);
    json_response(['ok' => true, 'id' => $newId], 201);
}

if ($method === 'PUT' && $id && $sub === 'apply') {
    $user = require_permission('permissions.write');
    $data = read_json();
    require_fields($data, ['user_id']);
    $stmt = db()->prepare('SELECT permissions FROM permission_blocks WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $block = $stmt->fetchColumn();
    if (!$block) {
        json_response(['ok' => false, 'error' => 'Block not found'], 404);
    }
    $enabled = json_decode((string)$block, true);
    if (!is_array($enabled)) {
        $enabled = [];
    }
    $save = db()->prepare('INSERT INTO user_permissions (user_id,permission_key,allowed) VALUES (?,?,?) ON DUPLICATE KEY UPDATE allowed = VALUES(allowed)');
    foreach (permission_labels() as $key => $_) {
        $save->execute([(int)$data['user_id'], $key, in_array($key, $enabled, true) ? 1 : 0]);
    }
    audit_log($user, 'APPLY_BLOCK', 'permission_blocks', $id, ['user_id' => (int)$data['user_id']]);
    json_response(['ok' => true]);
}

if ($method === 'PUT' && $id) {
    $user = require_permission('permissions.write');
    $data = read_json();
    require_fields($data, ['name']);
    $permissions = [];
    foreach (permission_labels() as $key => $_) {
        if (!empty($data[$key])) {
            $permissions[] = $key;
        }
    }
    $stmt = db()->prepare('UPDATE permission_blocks SET name=?, description=?, permissions=? WHERE id=?');
    $stmt->execute([first_string($data, 'name'), nullable_string($data, 'description'), json_encode($permissions, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $id]);
    audit_log($user, 'UPDATE', 'permission_blocks', $id, ['name' => $data['name'], 'permissions' => $permissions]);
    json_response(['ok' => true]);
}

if ($method === 'DELETE' && $id) {
    $user = require_permission('permissions.write');
    db()->prepare('DELETE FROM permission_blocks WHERE id = ?')->execute([$id]);
    audit_log($user, 'DELETE', 'permission_blocks', $id);
    json_response(['ok' => true]);
}

json_response(['ok' => false, 'error' => 'Blocks route not found'], 404);
