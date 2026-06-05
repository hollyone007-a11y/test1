<?php
declare(strict_types=1);

$method = request_method();
$month = (int)($_GET['month'] ?? date('n'));
$year = (int)($_GET['year'] ?? date('Y'));

function salary_snapshot(int $month, int $year, array $user): array
{
    $rows = payroll_rows($month, $year, $user, false);
    $totals = payroll_totals($rows, ['hours', 'bonus_hours', 'payable_hours', 'gross', 'bonus_amount', 'deduction_amount', 'advances', 'housing', 'net']);
    return ['rows' => $rows, 'totals' => $totals];
}

if ($method === 'GET') {
    $user = require_permission('monthclose.view');
    $stmt = db()->prepare('SELECT mc.*, u.name AS closed_by_name FROM month_closings mc LEFT JOIN users u ON u.id = mc.closed_by WHERE mc.month = ? AND mc.year = ? LIMIT 1');
    $stmt->execute([$month, $year]);
    $closing = $stmt->fetch() ?: null;
    if ($closing && isset($closing['snapshot'])) {
        $closing['snapshot'] = json_decode((string)$closing['snapshot'], true);
    }
    json_response(['ok' => true, 'data' => $closing, 'preview' => salary_snapshot($month, $year, $user)]);
}

if ($method === 'POST') {
    $user = require_permission('monthclose.write');
    $data = read_json();
    $month = (int)($data['month'] ?? $month);
    $year = (int)($data['year'] ?? $year);
    $snapshot = salary_snapshot($month, $year, $user);
    $snapshot['closed_at'] = date('c');
    $snapshot['period'] = ['month' => $month, 'year' => $year];
    $snapshot['notes'] = nullable_string($data, 'notes');
    $stmt = db()->prepare('INSERT INTO month_closings (month,year,closed_by,snapshot,notes) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE closed_by=VALUES(closed_by), snapshot=VALUES(snapshot), notes=VALUES(notes), closed_at=CURRENT_TIMESTAMP');
    $stmt->execute([
        $month,
        $year,
        (int)$user['id'],
        json_encode($snapshot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        nullable_string($data, 'notes'),
    ]);
    audit_log($user, 'CLOSE_MONTH', 'month_closings', null, ['month' => $month, 'year' => $year]);
    json_response(['ok' => true, 'data' => $snapshot]);
}

if ($method === 'DELETE') {
    $user = require_permission('monthclose.write');
    $stmt = db()->prepare('DELETE FROM month_closings WHERE month = ? AND year = ?');
    $stmt->execute([$month, $year]);
    audit_log($user, 'REOPEN_MONTH', 'month_closings', null, ['month' => $month, 'year' => $year]);
    json_response(['ok' => true]);
}

json_response(['ok' => false, 'error' => 'Month close route not found'], 404);


