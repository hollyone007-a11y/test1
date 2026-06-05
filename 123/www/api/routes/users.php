<?php
declare(strict_types=1);

$method = request_method();
$parts = explode('/', request_path());
$id = isset($parts[1]) ? (int)$parts[1] : null;
$sub = $parts[2] ?? '';

function user_role_from_payload(array $data): string
{
    $role = (string)($data['role'] ?? 'user');
    return in_array($role, ['admin', 'coordinator', 'accountant', 'user'], true) ? $role : 'user';
}

if ($method === 'GET') {
    require_permission('users.view');
    $rows = db()->query('SELECT u.id,u.email,u.name,u.role,u.employee_id,u.last_login_at,u.created_at,e.name AS employee_name FROM users u LEFT JOIN employees e ON e.id = u.employee_id ORDER BY u.role, u.name')->fetchAll();
    foreach ($rows as &$row) {
        $row['permissions'] = permissions_for_user($row);
    }
    json_response(['ok' => true, 'data' => $rows, 'permissions' => permission_labels()]);
}

if ($method === 'POST') {
    $user = require_permission('users.write');
    $data = read_json();
    require_fields($data, ['email', 'name', 'password']);
    if (strlen((string)$data['password']) < 8) {
        json_response(['ok' => false, 'error' => 'Password must have at least 8 characters'], 422);
    }
    $role = user_role_from_payload($data);
    $email = normalize_email(first_string($data, 'email'));
    $stmt = db()->prepare('INSERT INTO users (email,password_hash,role,employee_id,name) VALUES (?,?,?,?,?)');
    $stmt->execute([
        $email,
        password_hash((string)$data['password'], PASSWORD_DEFAULT),
        $role,
        int_or_null($data, 'employee_id'),
        first_string($data, 'name'),
    ]);
    $newId = (int)db()->lastInsertId();
    if ($role !== 'admin') {
        assign_default_permissions($newId, $role);
    }
    audit_log($user, 'CREATE', 'users', $newId, ['email' => $data['email'], 'role' => $role]);
    json_response(['ok' => true, 'id' => $newId], 201);
}

if ($method === 'PUT' && $id && $sub === 'permissions') {
    $user = require_permission('permissions.write');
    $data = read_json();
    $stmt = db()->prepare('INSERT INTO user_permissions (user_id,permission_key,allowed) VALUES (?,?,?) ON DUPLICATE KEY UPDATE allowed = VALUES(allowed)');
    $labels = permission_labels();
    foreach ($labels as $key => $_) {
        $stmt->execute([$id, $key, !empty($data[$key]) ? 1 : 0]);
    }
    audit_log($user, 'UPDATE_PERMISSIONS', 'users', $id, $data);
    json_response(['ok' => true]);
}

if ($method === 'PUT' && $id) {
    $user = require_permission('users.write');
    $data = read_json();
    require_fields($data, ['email', 'name']);
    $role = user_role_from_payload($data);
    $fields = [
        normalize_email(first_string($data, 'email')),
        $role,
        int_or_null($data, 'employee_id'),
        first_string($data, 'name'),
        $id,
    ];
    db()->prepare('UPDATE users SET email=?, role=?, employee_id=?, name=? WHERE id=?')->execute($fields);
    if ($role !== 'admin') {
        assign_default_permissions($id, $role);
    }
    if (!empty($data['password'])) {
        if (strlen((string)$data['password']) < 8) {
            json_response(['ok' => false, 'error' => 'Password must have at least 8 characters'], 422);
        }
        db()->prepare('UPDATE users SET password_hash=? WHERE id=?')->execute([password_hash((string)$data['password'], PASSWORD_DEFAULT), $id]);
    }
    audit_log($user, 'UPDATE', 'users', $id, ['email' => $data['email'], 'role' => $role]);
    json_response(['ok' => true]);
}

if ($method === 'DELETE' && $id) {
    $user = require_permission('users.write');
    if ((int)$user['id'] === $id) {
        json_response(['ok' => false, 'error' => 'You cannot delete your own account'], 422);
    }
    db()->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);
    audit_log($user, 'DELETE', 'users', $id);
    json_response(['ok' => true]);
}

json_response(['ok' => false, 'error' => 'Users route not found'], 404);
