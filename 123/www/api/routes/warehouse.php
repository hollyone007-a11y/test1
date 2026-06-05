<?php
declare(strict_types=1);

$method = request_method();
$parts = explode('/', request_path());
$action = $parts[1] ?? 'summary';

const WAREHOUSE_SOURCE_KEY = 'selitra';
const WAREHOUSE_SHEET_ID = '1KK6MldPNM3oCQ6rms0V7RT4beOo9i-Z6IoFG4o5B76I';

function warehouse_csv_url(string $sheet): string
{
    return 'https://docs.google.com/spreadsheets/d/' . WAREHOUSE_SHEET_ID . '/gviz/tq?tqx=out:csv&sheet=' . rawurlencode($sheet);
}

function warehouse_decimal(?string $value): float
{
    $value = trim((string)$value);
    $value = str_replace(["\xc2\xa0", ' ', '%'], '', $value);
    $value = str_replace(',', '.', $value);
    return is_numeric($value) ? round((float)$value, 2) : 0.0;
}

function warehouse_date(?string $value): ?string
{
    $value = trim((string)$value);
    if ($value === '') {
        return null;
    }
    $dt = DateTime::createFromFormat('j.n.Y', $value) ?: DateTime::createFromFormat('d.m.Y', $value);
    return $dt ? $dt->format('Y-m-d') : null;
}

function warehouse_fetch_csv(string $sheet): array
{
    $context = stream_context_create([
        'http' => [
            'timeout' => 18,
            'header' => "User-Agent: BuildPaySync/1.0\r\n",
        ],
    ]);
    $csv = file_get_contents(warehouse_csv_url($sheet), false, $context);
    if ($csv === false || trim($csv) === '') {
        throw new RuntimeException('Google Sheet export is not available: ' . $sheet);
    }
    $rows = [];
    $handle = fopen('php://temp', 'r+');
    fwrite($handle, $csv);
    rewind($handle);
    while (($row = fgetcsv($handle, 0, ',')) !== false) {
        $rows[] = array_map(static fn($cell) => trim((string)$cell), $row);
    }
    fclose($handle);
    return $rows;
}

function warehouse_last_sync(): ?array
{
    $stmt = db()->prepare('SELECT * FROM sync_runs WHERE source_key = ? ORDER BY started_at DESC LIMIT 1');
    $stmt->execute([WAREHOUSE_SOURCE_KEY]);
    $row = $stmt->fetch();
    return $row ?: null;
}

function warehouse_sync(bool $force = false): array
{
    $last = warehouse_last_sync();
    if (!$force && $last && $last['status'] === 'ok' && strtotime((string)$last['started_at']) >= strtotime('-20 hours')) {
        return ['skipped' => true, 'last' => $last, 'rows_suma' => (int)$last['rows_suma'], 'rows_daily' => (int)$last['rows_daily']];
    }

    $started = date('Y-m-d H:i:s');
    $run = db()->prepare('INSERT INTO sync_runs (source_key,status,message,started_at) VALUES (?, "ok", "running", ?)');
    $run->execute([WAREHOUSE_SOURCE_KEY, $started]);
    $runId = (int)db()->lastInsertId();

    try {
        $suma = warehouse_fetch_csv('SUMA');

        $periodStart = warehouse_date($suma[0][2] ?? null);
        $periodEnd = warehouse_date($suma[0][4] ?? null);
        $rowsSuma = 0;
        $upsertSuma = db()->prepare('INSERT INTO warehouse_suma (source_key,period_start,period_end,email,position,worked_hours,extra_hours,billing_hours,imported_at) VALUES (?,?,?,?,?,?,?,?,NOW()) ON DUPLICATE KEY UPDATE position=VALUES(position), worked_hours=VALUES(worked_hours), extra_hours=VALUES(extra_hours), billing_hours=VALUES(billing_hours), imported_at=NOW()');
        foreach ($suma as $i => $row) {
            if ($i < 2 || empty($row[0]) || strpos((string)$row[0], '@') === false) {
                continue;
            }
            $upsertSuma->execute([
                WAREHOUSE_SOURCE_KEY,
                $periodStart,
                $periodEnd,
                strtolower((string)$row[0]),
                $row[1] ?? null,
                warehouse_decimal($row[2] ?? null),
                warehouse_decimal($row[3] ?? null),
                warehouse_decimal($row[4] ?? null),
            ]);
            $rowsSuma++;
        }

        $rowsDaily = 0;

        db()->prepare('UPDATE sync_runs SET status="ok", message=?, rows_suma=?, rows_daily=?, finished_at=NOW() WHERE id=?')->execute(['Synced', $rowsSuma, $rowsDaily, $runId]);
        return ['skipped' => false, 'rows_suma' => $rowsSuma, 'rows_daily' => $rowsDaily, 'last' => warehouse_last_sync()];
    } catch (Throwable $e) {
        db()->prepare('UPDATE sync_runs SET status="failed", message=?, finished_at=NOW() WHERE id=?')->execute([$e->getMessage(), $runId]);
        throw $e;
    }
}

if ($method === 'POST' && $action === 'sync') {
    $user = require_permission('warehouse.sync');
    $result = warehouse_sync(true);
    audit_log($user, 'SYNC', 'warehouse', null, $result);
    json_response(['ok' => true, 'sync' => $result]);
}

if ($method === 'POST' && $action === 'manual') {
    $user = require_permission('warehouse.sync');
    $data = read_json();
    require_fields($data, ['employee_id', 'period_start', 'period_end']);
    $employeeId = (int)$data['employee_id'];
    $stmt = db()->prepare('SELECT id,name,email,warehouse_email FROM employees WHERE id = ? LIMIT 1');
    $stmt->execute([$employeeId]);
    $employee = $stmt->fetch();
    if (!$employee) {
        json_response(['ok' => false, 'error' => 'Employee not found'], 404);
    }
    $email = strtolower(trim((string)($data['email'] ?? ($employee['warehouse_email'] ?: $employee['email']))));
    if ($email === '') {
        $email = 'employee-' . $employeeId . '@manual.local';
    }
    $worked = money_value($data, 'worked_hours');
    $billing = money_value($data, 'billing_hours');
    $efficiency = money_value($data, 'efficiency_percent');
    if ($efficiency <= 0 && $worked > 0) {
        $efficiency = round(($billing / $worked) * 100, 2);
    }
    $stmt = db()->prepare('INSERT INTO warehouse_suma (source_key,employee_id,period_start,period_end,email,position,worked_hours,extra_hours,billing_hours,productivity_percent,efficiency_percent,note,imported_at) VALUES ("manual",?,?,?,?,?,?,?,?,?,?,?,NOW()) ON DUPLICATE KEY UPDATE employee_id=VALUES(employee_id), position=VALUES(position), worked_hours=VALUES(worked_hours), extra_hours=VALUES(extra_hours), billing_hours=VALUES(billing_hours), productivity_percent=VALUES(productivity_percent), efficiency_percent=VALUES(efficiency_percent), note=VALUES(note), imported_at=NOW()');
    $stmt->execute([
        $employeeId,
        date_or_null($data, 'period_start'),
        date_or_null($data, 'period_end'),
        $email,
        nullable_string($data, 'position', 80),
        $worked,
        money_value($data, 'extra_hours'),
        $billing,
        money_value($data, 'productivity_percent'),
        $efficiency,
        nullable_string($data, 'note'),
    ]);
    audit_log($user, 'UPSERT_MANUAL', 'warehouse', $employeeId, $data);
    json_response(['ok' => true]);
}

if ($method === 'GET') {
    $user = require_permission('warehouse.view');
    try {
        warehouse_sync(false);
    } catch (Throwable $e) {
        error_log('Warehouse auto sync failed: ' . $e->getMessage());
    }

    [$scopeSql, $scopeParams] = current_employee_filter($user, 'e');
    $month = (int)($_GET['month'] ?? date('n'));
    $year = (int)($_GET['year'] ?? date('Y'));
    $periodStart = $_GET['period_start'] ?? null;
    $periodEnd = $_GET['period_end'] ?? null;

    $periodSql = '';
    $periodParams = [];
    if ($periodStart && $periodEnd) {
        $periodSql = 'AND s.period_start = ? AND s.period_end = ?';
        $periodParams = [$periodStart, $periodEnd];
    }

    $summarySql = "SELECT s.*, e.id AS employee_id, e.name AS employee_name, e.object_id, o.name AS object_name,
      CASE WHEN s.efficiency_percent > 0 THEN s.efficiency_percent WHEN s.worked_hours > 0 THEN ROUND((s.billing_hours / s.worked_hours) * 100, 2) ELSE 0 END AS avg_efficiency,
      s.productivity_percent AS avg_productivity,
      s.worked_hours AS attendance_hours
      FROM warehouse_suma s
      LEFT JOIN employees e ON e.id = s.employee_id OR LOWER(COALESCE(e.warehouse_email, e.email)) = s.email
      LEFT JOIN objects o ON o.id = e.object_id
      WHERE s.source_key IN (?, 'manual') $periodSql $scopeSql
      ORDER BY s.period_end DESC, s.source_key DESC, s.email";
    $stmt = db()->prepare($summarySql);
    $stmt->execute(array_merge([WAREHOUSE_SOURCE_KEY], $periodParams, $scopeParams));
    $summary = $stmt->fetchAll();

    if ($periodStart && $periodEnd) {
        $attendanceStart = (string)$periodStart;
        $attendanceEnd = (new DateTime((string)$periodEnd))->modify('+1 day')->format('Y-m-d');
        $displayPeriodStart = (string)$periodStart;
        $displayPeriodEnd = (string)$periodEnd;
    } else {
        $periodDate = DateTime::createFromFormat('!Y-n-j', $year . '-' . $month . '-1') ?: new DateTime('first day of this month');
        $attendanceStart = $periodDate->format('Y-m-d');
        $attendanceEnd = (clone $periodDate)->modify('+1 month')->format('Y-m-d');
        $displayPeriodStart = $attendanceStart;
        $displayPeriodEnd = (clone $periodDate)->modify('last day of this month')->format('Y-m-d');
    }

    $attendanceSql = "SELECT e.id AS employee_id, e.name AS employee_name, LOWER(COALESCE(NULLIF(e.warehouse_email, ''), NULLIF(e.email, ''), CONCAT('employee-', e.id, '@checkin.local'))) AS email,
      e.object_id, o.name AS object_name,
      ROUND(COALESCE(SUM(CASE WHEN c.duration_hours IS NOT NULL AND c.duration_hours > 0 THEN c.duration_hours ELSE TIMESTAMPDIFF(MINUTE, c.time_in, c.time_out) / 60 END), 0), 2) AS attendance_hours
      FROM checkins c
      JOIN employees e ON e.id = c.employee_id
      LEFT JOIN companies cpy ON cpy.id = e.company_id
      LEFT JOIN objects o ON o.id = e.object_id
      WHERE c.time_out IS NOT NULL AND c.time_in >= ? AND c.time_in < ? $scopeSql
        AND NOT (COALESCE(o.work_type, '') = 'stavba' OR LOWER(COALESCE(o.name, '')) LIKE '%stavba%' OR LOWER(COALESCE(o.name, '')) LIKE '%fasada%' OR LOWER(COALESCE(cpy.name, '')) LIKE '%stavba%' OR LOWER(COALESCE(cpy.name, '')) LIKE '%fasada%')
      GROUP BY e.id, e.name, e.email, e.warehouse_email, e.object_id, o.name";
    $attendanceStmt = db()->prepare($attendanceSql);
    $attendanceStmt->execute(array_merge([$attendanceStart, $attendanceEnd], $scopeParams));

    $timesheetDateSql = $periodStart && $periodEnd
        ? 't.work_date >= ? AND t.work_date <= ?'
        : 't.month = ? AND t.year = ?';
    $timesheetDateParams = $periodStart && $periodEnd ? [$periodStart, $periodEnd] : [$month, $year];
    $timesheetSql = "SELECT e.id AS employee_id, e.name AS employee_name, LOWER(COALESCE(NULLIF(e.warehouse_email, ''), NULLIF(e.email, ''), CONCAT('employee-', e.id, '@timesheet.local'))) AS email,
      e.object_id, o.name AS object_name,
      ROUND(COALESCE(SUM(t.hours), 0), 2) AS submitted_hours
      FROM timesheets t
      JOIN employees e ON e.id = t.employee_id
      LEFT JOIN companies cpy ON cpy.id = e.company_id
      LEFT JOIN objects o ON o.id = e.object_id
      WHERE t.status = 'approved' AND $timesheetDateSql $scopeSql
        AND NOT (COALESCE(o.work_type, '') = 'stavba' OR LOWER(COALESCE(o.name, '')) LIKE '%stavba%' OR LOWER(COALESCE(o.name, '')) LIKE '%fasada%' OR LOWER(COALESCE(cpy.name, '')) LIKE '%stavba%' OR LOWER(COALESCE(cpy.name, '')) LIKE '%fasada%')
      GROUP BY e.id, e.name, e.email, e.warehouse_email, e.object_id, o.name";
    $timesheetStmt = db()->prepare($timesheetSql);
    $timesheetStmt->execute(array_merge($timesheetDateParams, $scopeParams));

    $summaryIndex = [];
    foreach ($summary as $idx => $row) {
        $key = !empty($row['employee_id']) ? 'e:' . $row['employee_id'] : 'm:' . strtolower((string)($row['email'] ?? ''));
        $summary[$idx]['attendance_hours'] = (float)($row['attendance_hours'] ?? 0);
        $summary[$idx]['submitted_hours'] = (float)($row['submitted_hours'] ?? 0);
        $summaryIndex[$key] = $idx;
    }

    foreach ($attendanceStmt->fetchAll() as $row) {
        $attendanceHours = (float)$row['attendance_hours'];
        if ($attendanceHours <= 0) {
            continue;
        }
        $key = 'e:' . $row['employee_id'];
        if (isset($summaryIndex[$key])) {
            $idx = $summaryIndex[$key];
            $summary[$idx]['attendance_hours'] = $attendanceHours;
            if ((float)($summary[$idx]['worked_hours'] ?? 0) <= 0) {
                $summary[$idx]['worked_hours'] = $attendanceHours;
            }
            continue;
        }
        $summary[] = [
            'source_key' => 'checkins',
            'period_start' => $displayPeriodStart,
            'period_end' => $displayPeriodEnd,
            'email' => $row['email'],
            'position' => 'check-in',
            'worked_hours' => $attendanceHours,
            'extra_hours' => 0,
            'billing_hours' => 0,
            'productivity_percent' => 0,
            'efficiency_percent' => 0,
            'employee_id' => $row['employee_id'],
            'employee_name' => $row['employee_name'],
            'object_id' => $row['object_id'],
            'object_name' => $row['object_name'],
            'avg_efficiency' => 0,
            'avg_productivity' => 0,
            'attendance_hours' => $attendanceHours,
            'submitted_hours' => 0,
        ];
    }

    foreach ($timesheetStmt->fetchAll() as $row) {
        $submittedHours = (float)$row['submitted_hours'];
        if ($submittedHours <= 0) {
            continue;
        }
        $key = 'e:' . $row['employee_id'];
        if (isset($summaryIndex[$key])) {
            $idx = $summaryIndex[$key];
            $summary[$idx]['submitted_hours'] = $submittedHours;
            if ((float)($summary[$idx]['worked_hours'] ?? 0) <= 0) {
                $summary[$idx]['worked_hours'] = $submittedHours;
            }
            continue;
        }
        $summaryIndex[$key] = count($summary);
        $summary[] = [
            'source_key' => 'timesheets',
            'period_start' => $displayPeriodStart,
            'period_end' => $displayPeriodEnd,
            'email' => $row['email'],
            'position' => 'schvalene hodiny',
            'worked_hours' => $submittedHours,
            'extra_hours' => 0,
            'billing_hours' => 0,
            'productivity_percent' => 0,
            'efficiency_percent' => 0,
            'employee_id' => $row['employee_id'],
            'employee_name' => $row['employee_name'],
            'object_id' => $row['object_id'],
            'object_name' => $row['object_name'],
            'avg_efficiency' => 0,
            'avg_productivity' => 0,
            'attendance_hours' => 0,
            'submitted_hours' => $submittedHours,
        ];
    }

    $periods = db()->query('SELECT DISTINCT period_start, period_end FROM warehouse_suma ORDER BY period_end DESC LIMIT 12')->fetchAll();
    json_response(['ok' => true, 'data' => ['summary' => $summary, 'daily' => [], 'periods' => $periods, 'last_sync' => warehouse_last_sync()]]);
}

json_response(['ok' => false, 'error' => 'Warehouse route not found'], 404);
