<?php
declare(strict_types=1);

$method = request_method();
$parts = explode('/', request_path());
$id = isset($parts[1]) ? (int)$parts[1] : null;

if ($method === 'GET') {
    $user = require_permission('cash.view');
    $companyId = has_global_scope($user) ? (int)($_GET['company_id'] ?? 0) : 0;
    $where = $companyId > 0 ? 'WHERE c.deleted_at IS NULL AND o.company_id = ?' : 'WHERE c.deleted_at IS NULL';
    $stmt = db()->prepare("SELECT c.*, o.name AS object_name, u.name AS user_name FROM cash_register c LEFT JOIN objects o ON o.id = c.object_id LEFT JOIN users u ON u.id = c.created_by $where ORDER BY c.date DESC, c.id DESC LIMIT 300");
    $stmt->execute($companyId > 0 ? [$companyId] : []);
    json_response(['ok' => true, 'data' => $stmt->fetchAll()]);
}

if ($method === 'POST') {
    $user = require_permission('cash.write');
    $data = read_json();
    require_fields($data, ['type', 'amount', 'description', 'date']);
    $type = $data['type'] === 'expense' ? 'expense' : 'income';
    $stmt = db()->prepare('INSERT INTO cash_register (type,amount,description,date,object_id,created_by) VALUES (?,?,?,?,?,?)');
    $stmt->execute([$type, money_value($data, 'amount'), first_string($data, 'description', 2000), $data['date'], int_or_null($data, 'object_id'), (int)$user['id']]);
    $newId = (int)db()->lastInsertId();
    audit_log($user, 'CREATE', 'cash', $newId, $data);
    json_response(['ok' => true, 'id' => $newId], 201);
}

if ($method === 'PUT' && $id) {
    $user = require_permission('cash.write');
    $data = read_json();
    $oldStmt = db()->prepare('SELECT * FROM cash_register WHERE id = ? LIMIT 1');
    $oldStmt->execute([$id]);
    $old = $oldStmt->fetch();
    $type = $data['type'] === 'expense' ? 'expense' : 'income';
    $stmt = db()->prepare('UPDATE cash_register SET type=?, amount=?, description=?, date=?, object_id=? WHERE id=?');
    $stmt->execute([$type, money_value($data, 'amount'), first_string($data, 'description', 2000), $data['date'], int_or_null($data, 'object_id'), $id]);
    audit_log($user, 'UPDATE', 'cash', $id, $data, $old ?: null);
    json_response(['ok' => true]);
}

if ($method === 'DELETE' && $id) {
    $user = require_permission('cash.write');
    $stmt = db()->prepare('SELECT * FROM cash_register WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $old = $stmt->fetch();
    if (!$old) {
        json_response(['ok' => false, 'error' => 'Cash operation not found'], 404);
    }
    db()->prepare('UPDATE cash_register SET deleted_at = NOW(), deleted_by = ? WHERE id = ?')->execute([(int)$user['id'], $id]);
    audit_log($user, 'SOFT_DELETE', 'cash', $id, ['deleted' => true], $old);
    json_response(['ok' => true]);
}

json_response(['ok' => false, 'error' => 'Cash route not found'], 404);
