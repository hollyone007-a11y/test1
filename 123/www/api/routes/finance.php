<?php
declare(strict_types=1);

$method = request_method();
$parts = explode('/', request_path());
$action = $parts[1] ?? 'summary';
$id = isset($parts[2]) && is_numeric($parts[2]) ? (int)$parts[2] : null;

function finance_money(float $value): string
{
    return number_format($value, 2, ',', ' ') . ' Kc';
}

function finance_scope(array $user, string $column = 'company_id'): array
{
    if (!has_global_scope($user)) {
        json_response(['ok' => false, 'error' => 'Permission denied'], 403);
    }
    $companyId = (int)($_GET['company_id'] ?? 0);
    return [$companyId > 0 ? " AND $column = ?" : '', $companyId > 0 ? [$companyId] : [], $companyId ?: null];
}

function finance_period(): array
{
    return [(int)($_GET['month'] ?? date('n')), (int)($_GET['year'] ?? date('Y'))];
}

function finance_summary_payload(array $user, int $month, int $year): array
{
    [, , $companyId] = finance_scope($user);
    $salaryRows = payroll_rows($month, $year, $user, true);
    $stavbaRows = payroll_stavba_rows($month, $year, $user, true);
    $allRows = array_merge($salaryRows, $stavbaRows);
    if ($companyId) {
        $allRows = array_values(array_filter($allRows, static fn(array $row): bool => (int)($row['company_id'] ?? 0) === $companyId));
    }
    $paidInsuranceTotal = 0.0;
    $salaryPaidTotal = 0.0;
    $salaryOpenTotal = 0.0;
    foreach ($allRows as $row) {
        if (!empty($row['health_paid']) || !empty($row['social_paid'])) {
            $paidInsuranceTotal += (float)($row['insurance_amount'] ?? 0);
        }
        $paid = (float)($row['card_amount'] ?? 0) + (float)($row['cash_amount'] ?? 0);
        $salaryPaidTotal += $paid;
        $salaryOpenTotal += max(0.0, (float)($row['net'] ?? 0) - $paid - (float)($row['debt_amount'] ?? 0));
    }
    $auto = [
        'salary_total' => round($salaryPaidTotal, 2),
        'salary_open_total' => round($salaryOpenTotal, 2),
        'salary_gross_total' => payroll_totals($allRows, ['gross'])['gross'] ?? 0,
        'salary_net_total' => payroll_totals($allRows, ['net'])['net'] ?? 0,
        'insurance_total' => round($paidInsuranceTotal, 2),
        'debt_total' => payroll_totals($allRows, ['debt_amount'])['debt_amount'] ?? 0,
    ];

    [$expenseScopeSql, $expenseScopeParams] = finance_scope($user, 'company_expenses.company_id');
    $expenseStmt = db()->prepare("SELECT * FROM company_expenses WHERE month = ? AND year = ? AND deleted_at IS NULL $expenseScopeSql ORDER BY is_auto DESC, category, id DESC");
    $expenseStmt->execute(array_merge([$month, $year], $expenseScopeParams));
    $expenses = $expenseStmt->fetchAll();

    [$revenueScopeSql, $revenueScopeParams] = finance_scope($user, 'cr.company_id');
    $revenueStmt = db()->prepare("SELECT cr.*, e.name AS employee_name FROM company_revenues cr LEFT JOIN employees e ON e.id = cr.source_id WHERE cr.month = ? AND cr.year = ? AND cr.deleted_at IS NULL $revenueScopeSql ORDER BY cr.id DESC");
    $revenueStmt->execute(array_merge([$month, $year], $revenueScopeParams));
    $revenues = $revenueStmt->fetchAll();

    $manualExpenseTotal = array_reduce($expenses, static fn(float $sum, array $row): float => $sum + (float)$row['amount'], 0.0);
    $revenueTotal = array_reduce($revenues, static fn(float $sum, array $row): float => $sum + (float)$row['billed_amount'], 0.0);
    $revenueCosts = array_reduce($revenues, static fn(float $sum, array $row): float => $sum + (float)$row['cost_amount'], 0.0);
    $expenseTotal = round($manualExpenseTotal + (float)$auto['salary_total'] + (float)$auto['insurance_total'] + $revenueCosts, 2);

    $margins = [];
    foreach ($revenues as $revenue) {
        $key = (string)($revenue['source_id'] ?: 'manual-' . $revenue['id']);
        if (!isset($margins[$key])) {
            $margins[$key] = [
                'employee_name' => $revenue['employee_name'] ?: ($revenue['label'] ?: 'Manual'),
                'billed_amount' => 0.0,
                'total_cost' => 0.0,
            ];
        }
        $margins[$key]['billed_amount'] += (float)$revenue['billed_amount'];
        $margins[$key]['total_cost'] += (float)$revenue['cost_amount'];
    }
    if ((float)$auto['salary_total'] > 0) {
        $margins['auto-salary'] = [
            'employee_name' => 'Mzdy vyplacene automaticky',
            'billed_amount' => 0.0,
            'total_cost' => (float)$auto['salary_total'],
        ];
    }

    return [
        'ok' => true,
        'month' => $month,
        'year' => $year,
        'auto' => $auto,
        'expenses' => $expenses,
        'revenues' => $revenues,
        'employee_margins' => array_values($margins),
        'totals' => [
            'revenues' => round($revenueTotal, 2),
            'expenses' => $expenseTotal,
            'profit' => round($revenueTotal - $expenseTotal, 2),
        ],
    ];
}

$user = require_permission('finance.view');
[$month, $year] = finance_period();

if ($method === 'GET' && ($action === '' || $action === 'summary')) {
    json_response(finance_summary_payload($user, $month, $year));
}

if ($method === 'GET' && $action === 'pdf') {
    $payload = finance_summary_payload($user, $month, $year);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>Naklady / Prijmy</title><style>body{font:13px Arial,sans-serif;margin:28px;color:#111}button{margin-bottom:12px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #999;padding:7px;text-align:left}.num{text-align:right}th{background:#eee}@media print{button{display:none}}</style></head><body>';
    echo '<button onclick="window.print()">Tisk</button><h1>Naklady / Prijmy ' . htmlspecialchars((string)$month) . '/' . htmlspecialchars((string)$year) . '</h1>';
    echo '<p>Prijmy: <strong>' . finance_money((float)$payload['totals']['revenues']) . '</strong> | Naklady: <strong>' . finance_money((float)$payload['totals']['expenses']) . '</strong> | Profit: <strong>' . finance_money((float)$payload['totals']['profit']) . '</strong></p>';
    echo '<p>Automaticky zapocteno: vyplacene mzdy <strong>' . finance_money((float)$payload['auto']['salary_total']) . '</strong>, zaplacene odvody/pojisteni <strong>' . finance_money((float)$payload['auto']['insurance_total']) . '</strong>, jeste otevrene mzdy <strong>' . finance_money((float)$payload['auto']['salary_open_total']) . '</strong>.</p>';
    echo '<h2>Naklady</h2><table><tr><th>Kategorie</th><th>Popis</th><th class="num">Castka</th></tr>';
    foreach ($payload['expenses'] as $expense) {
        echo '<tr><td>' . htmlspecialchars((string)$expense['category']) . '</td><td>' . htmlspecialchars((string)($expense['label'] ?? '')) . '</td><td class="num">' . finance_money((float)$expense['amount']) . '</td></tr>';
    }
    echo '</table><h2>Prijmy</h2><table><tr><th>Popis</th><th class="num">Fakturovano</th><th class="num">Naklad</th></tr>';
    foreach ($payload['revenues'] as $revenue) {
        echo '<tr><td>' . htmlspecialchars((string)($revenue['label'] ?: $revenue['employee_name'] ?: '-')) . '</td><td class="num">' . finance_money((float)$revenue['billed_amount']) . '</td><td class="num">' . finance_money((float)$revenue['cost_amount']) . '</td></tr>';
    }
    echo '</table><h2>Uctenky</h2>';
    $receipts = array_values(array_filter($payload['expenses'], static fn(array $expense): bool => trim((string)($expense['receipt_path'] ?? '')) !== ''));
    if (!$receipts) {
        echo '<p>Bez nahranych uctenek.</p>';
    }
    foreach ($receipts as $expense) {
        $path = (string)$expense['receipt_path'];
        $publicPath = '/' . ltrim($path, '/');
        $title = trim((string)($expense['label'] ?? '')) ?: (string)$expense['category'];
        echo '<section style="page-break-before:always"><h3>' . htmlspecialchars($title) . ' - ' . finance_money((float)$expense['amount']) . '</h3>';
        if (preg_match('/\.(jpe?g|png|gif|webp)$/i', $path)) {
            echo '<img src="' . htmlspecialchars($publicPath) . '" style="max-width:100%;max-height:250mm;object-fit:contain">';
        } else {
            echo '<p><a href="' . htmlspecialchars($publicPath) . '">Otevrit uctenku</a></p>';
        }
        echo '</section>';
    }
    echo '</body></html>';
    exit;
}

if ($method === 'POST' && $action === 'expenses') {
    $user = require_permission('finance.write');
    [, , $companyId] = finance_scope($user);
    $data = read_json();
    $stmt = db()->prepare('INSERT INTO company_expenses (company_id,month,year,category,label,amount,notes,is_recurring,created_by) VALUES (?,?,?,?,?,?,?,?,?)');
    $stmt->execute([$companyId, $month, $year, first_string($data, 'category', 80) ?: 'other', nullable_string($data, 'label', 255), money_value($data, 'amount'), nullable_string($data, 'notes'), !empty($data['is_recurring']) ? 1 : 0, (int)$user['id']]);
    audit_log($user, 'CREATE', 'company_expenses', (int)db()->lastInsertId(), $data);
    json_response(['ok' => true]);
}

if ($method === 'DELETE' && $action === 'expenses' && $id) {
    $user = require_permission('finance.write');
    $stmt = db()->prepare('SELECT * FROM company_expenses WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $old = $stmt->fetch();
    if (!$old) {
        json_response(['ok' => false, 'error' => 'Expense not found'], 404);
    }
    if ((int)($old['is_auto'] ?? 0) === 1) {
        json_response(['ok' => false, 'error' => 'Auto expense cannot be deleted'], 422);
    }
    db()->prepare('UPDATE company_expenses SET deleted_at = NOW(), deleted_by = ? WHERE id = ?')->execute([(int)$user['id'], $id]);
    audit_log($user, 'SOFT_DELETE', 'company_expenses', $id, ['deleted' => true], $old);
    json_response(['ok' => true]);
}

if ($method === 'POST' && $action === 'revenues') {
    $user = require_permission('finance.write');
    [, , $companyId] = finance_scope($user);
    $data = read_json();
    $sourceId = int_or_null($data, 'source_id');
    $stmt = db()->prepare('INSERT INTO company_revenues (company_id,month,year,source_type,source_id,label,billed_amount,cost_amount,notes,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)');
    $stmt->execute([$companyId, $month, $year, first_string($data, 'source_type', 40) ?: ($sourceId ? 'employee' : 'manual'), $sourceId, nullable_string($data, 'label', 255), money_value($data, 'billed_amount'), money_value($data, 'cost_amount'), nullable_string($data, 'notes'), (int)$user['id']]);
    audit_log($user, 'CREATE', 'company_revenues', (int)db()->lastInsertId(), $data);
    json_response(['ok' => true]);
}

json_response(['ok' => false, 'error' => 'Finance route not found'], 404);
