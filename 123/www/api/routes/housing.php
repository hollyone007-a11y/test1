<?php
declare(strict_types=1);

$method = request_method();
$parts = explode('/', request_path());
$id = isset($parts[1]) ? (int)$parts[1] : null;

if ($method === 'GET') {
    $user = require_permission('salary.view');
    $month = (int)($_GET['month'] ?? date('n'));
    $year = (int)($_GET['year'] ?? date('Y'));
    [$scopeSql, $scopeParams] = current_employee_filter($user, 'e');
    $stmt = db()->prepare("SELECT h.*, e.name AS employee_name FROM housing h JOIN employees e ON e.id = h.employee_id WHERE h.month = ? AND h.year = ? $scopeSql ORDER BY e.name");
    $stmt->execute(array_merge([$month, $year], $scopeParams));
    json_response(['ok' => true, 'data' => $stmt->fetchAll()]);
}

if ($method === 'POST') {
    $user = require_permission('employees.write');
    if (!has_global_scope($user)) {
        json_response(['ok' => false, 'error' => 'Permission denied'], 403);
    }
    $data = read_json();
    require_fields($data, ['employee_id', 'month', 'year']);
    $stmt = db()->prepare('INSERT INTO housing (employee_id,month,year,amount) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE amount=VALUES(amount)');
    $stmt->execute([(int)$data['employee_id'], (int)$data['month'], (int)$data['year'], money_value($data, 'amount')]);
    audit_log($user, 'UPSERT', 'housing', null, $data);
    json_response(['ok' => true]);
}

if ($method === 'DELETE' && $id) {
    $user = require_permission('employees.write');
    if (!has_global_scope($user)) {
        json_response(['ok' => false, 'error' => 'Permission denied'], 403);
    }
    db()->prepare('DELETE FROM housing WHERE id = ?')->execute([$id]);
    audit_log($user, 'DELETE', 'housing', $id);
    json_response(['ok' => true]);
}

json_response(['ok' => false, 'error' => 'Housing route not found'], 404);
