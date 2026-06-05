<?php
declare(strict_types=1);

$method = request_method();
$parts = explode('/', request_path());
$id = isset($parts[1]) ? (int)$parts[1] : null;
$sub = $parts[2] ?? '';

function payout_rows(int $month, int $year, array $user): array
{
    return payroll_rows($month, $year, $user, true);
}

function payout_employee(int $employeeId): array
{
    $stmt = db()->prepare('SELECT id, name, email, warehouse_email, contract_type, contract_number, hourly_rate FROM employees WHERE id = ? LIMIT 1');
    $stmt->execute([$employeeId]);
    $employee = $stmt->fetch();
    if (!$employee) {
        json_response(['ok' => false, 'error' => 'Employee not found'], 404);
    }
    return $employee;
}

function payout_adjustment_email(array $employee, int $month, int $year): string
{
    $stmt = db()->prepare('SELECT email FROM rohlik_brno_adjustments WHERE employee_id = ? AND month = ? AND year = ? ORDER BY id DESC LIMIT 1');
    $stmt->execute([(int)$employee['id'], $month, $year]);
    $existing = trim((string)($stmt->fetchColumn() ?: ''));
    if ($existing !== '') {
        return strtolower($existing);
    }
    $email = strtolower(trim((string)($employee['warehouse_email'] ?: $employee['email'] ?: '')));
    return $email !== '' ? $email : 'employee-' . (int)$employee['id'] . '@manual.local';
}

function payout_contract_type(?string $value): string
{
    $raw = trim((string)$value);
    if ($raw === '') {
        return '';
    }
    $normalized = strtoupper(str_replace([' ', '-', '_', '.', '/'], '', $raw));
    if (strpos($normalized, 'HPP') !== false) return 'HPP';
    if (strpos($normalized, 'DPP') !== false) return 'DPP';
    if (strpos($normalized, 'DPC') !== false) return 'DPC';
    if (strpos($normalized, 'ZIVNOST') !== false || strpos($normalized, 'ZL') !== false || strpos($normalized, 'ICO') !== false) return 'Zivnost';
    return substr(strtoupper($raw), 0, 40);
}

function payout_current_net(int $month, int $year, array $user, int $employeeId): float
{
    foreach (array_merge(payout_rows($month, $year, $user), payroll_stavba_rows($month, $year, $user, true)) as $row) {
        if ((int)$row['employee_id'] === $employeeId) {
            return (float)$row['net'];
        }
    }
    return 0.0;
}

function payout_cash_remainder(int $month, int $year, array $user, int $employeeId, float $cardAmount, ?float $insuranceAmount = null, float $debtAmount = 0.0): float
{
    foreach (array_merge(payout_rows($month, $year, $user), payroll_stavba_rows($month, $year, $user, true)) as $row) {
        if ((int)$row['employee_id'] === $employeeId) {
            $net = (float)$row['net'];
            if ($insuranceAmount !== null) {
                $net = round($net - (float)($row['insurance_amount'] ?? 0) + $insuranceAmount, 2);
            }
            return max(0.0, round($net - $cardAmount - $debtAmount, 2));
        }
    }
    return 0.0;
}

function payout_carry_debt(array $user, int $employeeId, int $month, int $year, float $net, float $cardAmount, float $cashAmount, float $debtAmount, ?string $debtNote): void
{
    if ($debtAmount <= 0) {
        return;
    }
    $withheld = max(0.0, round($net - $cardAmount - $cashAmount, 2));
    $unpaid = max(0.0, round($debtAmount - $withheld, 2));
    if ($unpaid <= 0) {
        return;
    }
    $nextMonth = $month === 12 ? 1 : $month + 1;
    $nextYear = $month === 12 ? $year + 1 : $year;
    $stmt = db()->prepare('INSERT INTO payouts (employee_id,month,year,debt_amount,debt_note,debt_carried_over,created_by) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE debt_amount=VALUES(debt_amount), debt_note=VALUES(debt_note), debt_carried_over=1, created_by=VALUES(created_by), deleted_at=NULL, deleted_by=NULL');
    $stmt->execute([$employeeId, $nextMonth, $nextYear, $unpaid, $debtNote, 1, (int)$user['id']]);
}

if ($method === 'GET' && ($parts[1] ?? '') === 'print') {
    $user = require_permission('payouts.view');
    $month = (int)($_GET['month'] ?? date('n'));
    $year = (int)($_GET['year'] ?? date('Y'));
    $rows = array_merge(payout_rows($month, $year, $user), payroll_stavba_rows($month, $year, $user, true));
    $totals = payroll_totals($rows, ['payable_hours', 'gross', 'bonus_amount', 'deduction_amount', 'advances', 'housing', 'insurance_amount', 'net', 'card_amount', 'cash_amount', 'debt_amount', 'remains']);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>Vyplaty ' . htmlspecialchars((string)$month) . '/' . htmlspecialchars((string)$year) . '</title>';
    echo '<style>body{font:12px Arial,sans-serif;color:#111;margin:18px}h1{margin:0 0 5px;font-size:18px}.meta{color:#555;margin-bottom:10px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:5px;text-align:left;vertical-align:top}th{background:#eee;font-size:10px}.num{text-align:right;white-space:nowrap}.sign{height:30px}@media print{button{display:none}body{margin:8mm}}</style></head><body>';
    echo '<button onclick="window.print()">Tisk</button><h1>Vyplatni listina</h1><div class="meta">Obdobi: ' . htmlspecialchars((string)$month) . '/' . htmlspecialchars((string)$year) . ' | Vytvoreno: ' . date('d.m.Y H:i') . '</div>';
    echo '<table><thead><tr><th>Zamestnanec</th><th class="num">Hodiny</th><th class="num">Sazba</th><th class="num">Bonusy</th><th class="num">Zalohy</th><th class="num">Bydleni</th><th class="num">Pojisteni bonus</th><th class="num">K vyplate</th><th class="num">Karta</th><th class="num">Hotovost</th><th class="num">Dluh</th><th class="num">Zustava</th><th>Podpis</th></tr></thead><tbody>';
    foreach ($rows as $row) {
        echo '<tr><td>' . htmlspecialchars((string)$row['employee_name']) . '<br><small>' . htmlspecialchars((string)($row['bank_account'] ?? '')) . '</small></td><td class="num">' . number_format((float)$row['payable_hours'], 2, ',', ' ') . '</td><td class="num">' . number_format((float)$row['hourly_rate'], 2, ',', ' ') . '</td><td class="num">' . number_format((float)$row['bonus_amount'] - (float)$row['deduction_amount'], 2, ',', ' ') . '</td><td class="num">' . number_format((float)$row['advances'], 2, ',', ' ') . '</td><td class="num">' . number_format((float)$row['housing'], 2, ',', ' ') . '</td><td class="num">' . number_format((float)($row['insurance_amount'] ?? 0), 2, ',', ' ') . '</td><td class="num">' . number_format((float)$row['net'], 2, ',', ' ') . '</td><td class="num">' . number_format((float)$row['card_amount'], 2, ',', ' ') . '</td><td class="num">' . number_format((float)$row['cash_amount'], 2, ',', ' ') . '</td><td class="num">' . number_format((float)($row['debt_amount'] ?? 0), 2, ',', ' ') . '</td><td class="num">' . number_format((float)$row['remains'], 2, ',', ' ') . '</td><td class="sign"></td></tr>';
    }
    echo '</tbody><tfoot><tr><th>Celkem</th><th class="num">' . number_format($totals['payable_hours'], 2, ',', ' ') . '</th><th></th><th class="num">' . number_format($totals['bonus_amount'] - $totals['deduction_amount'], 2, ',', ' ') . '</th><th class="num">' . number_format($totals['advances'], 2, ',', ' ') . '</th><th class="num">' . number_format($totals['housing'], 2, ',', ' ') . '</th><th class="num">' . number_format($totals['insurance_amount'], 2, ',', ' ') . '</th><th class="num">' . number_format($totals['net'], 2, ',', ' ') . '</th><th class="num">' . number_format($totals['card_amount'], 2, ',', ' ') . '</th><th class="num">' . number_format($totals['cash_amount'], 2, ',', ' ') . '</th><th class="num">' . number_format((float)($totals['debt_amount'] ?? 0), 2, ',', ' ') . '</th><th class="num">' . number_format($totals['remains'], 2, ',', ' ') . '</th><th></th></tr></tfoot></table></body></html>';
    exit;
}

if ($method === 'GET') {
    $user = require_permission('payouts.view');
    $month = (int)($_GET['month'] ?? date('n'));
    $year = (int)($_GET['year'] ?? date('Y'));
    $rows = payout_rows($month, $year, $user);
    $stavbaRows = payroll_stavba_rows($month, $year, $user, true);
    $totals = payroll_totals($rows, ['payable_hours', 'gross', 'bonus_amount', 'deduction_amount', 'advances', 'housing', 'insurance_amount', 'net', 'card_amount', 'cash_amount', 'debt_amount', 'remains']);
    $stavbaTotals = payroll_totals($stavbaRows, ['checkin_hours', 'timesheet_hours', 'manual_hours', 'payable_hours', 'gross', 'bonus_amount', 'deduction_amount', 'advances', 'housing', 'insurance_amount', 'net', 'card_amount', 'cash_amount', 'debt_amount', 'remains']);
    json_response(['ok' => true, 'data' => $rows, 'totals' => $totals, 'stavba' => $stavbaRows, 'stavba_totals' => $stavbaTotals]);
}

if ($method === 'POST') {
    $user = require_permission('payouts.write');
    $data = read_json();
    require_fields($data, ['employee_id', 'month', 'year']);
    $employeeId = (int)$data['employee_id'];
    $month = (int)$data['month'];
    $year = (int)$data['year'];
    require_employee_access($user, $employeeId);
    $employee = payout_employee($employeeId);
    $adjustmentEmail = payout_adjustment_email($employee, $month, $year);
    $bonusAmount = money_value($data, 'bonus_amount');
    $deductionAmount = money_value($data, 'deduction_amount');
    $cardAmount = money_value($data, 'card_amount');
    $cashAmount = money_value($data, 'cash_amount');
    $insuranceAmount = money_value($data, 'insurance_amount');
    $debtAmount = money_value($data, 'debt_amount');
    $debtNote = nullable_string($data, 'debt_note');
    $socialPaid = !empty($data['social_paid']) ? 1 : 0;
    $healthPaid = !empty($data['health_paid']) ? 1 : 0;
    $hourlyRate = money_value($data, 'hourly_rate') ?: round((float)($employee['hourly_rate'] ?? 0), 2);
    $contractType = payout_contract_type($employee['contract_type'] ?? null);

    db()->beginTransaction();
    try {
        $adjustment = db()->prepare('INSERT INTO rohlik_brno_adjustments (month,year,email,employee_id,full_name,contract_type,hourly_rate,advance_amount,bonus_amount,deduction_amount,card_amount,cash_amount,note,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE employee_id=VALUES(employee_id), full_name=VALUES(full_name), contract_type=VALUES(contract_type), hourly_rate=IF(VALUES(hourly_rate) > 0, VALUES(hourly_rate), hourly_rate), bonus_amount=VALUES(bonus_amount), deduction_amount=VALUES(deduction_amount), card_amount=VALUES(card_amount), cash_amount=VALUES(cash_amount), updated_by=VALUES(updated_by)');
        $adjustment->execute([
            $month,
            $year,
            $adjustmentEmail,
            $employeeId,
            $employee['name'] ?? null,
            $contractType,
            $hourlyRate,
            0,
            $bonusAmount,
            $deductionAmount,
            $cardAmount,
            $cashAmount,
            null,
            (int)$user['id'],
        ]);

        if (array_key_exists('housing', $data)) {
            $housing = db()->prepare('INSERT INTO housing (employee_id,month,year,amount) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE amount=VALUES(amount)');
            $housing->execute([$employeeId, $month, $year, money_value($data, 'housing')]);
        }

        if (!empty($data['auto_cash'])) {
            $cashAmount = payout_cash_remainder($month, $year, $user, $employeeId, $cardAmount, $insuranceAmount, $debtAmount);
            $syncAdjustment = db()->prepare('UPDATE rohlik_brno_adjustments SET card_amount = ?, cash_amount = ?, updated_by = ? WHERE month = ? AND year = ? AND email = ?');
            $syncAdjustment->execute([$cardAmount, $cashAmount, (int)$user['id'], $month, $year, $adjustmentEmail]);
        }

        $stmt = db()->prepare('INSERT INTO payouts (employee_id,month,year,card_amount,cash_amount,insurance_amount,debt_amount,debt_note,debt_carried_over,social_paid,health_paid,paid_at,note,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE card_amount=VALUES(card_amount), cash_amount=VALUES(cash_amount), insurance_amount=VALUES(insurance_amount), debt_amount=VALUES(debt_amount), debt_note=VALUES(debt_note), debt_carried_over=IF(debt_carried_over=1, 1, VALUES(debt_carried_over)), social_paid=VALUES(social_paid), health_paid=VALUES(health_paid), paid_at=VALUES(paid_at), note=VALUES(note), created_by=VALUES(created_by), deleted_at=NULL, deleted_by=NULL');
        $stmt->execute([
            $employeeId,
            $month,
            $year,
            $cardAmount,
            $cashAmount,
            $insuranceAmount,
            $debtAmount,
            $debtNote,
            !empty($data['debt_carried_over']) ? 1 : 0,
            $socialPaid,
            $healthPaid,
            date_or_null($data, 'paid_at'),
            nullable_string($data, 'note'),
            (int)$user['id'],
        ]);
        $netAfterSave = payout_current_net($month, $year, $user, $employeeId);
        payout_carry_debt($user, $employeeId, $month, $year, $netAfterSave, $cardAmount, $cashAmount, $debtAmount, $debtNote);
        db()->commit();
    } catch (Throwable $e) {
        db()->rollBack();
        throw $e;
    }
    audit_log($user, 'UPSERT', 'payouts', null, $data);
    json_response(['ok' => true]);
}

if ($method === 'DELETE' && $id) {
    $user = require_permission('payouts.write');
    if (!has_global_scope($user)) {
        json_response(['ok' => false, 'error' => 'Permission denied'], 403);
    }
    $stmt = db()->prepare('SELECT * FROM payouts WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $old = $stmt->fetch();
    if (!$old) {
        json_response(['ok' => false, 'error' => 'Payout not found'], 404);
    }
    db()->prepare('UPDATE payouts SET deleted_at = NOW(), deleted_by = ? WHERE id = ?')->execute([(int)$user['id'], $id]);
    audit_log($user, 'SOFT_DELETE', 'payouts', $id, ['deleted' => true], $old);
    json_response(['ok' => true]);
}

json_response(['ok' => false, 'error' => 'Payouts route not found'], 404);

