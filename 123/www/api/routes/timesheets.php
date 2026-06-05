<?php
declare(strict_types=1);

$method = request_method();
$parts = explode('/', request_path());
$id = isset($parts[1]) ? (int)$parts[1] : null;
$sub = $parts[2] ?? '';

function timesheet_period_from_date(array $data): array
{
    $workDate = date_or_null($data, 'work_date');
    if (!$workDate) {
        $month = (int)($data['month'] ?? date('n'));
        $year = (int)($data['year'] ?? date('Y'));
        $workDate = sprintf('%04d-%02d-01', $year, $month);
    }
    $dt = new DateTime($workDate);
    return [$workDate, (int)$dt->format('n'), (int)$dt->format('Y')];
}

function timesheet_is_duplicate_day_error(PDOException $e): bool
{
    return (int)($e->errorInfo[1] ?? 0) === 1062
        && stripos($e->getMessage(), 'uq_timesheet_day') !== false;
}

function timesheet_datetime_or_null(array $data, string $key, string $workDate): ?string
{
    if (empty($data[$key])) {
        return null;
    }
    $value = trim((string)$data[$key]);
    if (preg_match('/^\d{2}:\d{2}$/', $value)) {
        $value = $workDate . ' ' . $value . ':00';
    } else {
        $value = str_replace('T', ' ', $value);
        if (preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/', $value)) {
            $value .= ':00';
        }
    }
    $ts = strtotime($value);
    return $ts === false ? null : date('Y-m-d H:i:s', $ts);
}

function timesheet_hours_payload(array $data, string $workDate, bool $requireRange = false): array
{
    $startAt = timesheet_datetime_or_null($data, 'work_start_at', $workDate);
    $endAt = timesheet_datetime_or_null($data, 'work_end_at', $workDate);
    if (($startAt && !$endAt) || (!$startAt && $endAt)) {
        json_response(['ok' => false, 'error' => 'Vyplnte zacatek i konec prace.'], 422);
    }
    if ($startAt && $endAt) {
        $startTs = strtotime($startAt);
        $endTs = strtotime($endAt);
        if ($endTs <= $startTs) {
            $endTs = strtotime('+1 day', $endTs);
            $endAt = date('Y-m-d H:i:s', $endTs);
        }
        $hours = round(($endTs - $startTs) / 3600, 2);
        if ($hours <= 0 || $hours > 24) {
            json_response(['ok' => false, 'error' => 'Cas smeny musi byt v rozsahu 0-24 hodin.'], 422);
        }
        return [$hours, $startAt, $endAt];
    }
    if ($requireRange) {
        json_response(['ok' => false, 'error' => 'Vyplnte zacatek a konec prace.'], 422);
    }
    if (!isset($data['hours']) || $data['hours'] === '') {
        json_response(['ok' => false, 'error' => 'Vyplnte hodiny nebo zacatek a konec prace.'], 422);
    }
    return [money_value($data, 'hours'), null, null];
}

if ($method === 'GET') {
    $user = require_permission('timesheets.view');
    $month = (int)($_GET['month'] ?? date('n'));
    $year = (int)($_GET['year'] ?? date('Y'));
    [$scopeSql, $scopeParams] = current_employee_filter($user, 'e');
    $stmt = db()->prepare("SELECT t.*, e.name AS employee_name, e.hourly_rate, u.name AS submitted_by_name, au.name AS approved_by_name
                           FROM timesheets t
                           JOIN employees e ON e.id = t.employee_id
                           LEFT JOIN users u ON u.id = t.submitted_by
                           LEFT JOIN users au ON au.id = t.approved_by
                           WHERE t.month = ? AND t.year = ? $scopeSql
                           ORDER BY FIELD(t.status, 'pending','approved','rejected'), t.work_date DESC, e.name");
    $stmt->execute(array_merge([$month, $year], $scopeParams));
    json_response(['ok' => true, 'data' => $stmt->fetchAll()]);
}

if ($method === 'POST') {
    $user = require_permission('timesheets.write');
    $data = read_json();
    $employeeId = has_global_scope($user) ? (int)($data['employee_id'] ?? 0) : (int)($user['employee_id'] ?? 0);
    if (!$employeeId) {
        json_response(['ok' => false, 'error' => 'Employee is required'], 422);
    }
    require_employee_access($user, $employeeId);
    [$workDate, $month, $year] = timesheet_period_from_date($data);
    [$hours, $startAt, $endAt] = timesheet_hours_payload($data, $workDate, !has_global_scope($user));
    $canApprove = can($user, 'timesheets.approve');
    $status = $canApprove ? 'approved' : 'pending';
    $approvedBy = $canApprove ? (int)$user['id'] : null;
    if (!has_global_scope($user)) {
        $existing = db()->prepare('SELECT status FROM timesheets WHERE employee_id = ? AND work_date = ? LIMIT 1');
        $existing->execute([$employeeId, $workDate]);
        if ($existing->fetchColumn()) {
            json_response(['ok' => false, 'error' => 'Hodiny za tento den uz byly odeslany. Administrator je muze schvalit nebo upravit.'], 409);
        }
    }
    $sql = has_global_scope($user)
        ? 'INSERT INTO timesheets (employee_id,work_date,work_start_at,work_end_at,month,year,hours,note,status,submitted_by,approved_by,approved_at,rejection_note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL) ON DUPLICATE KEY UPDATE work_start_at=VALUES(work_start_at), work_end_at=VALUES(work_end_at), month=VALUES(month), year=VALUES(year), hours=VALUES(hours), note=VALUES(note), status=VALUES(status), submitted_by=VALUES(submitted_by), approved_by=VALUES(approved_by), approved_at=VALUES(approved_at), rejection_note=NULL'
        : 'INSERT INTO timesheets (employee_id,work_date,work_start_at,work_end_at,month,year,hours,note,status,submitted_by,approved_by,approved_at,rejection_note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)';
    $stmt = db()->prepare($sql);
    try {
        $stmt->execute([
            $employeeId,
            $workDate,
            $startAt,
            $endAt,
            $month,
            $year,
            $hours,
            nullable_string($data, 'note'),
            $status,
            (int)$user['id'],
            $approvedBy,
            $canApprove ? date('Y-m-d H:i:s') : null,
        ]);
    } catch (PDOException $e) {
        if (timesheet_is_duplicate_day_error($e)) {
            json_response(['ok' => false, 'error' => 'Hodiny za tento den uz byly odeslany. Administrator je muze schvalit nebo upravit.'], 409);
        }
        throw $e;
    }
    audit_log($user, 'UPSERT', 'timesheets', null, $data);
    if ($status === 'pending') {
        push_notify_admins((int)$user['id']);
    } else {
        push_notify_employee($employeeId, (int)$user['id']);
    }
    json_response(['ok' => true, 'status' => $status]);
}

if ($method === 'PUT' && $id && in_array($sub, ['approve', 'reject'], true)) {
    $user = require_permission('timesheets.approve');
    $data = read_json();
    $own = db()->prepare('SELECT employee_id FROM timesheets WHERE id = ? LIMIT 1');
    $own->execute([$id]);
    $employeeId = (int)$own->fetchColumn();
    require_employee_access($user, $employeeId);
    $status = $sub === 'approve' ? 'approved' : 'rejected';
    $stmt = db()->prepare('UPDATE timesheets SET status=?, approved_by=?, approved_at=NOW(), rejection_note=? WHERE id=?');
    $stmt->execute([$status, (int)$user['id'], $status === 'rejected' ? nullable_string($data, 'rejection_note') : null, $id]);
    audit_log($user, strtoupper($sub), 'timesheets', $id, $data);
    push_notify_employee($employeeId, (int)$user['id']);
    json_response(['ok' => true, 'status' => $status]);
}

if ($method === 'PUT' && $id) {
    $user = require_permission('timesheets.write');
    if (!has_global_scope($user)) {
        json_response(['ok' => false, 'error' => 'Only administrator can edit submitted hours'], 403);
    }
    $data = read_json();
    $own = db()->prepare('SELECT employee_id FROM timesheets WHERE id = ? LIMIT 1');
    $own->execute([$id]);
    $employeeId = (int)$own->fetchColumn();
    require_employee_access($user, $employeeId);
    $canApprove = can($user, 'timesheets.approve');
    $status = $canApprove ? 'approved' : 'pending';
    [$workDate, $month, $year] = timesheet_period_from_date($data);
    [$hours, $startAt, $endAt] = timesheet_hours_payload($data, $workDate, false);
    $stmt = db()->prepare('UPDATE timesheets SET work_date=?, work_start_at=?, work_end_at=?, month=?, year=?, hours=?, note=?, status=?, submitted_by=?, approved_by=?, approved_at=?, rejection_note=NULL WHERE id=?');
    try {
        $stmt->execute([
            $workDate,
            $startAt,
            $endAt,
            $month,
            $year,
            $hours,
            nullable_string($data, 'note'),
            $status,
            (int)$user['id'],
            $canApprove ? (int)$user['id'] : null,
            $canApprove ? date('Y-m-d H:i:s') : null,
            $id,
        ]);
    } catch (PDOException $e) {
        if (timesheet_is_duplicate_day_error($e)) {
            json_response(['ok' => false, 'error' => 'U tohoto zamestnance uz hodiny pro tento den existuji.'], 409);
        }
        throw $e;
    }
    audit_log($user, 'UPDATE', 'timesheets', $id, $data);
    json_response(['ok' => true]);
}

if ($method === 'DELETE' && $id) {
    $user = require_permission('timesheets.write');
    if (!has_global_scope($user)) {
        json_response(['ok' => false, 'error' => 'Only administrator can delete submitted hours'], 403);
    }
    $own = db()->prepare('SELECT employee_id FROM timesheets WHERE id = ? LIMIT 1');
    $own->execute([$id]);
    $employeeId = (int)$own->fetchColumn();
    require_employee_access($user, $employeeId);
    db()->prepare('DELETE FROM timesheets WHERE id = ?')->execute([$id]);
    audit_log($user, 'DELETE', 'timesheets', $id);
    json_response(['ok' => true]);
}

json_response(['ok' => false, 'error' => 'Timesheets route not found'], 404);
