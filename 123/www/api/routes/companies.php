<?php
declare(strict_types=1);

$method = request_method();
$parts = explode('/', request_path());
$id = isset($parts[1]) ? (int)$parts[1] : null;

function sync_company_objects(int $companyId, array $data): void
{
    if (!array_key_exists('object_ids', $data) || !is_array($data['object_ids'])) {
        return;
    }
    $objectIds = [];
    foreach ($data['object_ids'] as $rawId) {
        $objectId = (int)$rawId;
        if ($objectId > 0) {
            $objectIds[$objectId] = $objectId;
        }
    }

    db()->prepare('UPDATE objects SET company_id = NULL WHERE company_id = ?')->execute([$companyId]);
    if (!$objectIds) {
        return;
    }
    $placeholders = implode(',', array_fill(0, count($objectIds), '?'));
    $params = array_merge([$companyId], array_values($objectIds));
    db()->prepare("UPDATE objects SET company_id = ? WHERE id IN ($placeholders)")->execute($params);
}

if ($method === 'GET') {
    $user = require_permission('companies.view');
    if (has_global_scope($user)) {
        $rows = db()->query('SELECT c.*, (SELECT COUNT(*) FROM employees e WHERE e.company_id = c.id AND e.status = "active") AS employees_count, (SELECT COUNT(*) FROM objects o WHERE o.company_id = c.id AND o.status = "active") AS objects_count, (SELECT GROUP_CONCAT(o.name ORDER BY o.name SEPARATOR ", ") FROM objects o WHERE o.company_id = c.id AND o.status = "active") AS object_names FROM companies c ORDER BY c.name')->fetchAll();
    } else {
        $stmt = db()->prepare('SELECT c.*, 1 AS employees_count, (SELECT COUNT(*) FROM objects o WHERE o.company_id = c.id AND o.status = "active") AS objects_count, (SELECT GROUP_CONCAT(o.name ORDER BY o.name SEPARATOR ", ") FROM objects o WHERE o.company_id = c.id AND o.status = "active") AS object_names FROM employees e JOIN companies c ON c.id = e.company_id WHERE e.id = ? ORDER BY c.name');
        $stmt->execute([(int)($user['employee_id'] ?? 0)]);
        $rows = $stmt->fetchAll();
    }
    json_response(['ok' => true, 'data' => $rows]);
}

if ($method === 'POST') {
    $user = require_permission('companies.write');
    $data = read_json();
    require_fields($data, ['name']);
    $stmt = db()->prepare('INSERT INTO companies (name,ico,dic,address,contact_person,phone,email,notes) VALUES (?,?,?,?,?,?,?,?)');
    $stmt->execute([
        first_string($data, 'name'),
        nullable_string($data, 'ico', 80),
        nullable_string($data, 'dic', 80),
        nullable_string($data, 'address'),
        nullable_string($data, 'contact_person', 255),
        nullable_string($data, 'phone', 80),
        nullable_string($data, 'email', 255),
        nullable_string($data, 'notes'),
    ]);
    $newId = (int)db()->lastInsertId();
    sync_company_objects($newId, $data);
    audit_log($user, 'CREATE', 'companies', $newId, $data);
    json_response(['ok' => true, 'id' => $newId], 201);
}

if ($method === 'PUT' && $id) {
    $user = require_permission('companies.write');
    $data = read_json();
    require_fields($data, ['name']);
    $stmt = db()->prepare('UPDATE companies SET name=?, ico=?, dic=?, address=?, contact_person=?, phone=?, email=?, notes=? WHERE id=?');
    $stmt->execute([
        first_string($data, 'name'),
        nullable_string($data, 'ico', 80),
        nullable_string($data, 'dic', 80),
        nullable_string($data, 'address'),
        nullable_string($data, 'contact_person', 255),
        nullable_string($data, 'phone', 80),
        nullable_string($data, 'email', 255),
        nullable_string($data, 'notes'),
        $id,
    ]);
    sync_company_objects($id, $data);
    audit_log($user, 'UPDATE', 'companies', $id, $data);
    json_response(['ok' => true]);
}

if ($method === 'DELETE' && $id) {
    $user = require_permission('companies.write');
    db()->prepare('UPDATE employees SET company_id = NULL WHERE company_id = ?')->execute([$id]);
    db()->prepare('UPDATE objects SET company_id = NULL WHERE company_id = ?')->execute([$id]);
    db()->prepare('DELETE FROM companies WHERE id = ?')->execute([$id]);
    audit_log($user, 'DELETE', 'companies', $id);
    json_response(['ok' => true]);
}

json_response(['ok' => false, 'error' => 'Companies route not found'], 404);
