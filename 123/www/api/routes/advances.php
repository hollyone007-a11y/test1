<?php
declare(strict_types=1);

$method = request_method();
$parts = explode('/', request_path());
$id = isset($parts[1]) && ctype_digit((string)$parts[1]) ? (int)$parts[1] : null;
$sub = $parts[2] ?? '';

if ($method === 'GET') {
    $user = require_permission('advances.view');
    $month = (int)($_GET['month'] ?? date('n'));
    $year = (int)($_GET['year'] ?? date('Y'));
    [$scopeSql, $scopeParams] = current_employee_filter($user, 'e');
    $where = [];
    $params = [];
    $where[] = 'a.deleted_at IS NULL';
    if (empty($_GET['all'])) {
        $where[] = 'a.month = ? AND a.year = ?';
        $params[] = $month;
        $params[] = $year;
    }
    if (has_global_scope($user) && (int)($_GET['employee_id'] ?? 0) > 0) {
        $where[] = 'a.employee_id = ?';
        $params[] = (int)$_GET['employee_id'];
    }
    $whereSql = $where ? 'WHERE ' . implode(' AND ', $where) : 'WHERE 1=1';
    $stmt = db()->prepare("SELECT a.*, e.name AS employee_name, u.name AS created_by_name, au.name AS approved_by_name FROM advances a JOIN employees e ON e.id = a.employee_id LEFT JOIN users u ON u.id = a.created_by LEFT JOIN users au ON au.id = a.approved_by $whereSql $scopeSql ORDER BY FIELD(a.status, 'pending','approved','rejected'), a.date DESC, a.id DESC");
    $stmt->execute(array_merge($params, $scopeParams));
    json_response(['ok' => true, 'data' => $stmt->fetchAll()]);
}

if ($method === 'POST') {
    $user = require_permission('advances.write');
    $data = read_json();
    require_fields($data, ['amount', 'date']);
    $employeeId = has_global_scope($user) ? (int)($data['employee_id'] ?? 0) : (int)($user['employee_id'] ?? 0);
    if (!$employeeId) {
        json_response(['ok' => false, 'error' => 'Employee is required'], 422);
    }
    require_employee_access($user, $employeeId);
    $date = (string)$data['date'];
    $month = (int)($data['month'] ?? (int)date('n', strtotime($date)));
    $year = (int)($data['year'] ?? (int)date('Y', strtotime($date)));
    $status = has_global_scope($user) ? 'approved' : 'pending';
    $stmt = db()->prepare('INSERT INTO advances (employee_id,amount,date,month,year,note,created_by,status,approved_by,approved_at,paid_at,rejection_note) VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)');
    $stmt->execute([
        $employeeId,
        money_value($data, 'amount'),
        $date,
        $month,
        $year,
        nullable_string($data, 'note'),
        (int)$user['id'],
        $status,
        $status === 'approved' ? (int)$user['id'] : null,
        $status === 'approved' ? date('Y-m-d H:i:s') : null,
        $status === 'approved' ? $date : null,
    ]);
    $newId = (int)db()->lastInsertId();
    audit_log($user, 'CREATE', 'advances', $newId, $data);
    if ($status === 'pending') {
        push_notify_admins((int)$user['id']);
    } else {
        push_notify_employee($employeeId, (int)$user['id']);
    }
    json_response(['ok' => true, 'id' => $newId, 'status' => $status], 201);
}

if ($method === 'PUT' && $id && in_array($sub, ['approve', 'reject'], true)) {
    $user = require_permission('advances.write');
    if (!has_global_scope($user)) {
        json_response(['ok' => false, 'error' => 'Only administrator or coordinator can review advances'], 403);
    }
    $data = read_json();
    $own = db()->prepare('SELECT employee_id, date FROM advances WHERE id = ? AND deleted_at IS NULL LIMIT 1');
    $own->execute([$id]);
    $advance = $own->fetch();
    if (!$advance) {
        json_response(['ok' => false, 'error' => 'Advance not found'], 404);
    }
    require_employee_access($user, (int)$advance['employee_id']);
    $status = $sub === 'approve' ? 'approved' : 'rejected';
    $paidAt = $status === 'approved' ? (date_or_null($data, 'paid_at') ?: date('Y-m-d')) : null;
    if ($status === 'approved') {
        db()->prepare('UPDATE advances SET date=?, month=?, year=?, status=?, approved_by=?, approved_at=NOW(), paid_at=?, rejection_note=NULL WHERE id=? AND deleted_at IS NULL')->execute([
            $paidAt,
            (int)date('n', strtotime((string)$paidAt)),
            (int)date('Y', strtotime((string)$paidAt)),
            $status,
            (int)$user['id'],
            $paidAt,
            $id,
        ]);
    } else {
        db()->prepare('UPDATE advances SET status=?, approved_by=?, approved_at=NOW(), paid_at=NULL, rejection_note=? WHERE id=? AND deleted_at IS NULL')->execute([
            $status,
            (int)$user['id'],
            nullable_string($data, 'rejection_note'),
            $id,
        ]);
    }
    audit_log($user, strtoupper($sub), 'advances', $id, $data);
    push_notify_employee((int)$advance['employee_id'], (int)$user['id']);
    json_response(['ok' => true, 'status' => $status]);
}

if ($method === 'PUT' && $id) {
    $user = require_permission('advances.write');
    if (!has_global_scope($user)) {
        json_response(['ok' => false, 'error' => 'Only administrator or coordinator can edit advances'], 403);
    }
    $data = read_json();
    if (!has_global_scope($user)) {
        $own = db()->prepare('SELECT employee_id FROM advances WHERE id = ? AND deleted_at IS NULL LIMIT 1');
        $own->execute([$id]);
        require_employee_access($user, (int)$own->fetchColumn());
    }
    require_employee_access($user, (int)$data['employee_id']);
    $date = (string)($data['date'] ?? date('Y-m-d'));
    $month = (int)($data['month'] ?? (int)date('n', strtotime($date)));
    $year = (int)($data['year'] ?? (int)date('Y', strtotime($date)));
    $status = in_array(($data['status'] ?? 'approved'), ['pending', 'approved', 'rejected'], true) ? $data['status'] : 'approved';
    $paidAt = $status === 'approved' ? (date_or_null($data, 'paid_at') ?: $date) : null;
    $stmt = db()->prepare('UPDATE advances SET employee_id=?, amount=?, date=?, month=?, year=?, note=?, status=?, approved_by=?, approved_at=?, paid_at=?, rejection_note=NULL WHERE id=? AND deleted_at IS NULL');
    $stmt->execute([
        (int)$data['employee_id'],
        money_value($data, 'amount'),
        $date,
        $month,
        $year,
        nullable_string($data, 'note'),
        $status,
        $status === 'approved' ? (int)$user['id'] : null,
        $status === 'approved' ? date('Y-m-d H:i:s') : null,
        $paidAt,
        $id,
    ]);
    audit_log($user, 'UPDATE', 'advances', $id, $data);
    json_response(['ok' => true]);
}

if ($method === 'DELETE' && $id) {
    $user = require_permission('advances.write');
    if (!has_global_scope($user)) {
        json_response(['ok' => false, 'error' => 'Only administrator or coordinator can delete advances'], 403);
    }
    $own = db()->prepare('SELECT * FROM advances WHERE id = ? AND deleted_at IS NULL LIMIT 1');
    $own->execute([$id]);
    $old = $own->fetch();
    if (!$old) {
        json_response(['ok' => false, 'error' => 'Advance not found'], 404);
    }
    require_employee_access($user, (int)$old['employee_id']);
    db()->prepare('UPDATE advances SET deleted_at = NOW(), deleted_by = ? WHERE id = ?')->execute([(int)$user['id'], $id]);
    audit_log($user, 'SOFT_DELETE', 'advances', $id, ['deleted' => true], $old);
    json_response(['ok' => true]);
}

json_response(['ok' => false, 'error' => 'Advances route not found'], 404);
