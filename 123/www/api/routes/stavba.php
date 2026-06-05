<?php
declare(strict_types=1);

$method = request_method();
$parts = explode('/', request_path());
$action = $parts[1] ?? '';
$id = isset($parts[2]) && ctype_digit((string)$parts[2]) ? (int)$parts[2] : null;

function stavba_period(): array
{
    $month = (int)($_GET['month'] ?? date('n'));
    $year = (int)($_GET['year'] ?? date('Y'));
    $start = DateTime::createFromFormat('!Y-n-j', $year . '-' . $month . '-1') ?: new DateTime('first day of this month');
    $end = (clone $start)->modify('+1 month');
    return [$month, $year, $start->format('Y-m-d'), $end->format('Y-m-d')];
}

function stavba_employee_sql(string $employeeAlias = 'e', string $companyAlias = 'cpy', string $objectAlias = 'o'): string
{
    $employee = preg_replace('/[^A-Za-z0-9_]/', '', $employeeAlias);
    $company = preg_replace('/[^A-Za-z0-9_]/', '', $companyAlias);
    $object = preg_replace('/[^A-Za-z0-9_]/', '', $objectAlias);
    return " AND (
        COALESCE($object.work_type, '') = 'stavba'
        OR LOWER(COALESCE($object.name, '')) LIKE '%fasada%'
        OR LOWER(COALESCE($object.name, '')) LIKE '%fasáda%'
        OR LOWER(COALESCE($object.name, '')) LIKE '%stavba%'
        OR LOWER(COALESCE($company.name, '')) LIKE '%stavba%'
        OR LOWER(COALESCE($company.name, '')) LIKE '%fasada%'
        OR LOWER(COALESCE($company.name, '')) LIKE '%fasáda%'
      )
      AND LOWER(COALESCE($object.name, '')) NOT LIKE '%rohlik%'
      AND LOWER(COALESCE($company.name, '')) NOT LIKE '%rohlik%'
      AND LOWER(COALESCE($company.name, '')) NOT LIKE '%roshpit%'
      AND LOWER(COALESCE($employee.email, '')) NOT LIKE '%@brno1.rohlik.cz%'
      AND LOWER(COALESCE($employee.warehouse_email, '')) NOT LIKE '%@brno1.rohlik.cz%'";
}

function stavba_blank_row(array $row): array
{
    return [
        'employee_id' => (int)$row['employee_id'],
        'employee_name' => $row['employee_name'],
        'company_name' => $row['company_name'] ?? '',
        'object_name' => $row['object_name'] ?? '',
        'hourly_rate' => (float)($row['hourly_rate'] ?? 0),
        'checkin_hours' => 0.0,
        'timesheet_hours' => 0.0,
        'manual_hours' => 0.0,
        'checkin_count' => 0,
        'timesheet_count' => 0,
        'manual_count' => 0,
        'last_checkin_at' => null,
        'last_timesheet_date' => null,
        'last_manual_date' => null,
    ];
}

if ($method === 'GET') {
    $user = require_permission('stavba.view');
    [$month, $year, $start, $end] = stavba_period();
    [$scopeSql, $scopeParams] = current_employee_filter($user, 'e');
    $stavbaSql = stavba_employee_sql('e', 'cpy', 'o');
    $groupId = has_global_scope($user) ? (int)($_GET['object_id'] ?? 0) : 0;
    $groupSql = $groupId > 0 ? ' AND e.object_id = ?' : '';
    $groupParams = $groupId > 0 ? [$groupId] : [];

    $checkinSql = "SELECT e.id AS employee_id, e.name AS employee_name, e.hourly_rate, e.company_id, e.object_id,
      cpy.name AS company_name, o.name AS object_name, o.work_type AS object_work_type,
      ROUND(COALESCE(SUM(CASE WHEN c.duration_hours IS NOT NULL AND c.duration_hours > 0 THEN c.duration_hours ELSE TIMESTAMPDIFF(MINUTE, c.time_in, c.time_out) / 60 END), 0), 2) AS checkin_hours,
      COUNT(c.id) AS checkin_count,
      MAX(c.time_in) AS last_checkin_at
      FROM checkins c
      JOIN employees e ON e.id = c.employee_id
      LEFT JOIN companies cpy ON cpy.id = e.company_id
      LEFT JOIN objects o ON o.id = e.object_id
      WHERE c.time_out IS NOT NULL AND c.status <> 'rejected' AND c.time_in >= ? AND c.time_in < ? $groupSql $scopeSql $stavbaSql
      GROUP BY e.id, e.name, e.hourly_rate, e.company_id, e.object_id, cpy.name, o.name, o.work_type";
    $checkinStmt = db()->prepare($checkinSql);
    $checkinStmt->execute(array_merge([$start, $end], $groupParams, $scopeParams));

    $timesheetSql = "SELECT e.id AS employee_id, e.name AS employee_name, e.hourly_rate, e.company_id, e.object_id,
      cpy.name AS company_name, o.name AS object_name, o.work_type AS object_work_type,
      ROUND(COALESCE(SUM(t.hours), 0), 2) AS timesheet_hours,
      COUNT(t.id) AS timesheet_count,
      MAX(t.work_date) AS last_timesheet_date
      FROM timesheets t
      JOIN employees e ON e.id = t.employee_id
      LEFT JOIN companies cpy ON cpy.id = e.company_id
      LEFT JOIN objects o ON o.id = e.object_id
      WHERE t.status = 'approved' AND t.work_date >= ? AND t.work_date < ? AND COALESCE(t.note, '') NOT LIKE 'Check-in %' $groupSql $scopeSql $stavbaSql
      GROUP BY e.id, e.name, e.hourly_rate, e.company_id, e.object_id, cpy.name, o.name, o.work_type";
    $timesheetStmt = db()->prepare($timesheetSql);
    $timesheetStmt->execute(array_merge([$start, $end], $groupParams, $scopeParams));

    $manualSql = "SELECT m.*, e.name AS employee_name, e.hourly_rate, e.company_id, e.object_id,
      cpy.name AS company_name, o.name AS object_name, o.work_type AS object_work_type, u.name AS created_by_name
      FROM stavba_manual_hours m
      JOIN employees e ON e.id = m.employee_id
      LEFT JOIN companies cpy ON cpy.id = e.company_id
      LEFT JOIN objects o ON o.id = e.object_id
      LEFT JOIN users u ON u.id = m.created_by
      WHERE m.work_date >= ? AND m.work_date < ? $groupSql $scopeSql $stavbaSql
      ORDER BY m.work_date DESC, e.name";
    $manualStmt = db()->prepare($manualSql);
    $manualStmt->execute(array_merge([$start, $end], $groupParams, $scopeParams));
    $manualRows = $manualStmt->fetchAll();

    $rows = [];
    foreach ($checkinStmt->fetchAll() as $row) {
        $idKey = (int)$row['employee_id'];
        $rows[$idKey] = stavba_blank_row($row);
        $rows[$idKey]['checkin_hours'] = (float)($row['checkin_hours'] ?? 0);
        $rows[$idKey]['checkin_count'] = (int)($row['checkin_count'] ?? 0);
        $rows[$idKey]['last_checkin_at'] = $row['last_checkin_at'] ?? null;
    }

    foreach ($timesheetStmt->fetchAll() as $row) {
        $idKey = (int)$row['employee_id'];
        if (!isset($rows[$idKey])) {
            $rows[$idKey] = stavba_blank_row($row);
        }
        $rows[$idKey]['timesheet_hours'] += (float)($row['timesheet_hours'] ?? 0);
        $rows[$idKey]['timesheet_count'] += (int)($row['timesheet_count'] ?? 0);
        if (!$rows[$idKey]['last_timesheet_date'] || strcmp((string)$row['last_timesheet_date'], (string)$rows[$idKey]['last_timesheet_date']) > 0) {
            $rows[$idKey]['last_timesheet_date'] = $row['last_timesheet_date'];
        }
    }

    foreach ($manualRows as $manual) {
        $idKey = (int)$manual['employee_id'];
        if (!isset($rows[$idKey])) {
            $rows[$idKey] = stavba_blank_row($manual);
        }
        $rows[$idKey]['manual_hours'] += (float)$manual['hours'];
        $rows[$idKey]['manual_count']++;
        if (!$rows[$idKey]['last_manual_date'] || strcmp((string)$manual['work_date'], (string)$rows[$idKey]['last_manual_date']) > 0) {
            $rows[$idKey]['last_manual_date'] = $manual['work_date'];
        }
    }

    $summary = array_values($rows);
    $totals = ['people' => count($summary), 'checkin_hours' => 0.0, 'timesheet_hours' => 0.0, 'manual_hours' => 0.0, 'total_hours' => 0.0, 'gross_amount' => 0.0];
    foreach ($summary as &$row) {
        $row['checkin_hours'] = round((float)$row['checkin_hours'], 2);
        $row['timesheet_hours'] = round((float)$row['timesheet_hours'], 2);
        $row['manual_hours'] = round((float)$row['manual_hours'], 2);
        $row['total_hours'] = round($row['checkin_hours'] + $row['timesheet_hours'] + $row['manual_hours'], 2);
        $row['gross_amount'] = round($row['total_hours'] * (float)$row['hourly_rate'], 2);
        foreach (['checkin_hours', 'timesheet_hours', 'manual_hours', 'total_hours', 'gross_amount'] as $key) {
            $totals[$key] += (float)$row[$key];
        }
    }
    unset($row);
    usort($summary, static fn($a, $b) => strcasecmp((string)$a['employee_name'], (string)$b['employee_name']));
    foreach (['checkin_hours', 'timesheet_hours', 'manual_hours', 'total_hours', 'gross_amount'] as $key) {
        $totals[$key] = round((float)$totals[$key], 2);
    }

    $employeesStmt = db()->prepare("SELECT e.id,e.name,e.hourly_rate,e.company_id,e.object_id,cpy.name AS company_name,o.name AS object_name,o.work_type AS object_work_type
      FROM employees e
      LEFT JOIN companies cpy ON cpy.id = e.company_id
      LEFT JOIN objects o ON o.id = e.object_id
      WHERE e.status = 'active' $groupSql $scopeSql $stavbaSql
      ORDER BY e.name");
    $employeesStmt->execute(array_merge($groupParams, $scopeParams));

    $groupsStmt = db()->prepare("SELECT o.*, c.name AS company_name, (SELECT COUNT(*) FROM employees e2 WHERE e2.object_id = o.id AND e2.status = 'active') AS employees_count
      FROM objects o
      LEFT JOIN companies c ON c.id = o.company_id
      WHERE o.status = 'active'
        AND (COALESCE(o.work_type, '') = 'stavba' OR LOWER(COALESCE(o.name, '')) LIKE '%stavba%' OR LOWER(COALESCE(o.name, '')) LIKE '%fasada%' OR LOWER(COALESCE(o.name, '')) LIKE '%fasáda%')
      ORDER BY o.name");
    $groupsStmt->execute();

    json_response(['ok' => true, 'data' => [
        'month' => $month,
        'year' => $year,
        'period_start' => $start,
        'period_end' => (new DateTime($end))->modify('-1 day')->format('Y-m-d'),
        'summary' => $summary,
        'manual' => $manualRows,
        'employees' => $employeesStmt->fetchAll(),
        'groups' => $groupsStmt->fetchAll(),
        'selected_object_id' => $groupId,
        'totals' => $totals,
    ]]);
}

if ($method === 'POST' && $action === 'manual') {
    $user = require_permission('stavba.write');
    $data = read_json();
    require_fields($data, ['employee_id', 'work_date', 'hours']);
    $employeeId = (int)$data['employee_id'];
    require_employee_access($user, $employeeId);
    $workDate = date_or_null($data, 'work_date');
    if (!$workDate) {
        json_response(['ok' => false, 'error' => 'Work date is required'], 422);
    }
    $stmt = db()->prepare('INSERT INTO stavba_manual_hours (employee_id,work_date,hours,note,created_by,updated_by) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE hours=VALUES(hours), note=VALUES(note), updated_by=VALUES(updated_by)');
    $stmt->execute([
        $employeeId,
        $workDate,
        money_value($data, 'hours'),
        nullable_string($data, 'note'),
        (int)$user['id'],
        (int)$user['id'],
    ]);
    audit_log($user, 'UPSERT_MANUAL', 'stavba', $employeeId, $data);
    json_response(['ok' => true]);
}

if ($method === 'DELETE' && $action === 'manual' && $id) {
    $user = require_permission('stavba.write');
    $stmt = db()->prepare('SELECT employee_id FROM stavba_manual_hours WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $employeeId = (int)$stmt->fetchColumn();
    if (!$employeeId) {
        json_response(['ok' => false, 'error' => 'Manual hours not found'], 404);
    }
    require_employee_access($user, $employeeId);
    db()->prepare('DELETE FROM stavba_manual_hours WHERE id = ?')->execute([$id]);
    audit_log($user, 'DELETE_MANUAL', 'stavba', $id);
    json_response(['ok' => true]);
}

json_response(['ok' => false, 'error' => 'Stavba route not found'], 404);
