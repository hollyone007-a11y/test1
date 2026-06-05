<?php
declare(strict_types=1);

$user = require_permission('dashboard.view');
$month = (int)($_GET['month'] ?? date('n'));
$year = (int)($_GET['year'] ?? date('Y'));
[$scopeSql, $scopeParams] = current_employee_filter($user, 'e');

$stmt = db()->prepare("SELECT COUNT(*) FROM employees e WHERE e.status = 'active' $scopeSql");
$stmt->execute($scopeParams);
$employees = (int)$stmt->fetchColumn();

$salaryRows = payroll_rows($month, $year, $user, true);
$salaryTotals = payroll_totals($salaryRows, ['payable_hours', 'gross', 'bonus_amount', 'deduction_amount', 'advances', 'housing', 'insurance_amount', 'net', 'card_amount', 'cash_amount', 'debt_amount', 'remains']);
$stavbaRows = payroll_stavba_rows($month, $year, $user, true);
$stavbaTotals = payroll_totals($stavbaRows, ['payable_hours', 'gross', 'bonus_amount', 'deduction_amount', 'advances', 'housing', 'insurance_amount', 'net', 'card_amount', 'cash_amount', 'debt_amount', 'remains']);
$hours = round((float)$salaryTotals['payable_hours'] + (float)$stavbaTotals['payable_hours'], 2);
$advances = round((float)$salaryTotals['advances'] + (float)$stavbaTotals['advances'], 2);
$housing = round((float)$salaryTotals['housing'] + (float)$stavbaTotals['housing'], 2);

$cash = ['income' => 0.0, 'expense' => 0.0];
if (has_global_scope($user)) {
    $companyId = (int)($_GET['company_id'] ?? 0);
    $companySql = $companyId > 0 ? ' AND o.company_id = ?' : '';
    $stmt = db()->prepare("SELECT cr.type, COALESCE(SUM(cr.amount),0) AS total FROM cash_register cr LEFT JOIN objects o ON o.id = cr.object_id WHERE MONTH(cr.date) = ? AND YEAR(cr.date) = ? $companySql GROUP BY cr.type");
    $stmt->execute($companyId > 0 ? [$month, $year, $companyId] : [$month, $year]);
    foreach ($stmt->fetchAll() as $row) {
        $cash[$row['type']] = (float)$row['total'];
    }
}

$salaryNet = round((float)$salaryTotals['net'] + (float)$stavbaTotals['net'], 2);
$salaryGross = round((float)$salaryTotals['gross'] + (float)$stavbaTotals['gross'], 2);
$cardAmount = round((float)$salaryTotals['card_amount'] + (float)$stavbaTotals['card_amount'], 2);
$cashAmount = round((float)$salaryTotals['cash_amount'] + (float)$stavbaTotals['cash_amount'], 2);
$paidInsuranceTotal = 0.0;
foreach (array_merge($salaryRows, $stavbaRows) as $row) {
    if (!empty($row['health_paid']) || !empty($row['social_paid'])) {
        $paidInsuranceTotal += (float)($row['insurance_amount'] ?? 0);
    }
}
$salaryPaidExpense = round($cardAmount + $cashAmount + $paidInsuranceTotal, 2);
$debtAmount = round((float)$salaryTotals['debt_amount'] + (float)$stavbaTotals['debt_amount'], 2);
$debtNote = '';
foreach (array_merge($salaryRows, $stavbaRows) as $row) {
    if ((float)($row['debt_amount'] ?? 0) > 0 && trim((string)($row['debt_note'] ?? '')) !== '') {
        $debtNote = trim((string)$row['debt_note']);
        break;
    }
}
$remains = round((float)$salaryTotals['remains'] + (float)$stavbaTotals['remains'], 2);
$dashboardExpense = round((float)$cash['expense'] + $salaryPaidExpense, 2);
$dashboardProfit = (float)$cash['income'] > 0 ? round((float)$cash['income'] - $dashboardExpense, 2) : null;

$queue = ['timesheets' => [], 'documents' => [], 'checkins' => [], 'advances' => []];
if (has_global_scope($user)) {
    $stmt = db()->prepare("SELECT t.id, t.employee_id, t.work_date, t.work_start_at, t.work_end_at, t.month, t.year, t.hours, t.note, t.created_at, e.name AS employee_name, e.hourly_rate, u.name AS submitted_by_name
                           FROM timesheets t
                           JOIN employees e ON e.id = t.employee_id
                           LEFT JOIN users u ON u.id = t.submitted_by
                           WHERE t.status = 'pending' AND t.month = ? AND t.year = ? $scopeSql
                           ORDER BY t.work_date DESC, t.created_at DESC, e.name
                           LIMIT 12");
    $stmt->execute(array_merge([$month, $year], $scopeParams));
    $queue['timesheets'] = $stmt->fetchAll();

    $stmt = db()->prepare("SELECT d.id, d.employee_id, d.document_type, d.title, d.original_name, d.expires_at, d.note, d.created_at, e.name AS employee_name, u.name AS uploaded_by_name
                           FROM employee_documents d
                           JOIN employees e ON e.id = d.employee_id
                           LEFT JOIN users u ON u.id = d.uploaded_by
                           WHERE d.status = 'pending' $scopeSql
                           ORDER BY d.created_at DESC
                           LIMIT 12");
    $stmt->execute($scopeParams);
    $queue['documents'] = $stmt->fetchAll();

    $stmt = db()->prepare("SELECT c.id, c.employee_id, c.object_id, c.time_in, c.time_out, c.duration_hours, c.lat, c.lng, c.location_accuracy, c.location_captured_at, c.last_seen_at, c.location_name, c.note, c.created_at, e.name AS employee_name, o.name AS object_name
                           FROM checkins c
                           JOIN employees e ON e.id = c.employee_id
                           LEFT JOIN objects o ON o.id = c.object_id
                           WHERE c.status = 'pending' $scopeSql
                           ORDER BY (c.time_out IS NULL) DESC, c.time_in DESC
                           LIMIT 12");
    $stmt->execute($scopeParams);
    $queue['checkins'] = $stmt->fetchAll();

    $stmt = db()->prepare("SELECT a.id, a.employee_id, a.amount, a.date, a.note, a.created_at, e.name AS employee_name, u.name AS created_by_name
                           FROM advances a
                           JOIN employees e ON e.id = a.employee_id
                           LEFT JOIN users u ON u.id = a.created_by
                           WHERE a.status = 'pending' AND a.month = ? AND a.year = ? $scopeSql
                           ORDER BY a.created_at DESC
                           LIMIT 12");
    $stmt->execute(array_merge([$month, $year], $scopeParams));
    $queue['advances'] = $stmt->fetchAll();
}

json_response([
    'ok' => true,
    'data' => [
        'employees' => $employees,
        'hours' => $hours,
        'advances' => $advances,
        'housing' => $housing,
        'cash_income' => $cash['income'],
        'cash_expense' => $cash['expense'],
        'cash_balance' => $cash['income'] - $cash['expense'],
        'salary_net' => $salaryNet,
        'salary_paid_expense' => $salaryPaidExpense,
        'salary_gross' => $salaryGross,
        'salary_card' => $cardAmount,
        'salary_cash' => $cashAmount,
        'debt_amount' => $debtAmount,
        'debt_note' => $debtNote,
        'salary_remains' => $remains,
        'dashboard_income' => (float)$cash['income'],
        'dashboard_expense' => $dashboardExpense,
        'dashboard_profit' => $dashboardProfit,
        'dashboard_income_missing' => (float)$cash['income'] <= 0,
        'stavba_salary' => $stavbaTotals,
        'stavba_rows' => $stavbaRows,
        'queue' => $queue,
    ],
]);
