<?php
declare(strict_types=1);

$method = request_method();
$parts = explode('/', request_path());
$action = $parts[1] ?? '';
$sub = $parts[2] ?? '';

function salary_money(float $value): string
{
    return number_format($value, 2, ',', ' ') . ' Kc';
}

function salary_num(float $value): string
{
    return number_format($value, 2, ',', ' ');
}

function salary_print_css(): string
{
    return 'body{font:12px Arial,sans-serif;color:#111;margin:18px}button{margin-bottom:10px}h1{margin:0 0 5px;font-size:18px}h2{margin:14px 0 6px;font-size:14px}.meta{color:#555;margin-bottom:10px}.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin:10px 0}.box{border:1px solid #999;padding:6px}.box span{display:block;color:#666;font-size:9px;text-transform:uppercase}.box strong{display:block;font-size:13px;margin-top:3px}table{width:100%;border-collapse:collapse;margin-top:6px}th,td{border:1px solid #999;padding:5px;text-align:left;vertical-align:top}th{background:#eee;font-size:10px}.num{text-align:right;white-space:nowrap}.sign{height:30px}@media print{button{display:none}body{margin:8mm}.grid{break-inside:avoid}}';
}

function salary_print_header(string $title, int $month, int $year): void
{
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>' . htmlspecialchars($title) . '</title>';
    echo '<style>' . salary_print_css() . '</style></head><body>';
    echo '<button onclick="window.print()">Tisk</button>';
    echo '<h1>' . htmlspecialchars($title) . '</h1>';
    echo '<div class="meta">Obdobi: ' . htmlspecialchars((string)$month) . '/' . htmlspecialchars((string)$year) . ' | Vytvoreno: ' . date('d.m.Y H:i') . '</div>';
}

function salary_print_box(string $label, string $value): string
{
    return '<div class="box"><span>' . htmlspecialchars($label) . '</span><strong>' . htmlspecialchars($value) . '</strong></div>';
}

function salary_print_person(array $row, int $month, int $year): void
{
    header('Content-Type: text/html; charset=utf-8');
    $name = strtoupper((string)($row['employee_name'] ?? '-'));
    $hours = (float)($row['payable_hours'] ?? 0);
    $rawHours = (float)($row['raw_hours'] ?? $hours);
    $deductPct = (float)($row['hour_deduction_pct'] ?? 0);
    $gross = (float)($row['gross'] ?? 0);
    $net = (float)($row['net'] ?? $gross);
    $card = (float)($row['card_amount'] ?? 0);
    $cash = (float)($row['cash_amount'] ?? 0);
    $housing = (float)($row['housing'] ?? 0);
    $advances = (float)($row['advances'] ?? 0);
    $debt = (float)($row['debt_amount'] ?? 0);
    $bonus = (float)($row['bonus_amount'] ?? 0);
    $deduction = (float)($row['deduction_amount'] ?? 0);
    $insurance = (float)($row['insurance_amount'] ?? 0);
    $remains = round($net - $card - $cash - $debt, 2);
    $hoursNote = salary_num($hours) . ' h';
    if ($deductPct > 0) {
        $hoursNote .= ' <small>(brutto ' . salary_num($rawHours) . ' h, srazka -' . salary_num($deductPct) . '%)</small>';
    }
    $lines = [];
    if ($card > 0) $lines[] = ['Karta', salary_money($card)];
    if ($cash > 0) $lines[] = ['Hotovost', salary_money($cash)];
    if ($bonus > 0) $lines[] = ['Bonus', '+' . salary_money($bonus)];
    if ($insurance > 0) $lines[] = ['Bonus pojisteni', '+' . salary_money($insurance)];
    if ($deduction > 0) $lines[] = ['Srazka', '-' . salary_money($deduction)];
    if ($housing > 0) $lines[] = ['Bydleni', '-' . salary_money($housing)];
    if ($advances > 0) $lines[] = ['Zalohy', '-' . salary_money($advances)];
    if ($debt > 0) $lines[] = ['Dluh', '-' . salary_money($debt)];

    echo '<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>' . htmlspecialchars($name) . '</title>';
    echo '<style>@page{size:DL landscape;margin:7mm}body{font:12px Arial,sans-serif;color:#111;margin:0;padding:12px;max-width:360px}button{margin-bottom:8px}h1{font-size:16px;font-weight:900;border-bottom:2px solid #111;padding-bottom:6px;margin:0 0 8px}table{width:100%;border-collapse:collapse}td{padding:4px 0;border-bottom:1px solid #eee}td:last-child{text-align:right}.total{border-top:2px solid #111;font-size:14px;font-weight:800}.total td{padding-top:7px;border-bottom:0}small{font-size:9px;color:#777}@media print{button{display:none}body{padding:0}}</style>';
    echo '</head><body><button onclick="window.print()">Tisk</button><h1>' . htmlspecialchars($name) . '</h1><table>';
    echo '<tr><td>Hodiny</td><td>' . $hoursNote . '</td></tr>';
    echo '<tr><td>Hrube</td><td><strong>' . htmlspecialchars(salary_money($gross)) . '</strong></td></tr>';
    echo '<tr><td>Celkem k vyplate</td><td><strong>' . htmlspecialchars(salary_money($net)) . '</strong></td></tr>';
    echo '<tr><td colspan="2"><hr style="border:none;border-top:1px dashed #ccc;margin:6px 0"></td></tr>';
    foreach ($lines as $line) {
        echo '<tr><td>' . htmlspecialchars($line[0]) . '</td><td><strong>' . htmlspecialchars($line[1]) . '</strong></td></tr>';
    }
    echo '<tr class="total"><td>Zustatek</td><td>' . htmlspecialchars(salary_money($remains)) . '</td></tr>';
    echo '</table></body></html>';
    exit;
}

function salary_print_all(array $rows, array $totals, int $month, int $year): void
{
    salary_print_header('Vyplatni souhrn', $month, $year);
    echo '<div class="grid">';
    echo salary_print_box('Hrube', salary_money((float)$totals['gross']));
    echo salary_print_box('Bonusy', salary_money((float)$totals['bonus_amount']));
    echo salary_print_box('Srazky', salary_money((float)$totals['deduction_amount']));
    echo salary_print_box('Zalohy', salary_money((float)$totals['advances']));
    echo salary_print_box('Bydleni', salary_money((float)$totals['housing']));
    echo salary_print_box('Bonus pojisteni', salary_money((float)($totals['insurance_amount'] ?? 0)));
    echo salary_print_box('Final k vyplate', salary_money((float)$totals['net']));
    echo salary_print_box('Odeslat na kartu', salary_money((float)$totals['card_amount']));
    echo salary_print_box('Hotovost', salary_money((float)$totals['cash_amount']));
    echo salary_print_box('Dluh', salary_money((float)($totals['debt_amount'] ?? 0)));
    echo salary_print_box('Zustava', salary_money((float)$totals['remains']));
    echo '</div>';
    echo '<h2>Pracovnici</h2>';
    echo '<table><thead><tr><th>Pracovnik</th><th class="num">Hodiny</th><th class="num">Sazba</th><th class="num">Hrube</th><th class="num">Bonusy</th><th class="num">Srazky</th><th class="num">Zalohy</th><th class="num">Bydleni</th><th class="num">Pojisteni bonus</th><th class="num">K vyplate</th><th class="num">Karta</th><th class="num">Hotovost</th><th class="num">Dluh</th><th class="num">Zustava</th></tr></thead><tbody>';
    foreach ($rows as $row) {
        echo '<tr><td>' . htmlspecialchars((string)$row['employee_name']) . '<br><small>' . htmlspecialchars((string)($row['bank_account'] ?? '')) . '</small></td>';
        echo '<td class="num">' . salary_num((float)$row['payable_hours']) . '</td>';
        echo '<td class="num">' . salary_money((float)$row['hourly_rate']) . '</td>';
        echo '<td class="num">' . salary_money((float)$row['gross']) . '</td>';
        echo '<td class="num">' . salary_money((float)$row['bonus_amount']) . '</td>';
        echo '<td class="num">' . salary_money((float)$row['deduction_amount']) . '</td>';
        echo '<td class="num">' . salary_money((float)$row['advances']) . '</td>';
        echo '<td class="num">' . salary_money((float)$row['housing']) . '</td>';
        echo '<td class="num">' . salary_money((float)($row['insurance_amount'] ?? 0)) . '</td>';
        echo '<td class="num">' . salary_money((float)$row['net']) . '</td>';
        echo '<td class="num">' . salary_money((float)($row['card_amount'] ?? 0)) . '</td>';
        echo '<td class="num">' . salary_money((float)($row['cash_amount'] ?? 0)) . '</td>';
        echo '<td class="num">' . salary_money((float)($row['debt_amount'] ?? 0)) . '</td>';
        echo '<td class="num">' . salary_money((float)($row['remains'] ?? 0)) . '</td></tr>';
    }
    echo '</tbody><tfoot><tr><th>Celkem</th><th class="num">' . salary_num((float)($totals['payable_hours'] ?? 0)) . '</th><th></th><th class="num">' . salary_money((float)$totals['gross']) . '</th><th class="num">' . salary_money((float)$totals['bonus_amount']) . '</th><th class="num">' . salary_money((float)$totals['deduction_amount']) . '</th><th class="num">' . salary_money((float)$totals['advances']) . '</th><th class="num">' . salary_money((float)$totals['housing']) . '</th><th class="num">' . salary_money((float)($totals['insurance_amount'] ?? 0)) . '</th><th class="num">' . salary_money((float)$totals['net']) . '</th><th class="num">' . salary_money((float)$totals['card_amount']) . '</th><th class="num">' . salary_money((float)$totals['cash_amount']) . '</th><th class="num">' . salary_money((float)($totals['debt_amount'] ?? 0)) . '</th><th class="num">' . salary_money((float)$totals['remains']) . '</th></tr></tfoot></table></body></html>';
    exit;
}

$user = require_permission('salary.view');
$month = (int)($_GET['month'] ?? date('n'));
$year = (int)($_GET['year'] ?? date('Y'));

if ($method === 'GET' && $action === 'print') {
    $rows = payroll_rows($month, $year, $user, true);
    $rows = array_merge($rows, payroll_stavba_rows($month, $year, $user, true));
    $totals = payroll_totals($rows, ['payable_hours', 'gross', 'bonus_amount', 'deduction_amount', 'advances', 'housing', 'insurance_amount', 'net', 'card_amount', 'cash_amount', 'debt_amount', 'remains']);
    salary_print_all($rows, $totals, $month, $year);
}

if ($method === 'GET' && is_numeric($action) && $sub === 'print') {
    $employeeId = (int)$action;
    $rows = array_merge(payroll_rows($month, $year, $user, true), payroll_stavba_rows($month, $year, $user, true));
    foreach ($rows as $row) {
        if ((int)$row['employee_id'] === $employeeId) {
            salary_print_person($row, $month, $year);
        }
    }
    json_response(['ok' => false, 'error' => 'Employee salary row not found'], 404);
}

$rows = payroll_rows($month, $year, $user, true);
$stavbaRows = payroll_stavba_rows($month, $year, $user, true);
$totals = payroll_totals($rows, ['hours', 'bonus_hours', 'raw_hours', 'payable_hours', 'gross', 'bonus_amount', 'deduction_amount', 'advances', 'housing', 'insurance_amount', 'net', 'card_amount', 'cash_amount', 'debt_amount', 'remains']);
$stavbaTotals = payroll_totals($stavbaRows, ['checkin_hours', 'timesheet_hours', 'manual_hours', 'raw_hours', 'payable_hours', 'gross', 'bonus_amount', 'deduction_amount', 'advances', 'housing', 'insurance_amount', 'net', 'card_amount', 'cash_amount', 'debt_amount', 'remains']);

json_response(['ok' => true, 'data' => $rows, 'totals' => $totals, 'stavba' => $stavbaRows, 'stavba_totals' => $stavbaTotals]);
