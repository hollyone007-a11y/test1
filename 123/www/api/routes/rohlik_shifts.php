<?php
declare(strict_types=1);

$method = request_method();
$parts = explode('/', request_path());
$first = $parts[1] ?? '';
$shiftId = ctype_digit((string)$first) ? (int)$first : null;

function rohlik_shift_employee_sql(string $employeeAlias = 'e', string $companyAlias = 'c', string $objectAlias = 'o'): string
{
    return "(LOWER(COALESCE($employeeAlias.email, '')) LIKE '%rohlik%'
        OR LOWER(COALESCE($employeeAlias.warehouse_email, '')) LIKE '%rohlik%'
        OR LOWER(COALESCE($employeeAlias.warehouse_email, '')) LIKE '%@brno1.rohlik.cz%'
        OR LOWER(COALESCE($companyAlias.name, '')) LIKE '%roshpit%'
        OR LOWER(COALESCE($companyAlias.name, '')) LIKE '%rohlik%'
        OR LOWER(COALESCE($objectAlias.name, '')) LIKE '%rohlik%')";
}

function rohlik_shift_is_employee(array $employee): bool
{
    $values = [
        $employee['email'] ?? '',
        $employee['warehouse_email'] ?? '',
        $employee['company_name'] ?? '',
        $employee['object_name'] ?? '',
    ];
    foreach ($values as $value) {
        $text = strtolower((string)$value);
        if (strpos($text, 'rohlik') !== false || strpos($text, 'roshpit') !== false || strpos($text, '@brno1.rohlik.cz') !== false) {
            return true;
        }
    }
    return false;
}

function rohlik_shift_employee(int $employeeId): ?array
{
    $stmt = db()->prepare('SELECT e.id, e.name, e.email, e.warehouse_email, e.avatar_path, c.name AS company_name, o.name AS object_name
                           FROM employees e
                           LEFT JOIN companies c ON c.id = e.company_id
                           LEFT JOIN objects o ON o.id = e.object_id
                           WHERE e.id = ? LIMIT 1');
    $stmt->execute([$employeeId]);
    $row = $stmt->fetch();
    return $row ?: null;
}

function rohlik_shift_require_rohlik_employee(int $employeeId): array
{
    $employee = rohlik_shift_employee($employeeId);
    if (!$employee) {
        json_response(['ok' => false, 'error' => 'Employee not found'], 404);
    }
    if (!rohlik_shift_is_employee($employee)) {
        json_response(['ok' => false, 'error' => 'Smeny are available only for Rohlik Brno workers'], 422);
    }
    return $employee;
}

function rohlik_shift_require_rohlik_user(array $user): void
{
    if (has_global_scope($user)) {
        return;
    }
    $employeeId = (int)($user['employee_id'] ?? 0);
    if (!$employeeId) {
        json_response(['ok' => false, 'error' => 'Employee profile is required'], 403);
    }
    rohlik_shift_require_rohlik_employee($employeeId);
}

function rohlik_shift_require_manager(array $user): void
{
    if (!has_global_scope($user)) {
        json_response(['ok' => false, 'error' => 'Only administrator or coordinator can manage Rohlik shifts'], 403);
    }
}

function rohlik_shift_time_or_null(array $data, string $key): ?string
{
    $value = trim((string)($data[$key] ?? ''));
    if ($value === '') {
        return null;
    }
    if (preg_match('/^\d{2}:\d{2}$/', $value)) {
        return $value . ':00';
    }
    if (preg_match('/^\d{2}:\d{2}:\d{2}$/', $value)) {
        return $value;
    }
    json_response(['ok' => false, 'error' => 'Invalid shift time'], 422);
}

function rohlik_shift_status(string $value): string
{
    return in_array($value, ['planned', 'cancelled'], true) ? $value : 'planned';
}

function rohlik_shift_department(string $value): string
{
    $normalized = strtolower(trim($value));
    if ($normalized === 'expedice') {
        return 'Expedice';
    }
    if ($normalized === 'prijem' || $normalized === 'prijem zbozi') {
        return 'Prijem';
    }
    return 'Kompletace';
}

function rohlik_shift_request_type(string $value): string
{
    return in_array($value, ['day_off', 'vacation'], true) ? $value : 'day_off';
}

function rohlik_shift_period(): array
{
    $month = (int)($_GET['month'] ?? date('n'));
    $year = (int)($_GET['year'] ?? date('Y'));
    $start = sprintf('%04d-%02d-01', $year, $month);
    $end = date('Y-m-t', strtotime($start));
    return [$month, $year, $start, $end];
}

if ($method === 'GET') {
    $user = require_permission('rohlik_shifts.view');
    rohlik_shift_require_rohlik_user($user);
    [$month, $year, $start, $end] = rohlik_shift_period();
    $companyId = has_global_scope($user) ? (int)($_GET['company_id'] ?? 0) : 0;
    $companySql = $companyId > 0 ? ' AND e.company_id = ?' : '';
    $companyParams = $companyId > 0 ? [$companyId] : [];
    $rohlikSql = rohlik_shift_employee_sql('e', 'c', 'o');

    $stmt = db()->prepare("SELECT s.*, e.name AS employee_name, e.email, e.warehouse_email, e.avatar_path AS employee_avatar_path, c.name AS company_name, o.name AS object_name, cu.name AS created_by_name, uu.name AS updated_by_name
                           FROM rohlik_shifts s
                           JOIN employees e ON e.id = s.employee_id
                           LEFT JOIN companies c ON c.id = e.company_id
                           LEFT JOIN objects o ON o.id = e.object_id
                           LEFT JOIN users cu ON cu.id = s.created_by
                           LEFT JOIN users uu ON uu.id = s.updated_by
                           WHERE s.work_date BETWEEN ? AND ? AND $rohlikSql $companySql
                           ORDER BY s.work_date, COALESCE(s.shift_start, '23:59:59'), e.name");
    $stmt->execute(array_merge([$start, $end], $companyParams));
    $shifts = $stmt->fetchAll();

    $requestSql = "SELECT r.*, e.name AS employee_name, e.email, e.avatar_path AS employee_avatar_path, c.name AS company_name, o.name AS object_name, cu.name AS created_by_name, ru.name AS reviewed_by_name
                   FROM rohlik_shift_requests r
                   JOIN employees e ON e.id = r.employee_id
                   LEFT JOIN companies c ON c.id = e.company_id
                   LEFT JOIN objects o ON o.id = e.object_id
                   LEFT JOIN users cu ON cu.id = r.created_by
                   LEFT JOIN users ru ON ru.id = r.reviewed_by
                   WHERE r.date_from <= ? AND r.date_to >= ? AND $rohlikSql";
    $requestParams = [$end, $start];
    if (has_global_scope($user)) {
        if ($companyId > 0) {
            $requestSql .= ' AND e.company_id = ?';
            $requestParams[] = $companyId;
        }
    } else {
        $requestSql .= ' AND r.employee_id = ?';
        $requestParams[] = (int)$user['employee_id'];
    }
    $requestSql .= " ORDER BY FIELD(r.status, 'pending','approved','rejected'), r.date_from, e.name";
    $stmt = db()->prepare($requestSql);
    $stmt->execute($requestParams);
    $requests = $stmt->fetchAll();

    $stmt = db()->prepare("SELECT e.id, e.name, e.email, e.warehouse_email, e.avatar_path, c.name AS company_name, o.name AS object_name
                           FROM employees e
                           LEFT JOIN companies c ON c.id = e.company_id
                           LEFT JOIN objects o ON o.id = e.object_id
                           WHERE e.status = 'active' AND $rohlikSql $companySql
                           ORDER BY e.name");
    $stmt->execute($companyParams);
    $employees = $stmt->fetchAll();

    json_response([
        'ok' => true,
        'data' => [
            'month' => $month,
            'year' => $year,
            'shifts' => $shifts,
            'requests' => $requests,
            'employees' => $employees,
        ],
    ]);
}

if ($method === 'POST' && $first === 'request') {
    $user = require_permission('rohlik_shifts.request');
    rohlik_shift_require_rohlik_user($user);
    $data = read_json();
    $employeeId = has_global_scope($user) ? (int)($data['employee_id'] ?? 0) : (int)($user['employee_id'] ?? 0);
    if (!$employeeId) {
        json_response(['ok' => false, 'error' => 'Employee is required'], 422);
    }
    rohlik_shift_require_rohlik_employee($employeeId);
    $dateFrom = date_or_null($data, 'date_from');
    $dateTo = date_or_null($data, 'date_to') ?: $dateFrom;
    if (!$dateFrom || !$dateTo) {
        json_response(['ok' => false, 'error' => 'Date range is required'], 422);
    }
    if (strtotime($dateTo) < strtotime($dateFrom)) {
        json_response(['ok' => false, 'error' => 'Date to cannot be before date from'], 422);
    }
    $stmt = db()->prepare('INSERT INTO rohlik_shift_requests (employee_id,request_type,date_from,date_to,note,status,created_by) VALUES (?,?,?,?,?,"pending",?)');
    $stmt->execute([
        $employeeId,
        rohlik_shift_request_type((string)($data['request_type'] ?? 'day_off')),
        $dateFrom,
        $dateTo,
        nullable_string($data, 'note'),
        (int)$user['id'],
    ]);
    $newId = (int)db()->lastInsertId();
    audit_log($user, 'CREATE_REQUEST', 'rohlik_shift_requests', $newId, $data);
    json_response(['ok' => true, 'id' => $newId, 'status' => 'pending'], 201);
}

if ($method === 'POST') {
    $user = require_permission('rohlik_shifts.write');
    rohlik_shift_require_manager($user);
    $data = read_json();
    require_fields($data, ['employee_id', 'work_date']);
    $employeeId = (int)$data['employee_id'];
    rohlik_shift_require_rohlik_employee($employeeId);
    $workDate = date_or_null($data, 'work_date');
    if (!$workDate) {
        json_response(['ok' => false, 'error' => 'Work date is required'], 422);
    }
    $shiftStart = rohlik_shift_time_or_null($data, 'shift_start');
    $shiftEnd = rohlik_shift_time_or_null($data, 'shift_end');
    $stmt = db()->prepare('INSERT INTO rohlik_shifts (employee_id,department,work_date,shift_start,shift_end,shift_label,workplace,status,note,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE department=VALUES(department), shift_end=VALUES(shift_end), shift_label=VALUES(shift_label), workplace=VALUES(workplace), status=VALUES(status), note=VALUES(note), updated_by=VALUES(updated_by)');
    $stmt->execute([
        $employeeId,
        rohlik_shift_department((string)($data['department'] ?? 'Kompletace')),
        $workDate,
        $shiftStart,
        $shiftEnd,
        first_string($data, 'shift_label', 120),
        nullable_string($data, 'workplace', 255),
        rohlik_shift_status((string)($data['status'] ?? 'planned')),
        nullable_string($data, 'note'),
        (int)$user['id'],
        (int)$user['id'],
    ]);
    audit_log($user, 'UPSERT', 'rohlik_shifts', null, $data);
    json_response(['ok' => true]);
}

if ($method === 'PUT' && $first === 'requests' && isset($parts[2]) && ctype_digit((string)$parts[2]) && in_array(($parts[3] ?? ''), ['approve', 'reject'], true)) {
    $user = require_permission('rohlik_shifts.write');
    rohlik_shift_require_manager($user);
    $requestId = (int)$parts[2];
    $action = (string)$parts[3];
    $data = read_json();
    $status = $action === 'approve' ? 'approved' : 'rejected';
    $stmt = db()->prepare('UPDATE rohlik_shift_requests SET status=?, reviewed_by=?, reviewed_at=NOW(), rejection_note=? WHERE id=?');
    $stmt->execute([
        $status,
        (int)$user['id'],
        $status === 'rejected' ? nullable_string($data, 'rejection_note') : null,
        $requestId,
    ]);
    audit_log($user, strtoupper($action), 'rohlik_shift_requests', $requestId, $data);
    json_response(['ok' => true, 'status' => $status]);
}

if ($method === 'PUT' && $shiftId) {
    $user = require_permission('rohlik_shifts.write');
    rohlik_shift_require_manager($user);
    $data = read_json();
    require_fields($data, ['employee_id', 'work_date']);
    $employeeId = (int)$data['employee_id'];
    rohlik_shift_require_rohlik_employee($employeeId);
    $workDate = date_or_null($data, 'work_date');
    if (!$workDate) {
        json_response(['ok' => false, 'error' => 'Work date is required'], 422);
    }
    $stmt = db()->prepare('UPDATE rohlik_shifts SET employee_id=?, department=?, work_date=?, shift_start=?, shift_end=?, shift_label=?, workplace=?, status=?, note=?, updated_by=? WHERE id=?');
    $stmt->execute([
        $employeeId,
        rohlik_shift_department((string)($data['department'] ?? 'Kompletace')),
        $workDate,
        rohlik_shift_time_or_null($data, 'shift_start'),
        rohlik_shift_time_or_null($data, 'shift_end'),
        first_string($data, 'shift_label', 120),
        nullable_string($data, 'workplace', 255),
        rohlik_shift_status((string)($data['status'] ?? 'planned')),
        nullable_string($data, 'note'),
        (int)$user['id'],
        $shiftId,
    ]);
    audit_log($user, 'UPDATE', 'rohlik_shifts', $shiftId, $data);
    json_response(['ok' => true]);
}

if ($method === 'DELETE' && $first === 'requests' && isset($parts[2]) && ctype_digit((string)$parts[2])) {
    $user = require_permission('rohlik_shifts.write');
    rohlik_shift_require_manager($user);
    $requestId = (int)$parts[2];
    db()->prepare('DELETE FROM rohlik_shift_requests WHERE id = ?')->execute([$requestId]);
    audit_log($user, 'DELETE', 'rohlik_shift_requests', $requestId);
    json_response(['ok' => true]);
}

if ($method === 'DELETE' && $shiftId) {
    $user = require_permission('rohlik_shifts.write');
    rohlik_shift_require_manager($user);
    db()->prepare('DELETE FROM rohlik_shifts WHERE id = ?')->execute([$shiftId]);
    audit_log($user, 'DELETE', 'rohlik_shifts', $shiftId);
    json_response(['ok' => true]);
}

json_response(['ok' => false, 'error' => 'Rohlik shifts route not found'], 404);
