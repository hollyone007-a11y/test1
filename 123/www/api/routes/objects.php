<?php
declare(strict_types=1);

$method = request_method();
$parts = explode('/', request_path());
$id = isset($parts[1]) ? (int)$parts[1] : null;

if ($method === 'GET') {
    $user = require_permission('objects.view');
    if (has_global_scope($user)) {
        $companyId = (int)($_GET['company_id'] ?? 0);
        $where = $companyId > 0 ? 'WHERE o.company_id = ?' : '';
        $stmt = db()->prepare("SELECT o.*, c.name AS company_name, (SELECT COUNT(*) FROM employees e WHERE e.object_id = o.id AND e.status = \"active\") AS employees_count FROM objects o LEFT JOIN companies c ON c.id = o.company_id $where ORDER BY o.status, o.name");
        $stmt->execute($companyId > 0 ? [$companyId] : []);
        $rows = $stmt->fetchAll();
    } else {
        $stmt = db()->prepare('SELECT o.*, c.name AS company_name, 1 AS employees_count FROM employees e JOIN objects o ON o.id = e.object_id LEFT JOIN companies c ON c.id = o.company_id WHERE e.id = ? ORDER BY o.name');
        $stmt->execute([(int)($user['employee_id'] ?? 0)]);
        $rows = $stmt->fetchAll();
    }
    json_response(['ok' => true, 'data' => $rows]);
}

if ($method === 'POST') {
    $user = require_permission('objects.write');
    if (!has_global_scope($user)) {
        json_response(['ok' => false, 'error' => 'Permission denied'], 403);
    }
    $data = read_json();
    require_fields($data, ['name']);
    $workType = in_array(($data['work_type'] ?? 'general'), ['general', 'stavba', 'rohlik_brno', 'rohlik_ostrava'], true) ? $data['work_type'] : 'general';
    $stmt = db()->prepare('INSERT INTO objects (company_id,name,address,work_type,status,notes) VALUES (?,?,?,?,?,?)');
    $stmt->execute([
        int_or_null($data, 'company_id'),
        first_string($data, 'name'),
        nullable_string($data, 'address'),
        $workType,
        in_array(($data['status'] ?? 'active'), ['active', 'archived'], true) ? $data['status'] : 'active',
        nullable_string($data, 'notes'),
    ]);
    $newId = (int)db()->lastInsertId();
    audit_log($user, 'CREATE', 'objects', $newId, $data);
    json_response(['ok' => true, 'id' => $newId], 201);
}

if ($method === 'PUT' && $id) {
    $user = require_permission('objects.write');
    if (!has_global_scope($user)) {
        json_response(['ok' => false, 'error' => 'Permission denied'], 403);
    }
    $data = read_json();
    require_fields($data, ['name']);
    $workType = in_array(($data['work_type'] ?? 'general'), ['general', 'stavba', 'rohlik_brno', 'rohlik_ostrava'], true) ? $data['work_type'] : 'general';
    $stmt = db()->prepare('UPDATE objects SET company_id = ?, name = ?, address = ?, work_type = ?, status = ?, notes = ? WHERE id = ?');
    $stmt->execute([
        int_or_null($data, 'company_id'),
        first_string($data, 'name'),
        nullable_string($data, 'address'),
        $workType,
        in_array(($data['status'] ?? 'active'), ['active', 'archived'], true) ? $data['status'] : 'active',
        nullable_string($data, 'notes'),
        $id,
    ]);
    audit_log($user, 'UPDATE', 'objects', $id, $data);
    json_response(['ok' => true]);
}

if ($method === 'DELETE' && $id) {
    $user = require_permission('objects.write');
    if (!has_global_scope($user)) {
        json_response(['ok' => false, 'error' => 'Permission denied'], 403);
    }
    $stmt = db()->prepare('DELETE FROM objects WHERE id = ?');
    $stmt->execute([$id]);
    audit_log($user, 'DELETE', 'objects', $id);
    json_response(['ok' => true]);
}

json_response(['ok' => false, 'error' => 'Objects route not found'], 404);
