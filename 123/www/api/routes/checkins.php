<?php
declare(strict_types=1);

$method = request_method();
$parts = explode('/', request_path());
$id = isset($parts[1]) && ctype_digit((string)$parts[1]) ? (int)$parts[1] : null;
$sub = $parts[2] ?? ($parts[1] ?? '');

function checkin_float_or_null(array $data, string $key): ?float
{
    if (!isset($data[$key]) || $data[$key] === '') {
        return null;
    }
    if (!is_numeric($data[$key])) {
        return null;
    }
    return (float)$data[$key];
}

function checkin_location_payload(array $data): array
{
    $lat = checkin_float_or_null($data, 'lat');
    $lng = checkin_float_or_null($data, 'lng');
    $accuracy = checkin_float_or_null($data, 'location_accuracy');
    $capturedAt = null;
    if (!empty($data['location_captured_at'])) {
        $ts = strtotime((string)$data['location_captured_at']);
        if ($ts !== false) {
            $capturedAt = date('Y-m-d H:i:s', $ts);
        }
    }
    return [
        'lat' => $lat,
        'lng' => $lng,
        'accuracy' => $accuracy,
        'captured_at' => $capturedAt,
        'source' => ($lat !== null && $lng !== null) ? 'browser_gps' : null,
        'locked' => ($lat !== null && $lng !== null) ? 1 : null,
    ];
}

function checkin_validate_location(array $location, array $user): void
{
    if ($location['lat'] !== null && ($location['lat'] < -90 || $location['lat'] > 90)) {
        json_response(['ok' => false, 'error' => 'Invalid GPS latitude'], 422);
    }
    if ($location['lng'] !== null && ($location['lng'] < -180 || $location['lng'] > 180)) {
        json_response(['ok' => false, 'error' => 'Invalid GPS longitude'], 422);
    }
    if (!has_global_scope($user)) {
        if ($location['lat'] === null || $location['lng'] === null) {
            json_response(['ok' => false, 'error' => 'GPS poloha je povinna. Zapnete polohu v telefonu a zkuste to znovu.'], 422);
        }
        if ($location['accuracy'] !== null && $location['accuracy'] > 500) {
            json_response(['ok' => false, 'error' => 'GPS poloha je prilis nepresna. Pockejte na presnejsi signal a zkuste to znovu.'], 422);
        }
        if ($location['captured_at'] !== null && abs(time() - strtotime((string)$location['captured_at'])) > 300) {
            json_response(['ok' => false, 'error' => 'GPS poloha je zastarala. Nactete polohu znovu.'], 422);
        }
    }
}

function checkin_capture_time(array $location): ?string
{
    if ($location['lat'] === null || $location['lng'] === null) {
        return null;
    }
    return $location['captured_at'] ?: date('Y-m-d H:i:s');
}

function checkin_break_minutes(array $data): int
{
    $base = array_key_exists('break_minutes', $data) ? (int)$data['break_minutes'] : 30;
    if (array_key_exists('extra_break_minutes', $data)) {
        $base = 30 + (int)$data['extra_break_minutes'];
    }
    return max(0, min(240, $base));
}

if ($method === 'GET') {
    $user = require_permission('checkins.view');
    [$scopeSql, $scopeParams] = current_employee_filter($user, 'e');
    $stmt = db()->prepare("SELECT c.*, e.name AS employee_name, o.name AS object_name, u.name AS user_name
                           FROM checkins c
                           JOIN employees e ON e.id = c.employee_id
                           LEFT JOIN objects o ON o.id = c.object_id
                           LEFT JOIN users u ON u.id = c.user_id
                           WHERE 1=1 $scopeSql
                           ORDER BY c.time_in DESC LIMIT 200");
    $stmt->execute($scopeParams);
    json_response(['ok' => true, 'data' => $stmt->fetchAll()]);
}

if ($method === 'POST' && $sub === 'location') {
    $user = require_permission('checkins.write');
    $data = read_json();
    $employeeId = (int)($user['employee_id'] ?? 0);
    if (!$employeeId) {
        json_response(['ok' => false, 'error' => 'Employee is required'], 422);
    }
    $location = checkin_location_payload($data);
    checkin_validate_location($location, $user);
    $stmt = db()->prepare('UPDATE checkins SET lat=?, lng=?, location_accuracy=COALESCE(?, location_accuracy), location_captured_at=COALESCE(?, location_captured_at), location_source=COALESCE(?, location_source), location_locked=COALESCE(?, location_locked), movement_points=movement_points+1, last_seen_at=NOW(), location_name=COALESCE(?, location_name) WHERE employee_id=? AND time_out IS NULL');
    $stmt->execute([
        $location['lat'],
        $location['lng'],
        $location['accuracy'],
        checkin_capture_time($location),
        $location['source'],
        $location['locked'],
        nullable_string($data, 'location_name', 255),
        $employeeId,
    ]);
    json_response(['ok' => true]);
}

if ($method === 'PUT' && $id && in_array($sub, ['approve', 'reject'], true)) {
    $user = require_permission('checkins.write');
    if (!has_global_scope($user)) {
        json_response(['ok' => false, 'error' => 'Only administrator can review check-ins'], 403);
    }
    $data = read_json();
    $own = db()->prepare('SELECT employee_id FROM checkins WHERE id = ? LIMIT 1');
    $own->execute([$id]);
    $employeeId = (int)$own->fetchColumn();
    if (!$employeeId) {
        json_response(['ok' => false, 'error' => 'Check-in not found'], 404);
    }
    require_employee_access($user, $employeeId);
    $status = $sub === 'approve' ? 'approved' : 'rejected';
    db()->prepare('UPDATE checkins SET status=?, approved_by=?, approved_at=NOW(), rejection_note=? WHERE id=?')->execute([
        $status,
        (int)$user['id'],
        $status === 'rejected' ? nullable_string($data, 'rejection_note') : null,
        $id,
    ]);
    audit_log($user, strtoupper($sub), 'checkins', $id, $data);
    push_notify_employee($employeeId, (int)$user['id']);
    json_response(['ok' => true, 'status' => $status]);
}

if ($method === 'POST') {
    $user = require_permission('checkins.write');
    $data = read_json();
    $employeeId = (int)($data['employee_id'] ?? ($user['employee_id'] ?? 0));
    if (!$employeeId) {
        json_response(['ok' => false, 'error' => 'Employee is required'], 422);
    }
    require_employee_access($user, $employeeId);
    $objectId = int_or_null($data, 'object_id');
    if (!has_global_scope($user)) {
        $objectStmt = db()->prepare('SELECT object_id FROM employees WHERE id = ? LIMIT 1');
        $objectStmt->execute([$employeeId]);
        $objectId = (int)$objectStmt->fetchColumn() ?: null;
    }
    $active = db()->prepare('SELECT id FROM checkins WHERE employee_id = ? AND time_out IS NULL LIMIT 1');
    $active->execute([$employeeId]);
    $activeId = $active->fetchColumn();
    $location = checkin_location_payload($data);
    checkin_validate_location($location, $user);
    $breakMinutes = checkin_break_minutes($data);
    if ($activeId) {
        $timeOut = has_global_scope($user) ? (datetime_or_null($data, 'time_out') ?: date('Y-m-d H:i:s')) : date('Y-m-d H:i:s');
        $rawMinutesStmt = db()->prepare('SELECT GREATEST(0, TIMESTAMPDIFF(MINUTE, time_in, ?)) FROM checkins WHERE id = ? LIMIT 1');
        $rawMinutesStmt->execute([$timeOut, (int)$activeId]);
        $rawMinutes = max(0, (int)$rawMinutesStmt->fetchColumn());
        $durationHours = round(max(0, $rawMinutes - $breakMinutes) / 60, 2);
        $rawDurationHours = round($rawMinutes / 60, 2);
        db()->prepare('UPDATE checkins SET time_out = ?, last_seen_at = NOW(), lat = COALESCE(?, lat), lng = COALESCE(?, lng), location_accuracy = COALESCE(?, location_accuracy), location_captured_at = COALESCE(?, location_captured_at), location_source = COALESCE(?, location_source), location_locked = COALESCE(?, location_locked), note = COALESCE(?, note), break_minutes = ?, raw_duration_hours = ?, duration_hours = ? WHERE id = ?')->execute([
            $timeOut,
            $location['lat'],
            $location['lng'],
            $location['accuracy'],
            checkin_capture_time($location),
            $location['source'],
            $location['locked'],
            nullable_string($data, 'note'),
            $breakMinutes,
            $rawDurationHours,
            $durationHours,
            (int)$activeId,
        ]);
        $rowStmt = db()->prepare('SELECT employee_id, time_in, duration_hours, note FROM checkins WHERE id = ? LIMIT 1');
        $rowStmt->execute([(int)$activeId]);
        $row = $rowStmt->fetch();
        if ($row && (float)$row['duration_hours'] > 0) {
            $workDate = date('Y-m-d', strtotime((string)$row['time_in']));
            $periodMonth = (int)date('n', strtotime((string)$row['time_in']));
            $periodYear = (int)date('Y', strtotime((string)$row['time_in']));
            $canApprove = can($user, 'timesheets.approve');
            $status = $canApprove ? 'approved' : 'pending';
            $stmt = db()->prepare('INSERT INTO timesheets (employee_id,work_date,month,year,hours,note,status,submitted_by,approved_by,approved_at,rejection_note) VALUES (?,?,?,?,?,?,?,?,?,?,NULL) ON DUPLICATE KEY UPDATE month=VALUES(month), year=VALUES(year), hours=hours+VALUES(hours), note=CONCAT(COALESCE(note,""), IF(COALESCE(note,"")="" OR VALUES(note) IS NULL, "", "\n"), COALESCE(VALUES(note),"")), status=VALUES(status), submitted_by=VALUES(submitted_by), approved_by=VALUES(approved_by), approved_at=VALUES(approved_at), rejection_note=NULL');
            $stmt->execute([
                (int)$row['employee_id'],
                $workDate,
                $periodMonth,
                $periodYear,
                (float)$row['duration_hours'],
                'Check-in ' . date('d.m.Y H:i', strtotime((string)$row['time_in'])) . ' - ' . date('H:i', strtotime($timeOut)),
                $status,
                (int)$user['id'],
                $canApprove ? (int)$user['id'] : null,
                $canApprove ? date('Y-m-d H:i:s') : null,
            ]);
        }
        audit_log($user, 'CHECKOUT', 'checkins', (int)$activeId, $data);
        if (!has_global_scope($user)) {
            push_notify_admins((int)$user['id']);
        }
        json_response(['ok' => true, 'mode' => 'checkout', 'id' => (int)$activeId]);
    }
    $timeIn = has_global_scope($user) ? (datetime_or_null($data, 'time_in') ?: date('Y-m-d H:i:s')) : date('Y-m-d H:i:s');
    $timeOut = has_global_scope($user) ? datetime_or_null($data, 'time_out') : null;
    $rawDuration = $timeOut ? max(0, round((strtotime($timeOut) - strtotime($timeIn)) / 3600, 2)) : null;
    $duration = $rawDuration !== null ? max(0, round($rawDuration - ($breakMinutes / 60), 2)) : null;
    $canApproveStart = has_global_scope($user) || can($user, 'timesheets.approve');
    $checkinStatus = $canApproveStart ? 'approved' : 'pending';
    $stmt = db()->prepare('INSERT INTO checkins (employee_id,object_id,user_id,time_in,time_out,lat,lng,location_accuracy,location_captured_at,location_source,location_locked,movement_points,last_seen_at,duration_hours,break_minutes,raw_duration_hours,location_name,note,status,approved_by,approved_at,rejection_note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NOW(),?,?,?,?,?,?,?,?,NULL)');
    $stmt->execute([
        $employeeId,
        $objectId,
        (int)$user['id'],
        $timeIn,
        $timeOut,
        $location['lat'],
        $location['lng'],
        $location['accuracy'],
        checkin_capture_time($location),
        $location['source'],
        $location['locked'] ?? 0,
        ($location['lat'] !== null && $location['lng'] !== null) ? 1 : 0,
        $duration,
        $breakMinutes,
        $rawDuration,
        nullable_string($data, 'location_name', 255),
        nullable_string($data, 'note'),
        $checkinStatus,
        $canApproveStart ? (int)$user['id'] : null,
        $canApproveStart ? date('Y-m-d H:i:s') : null,
    ]);
    $newId = (int)db()->lastInsertId();
    if ($duration && $duration > 0) {
        $workDate = date('Y-m-d', strtotime($timeIn));
        $periodMonth = (int)date('n', strtotime($timeIn));
        $periodYear = (int)date('Y', strtotime($timeIn));
        $canApprove = can($user, 'timesheets.approve');
        $stmt = db()->prepare('INSERT INTO timesheets (employee_id,work_date,month,year,hours,note,status,submitted_by,approved_by,approved_at,rejection_note) VALUES (?,?,?,?,?,?,?,?,?,?,NULL) ON DUPLICATE KEY UPDATE month=VALUES(month), year=VALUES(year), hours=hours+VALUES(hours), note=CONCAT(COALESCE(note,""), IF(COALESCE(note,"")="" OR VALUES(note) IS NULL, "", "\n"), COALESCE(VALUES(note),"")), status=VALUES(status), submitted_by=VALUES(submitted_by), approved_by=VALUES(approved_by), approved_at=VALUES(approved_at), rejection_note=NULL');
        $stmt->execute([
            $employeeId,
            $workDate,
            $periodMonth,
            $periodYear,
            $duration,
            'Check-in ' . date('d.m.Y H:i', strtotime($timeIn)) . ' - ' . date('H:i', strtotime($timeOut)),
            $canApprove ? 'approved' : 'pending',
            (int)$user['id'],
            $canApprove ? (int)$user['id'] : null,
            $canApprove ? date('Y-m-d H:i:s') : null,
        ]);
    }
    audit_log($user, 'CHECKIN', 'checkins', $newId, $data);
    if ($checkinStatus === 'pending') {
        push_notify_admins((int)$user['id']);
    } else {
        push_notify_employee($employeeId, (int)$user['id']);
    }
    json_response(['ok' => true, 'mode' => 'checkin', 'id' => $newId], 201);
}

if ($method === 'DELETE' && $id) {
    $user = require_permission('checkins.write');
    if (!has_global_scope($user)) {
        json_response(['ok' => false, 'error' => 'Only administrator can delete check-ins'], 403);
    }
    $own = db()->prepare('SELECT employee_id FROM checkins WHERE id = ? LIMIT 1');
    $own->execute([$id]);
    $employeeId = (int)$own->fetchColumn();
    require_employee_access($user, $employeeId);
    db()->prepare('DELETE FROM checkins WHERE id = ?')->execute([$id]);
    audit_log($user, 'DELETE', 'checkins', $id);
    json_response(['ok' => true]);
}

json_response(['ok' => false, 'error' => 'Checkins route not found'], 404);
