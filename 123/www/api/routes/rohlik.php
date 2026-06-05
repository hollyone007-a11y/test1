<?php
declare(strict_types=1);

$method = request_method();
$parts = explode('/', request_path());
$action = $parts[1] ?? 'summary';

const ROHLIK_SHEET_ID = '1KK6MldPNM3oCQ6rms0V7RT4beOo9i-Z6IoFG4o5B76I';
const ROHLIK_DAILY_GID = '444006528';
const ROHLIK_SUMA_GID = '1333031371';
const ROHLIK_CALC_VERSION = 'suma-20260601-0202';
const ROHLIK_COMPANY_NAME = 'ROSHPIT';
const ROHLIK_OBJECT_NAME = 'Rohlik Brno';

function rohlik_csv_url(): string
{
    return 'https://docs.google.com/spreadsheets/d/' . ROHLIK_SHEET_ID . '/export?format=csv&gid=' . ROHLIK_DAILY_GID;
}

function rohlik_suma_csv_url(): string
{
    return 'https://docs.google.com/spreadsheets/d/' . ROHLIK_SHEET_ID . '/export?format=csv&gid=' . ROHLIK_SUMA_GID;
}

function rohlik_decimal(?string $value): float
{
    $value = trim((string)$value);
    $value = str_replace(["\xc2\xa0", ' ', '%'], '', $value);
    $value = str_replace(',', '.', $value);
    return is_numeric($value) ? round((float)$value, 2) : 0.0;
}

function rohlik_contract_type(?string $value): string
{
    $raw = trim((string)$value);
    if ($raw === '') {
        return '';
    }
    $normalized = strtoupper(str_replace([' ', '-', '_', '.', '/'], '', $raw));
    if (strpos($normalized, 'HPP') !== false) {
        return 'HPP';
    }
    if (strpos($normalized, 'DPP') !== false) {
        return 'DPP';
    }
    if (strpos($normalized, 'DPC') !== false) {
        return 'DPC';
    }
    if (strpos($normalized, 'ZIVNOST') !== false || strpos($normalized, 'ZL') !== false || strpos($normalized, 'ICO') !== false) {
        return 'Zivnost';
    }
    return strtoupper($raw);
}

function rohlik_default_employer_health_amount(?string $contractType): float
{
    $type = rohlik_contract_type($contractType);
    if ($type === 'HPP') {
        return 11200.0;
    }
    if ($type === 'DPP' || $type === 'DPC') {
        return 3000.0;
    }
    return 0.0;
}

function rohlik_balance(float $net, float $card, float $cash): array
{
    $remains = round($net - $card - $cash, 2);
    if ($remains > 0) {
        return [
            'remains_amount' => $remains,
            'company_owes_amount' => $remains,
            'employee_owes_amount' => 0.0,
            'balance_status' => 'company_owes',
            'balance_label' => 'Doplatit',
        ];
    }
    if ($remains < 0) {
        return [
            'remains_amount' => $remains,
            'company_owes_amount' => 0.0,
            'employee_owes_amount' => abs($remains),
            'balance_status' => $net < 0 ? 'minus' : 'overpaid',
            'balance_label' => $net < 0 ? 'V minusu' : 'Preplaceno',
        ];
    }
    return [
        'remains_amount' => 0.0,
        'company_owes_amount' => 0.0,
        'employee_owes_amount' => 0.0,
        'balance_status' => 'settled',
        'balance_label' => 'Vyrovnano',
    ];
}

function rohlik_date(?string $value): ?string
{
    $value = trim((string)$value);
    if ($value === '') {
        return null;
    }
    $dt = DateTime::createFromFormat('j.n.Y', $value) ?: DateTime::createFromFormat('d.m.Y', $value) ?: DateTime::createFromFormat('Y-m-d', $value);
    return $dt ? $dt->format('Y-m-d') : null;
}

function rohlik_fetch_rows(): array
{
    $context = stream_context_create([
        'http' => [
            'timeout' => 20,
            'header' => "User-Agent: BuildPayRohlik/1.0\r\n",
        ],
    ]);
    $csv = file_get_contents(rohlik_csv_url(), false, $context);
    if ($csv === false || trim($csv) === '') {
        throw new RuntimeException('Rohlik Google Sheet is not available');
    }
    $rows = [];
    $handle = fopen('php://temp', 'r+');
    fwrite($handle, $csv);
    rewind($handle);
    $header = fgetcsv($handle, 0, ',');
    while (($row = fgetcsv($handle, 0, ',')) !== false) {
        $date = rohlik_date($row[0] ?? '');
        $email = strtolower(trim((string)($row[1] ?? '')));
        $supplier = trim((string)($row[2] ?? ''));
        if (!$date || $email === '' || strtoupper($supplier) !== ROHLIK_COMPANY_NAME) {
            continue;
        }
        $dt = new DateTime($date);
        $rows[] = [
            'work_date' => $date,
            'month' => (int)$dt->format('n'),
            'year' => (int)$dt->format('Y'),
            'email' => $email,
            'supplier' => $supplier,
            'attendance_hours' => rohlik_decimal($row[3] ?? null),
            'worked_hours' => rohlik_decimal($row[4] ?? null),
            'worked_percent' => rohlik_decimal($row[5] ?? null),
            'productivity_percent' => rohlik_decimal($row[6] ?? null),
            'efficiency_percent' => rohlik_decimal($row[7] ?? null),
            'billing_hours' => rohlik_decimal($row[8] ?? null),
            'extra_hours' => rohlik_decimal($row[9] ?? null),
            'position' => trim((string)($row[10] ?? '')),
            'total_worked_hours' => rohlik_decimal($row[11] ?? null),
            'rate_label' => trim((string)($row[12] ?? '')),
        ];
    }
    fclose($handle);
    return $rows;
}

function rohlik_fetch_suma_rows(int $month, int $year): array
{
    $context = stream_context_create([
        'http' => [
            'timeout' => 20,
            'header' => "User-Agent: BuildPayRohlik/1.0\r\n",
        ],
    ]);
    $csv = file_get_contents(rohlik_suma_csv_url(), false, $context);
    if ($csv === false || trim($csv) === '') {
        return [];
    }
    $rows = [];
    $handle = fopen('php://temp', 'r+');
    fwrite($handle, $csv);
    rewind($handle);
    while (($row = fgetcsv($handle, 0, ',')) !== false) {
        $rows[] = $row;
    }
    fclose($handle);
    if (!$rows) {
        return [];
    }

    $periodStart = rohlik_date($rows[0][2] ?? '');
    $periodEnd = rohlik_date($rows[0][4] ?? '');
    if ($periodStart) {
        $start = new DateTime($periodStart);
        $matchesStart = (int)$start->format('n') === $month && (int)$start->format('Y') === $year;
        $matchesEnd = false;
        if ($periodEnd) {
            $end = new DateTime($periodEnd);
            $matchesEnd = (int)$end->format('n') === $month && (int)$end->format('Y') === $year;
        }
        if (!$matchesStart && !$matchesEnd) {
            return [];
        }
    }

    $summary = [];
    foreach ($rows as $row) {
        $email = strtolower(trim((string)($row[0] ?? '')));
        if ($email === '' || strpos($email, '@') === false) {
            continue;
        }
        $worked = rohlik_decimal($row[2] ?? null);
        $bonus = rohlik_decimal($row[3] ?? null);
        $billing = rohlik_decimal($row[4] ?? null);
        $summary[$email] = [
            'email' => $email,
            'position' => trim((string)($row[1] ?? '')),
            'worked_hours' => $worked,
            'extra_hours' => $bonus,
            'bonus_hours' => $bonus,
            'billing_hours' => $billing,
            'payable_hours' => $billing > 0 ? $billing : round($worked + $bonus, 2),
            'period_start' => $periodStart,
            'period_end' => $periodEnd,
            'source_key' => 'SUMA',
        ];
    }
    return $summary;
}

function rohlik_adjustments(int $month, int $year): array
{
    $stmt = db()->prepare('SELECT * FROM rohlik_brno_adjustments WHERE month = ? AND year = ?');
    $stmt->execute([$month, $year]);
    $result = [];
    foreach ($stmt->fetchAll() as $row) {
        $result[strtolower((string)$row['email'])] = $row;
    }
    return $result;
}

function rohlik_approved_advances(int $month, int $year): array
{
    $stmt = db()->prepare("SELECT employee_id, SUM(amount) AS amount FROM advances WHERE month = ? AND year = ? AND status = 'approved' GROUP BY employee_id");
    $stmt->execute([$month, $year]);
    $result = [];
    foreach ($stmt->fetchAll() as $row) {
        $result[(int)$row['employee_id']] = (float)$row['amount'];
    }
    return $result;
}

function rohlik_employees(): array
{
    $rows = db()->query('SELECT e.id,e.name,e.email,e.warehouse_email,e.hourly_rate,e.contract_type,e.company_id,e.object_id,e.avatar_path,COALESCE(c.hour_deduction_pct,0) AS hour_deduction_pct FROM employees e LEFT JOIN companies c ON c.id = e.company_id WHERE e.status = "active" ORDER BY e.name')->fetchAll();
    $byEmail = [];
    $byId = [];
    foreach ($rows as $row) {
        $byId[(int)$row['id']] = $row;
        foreach (['email', 'warehouse_email'] as $key) {
            $email = strtolower(trim((string)($row[$key] ?? '')));
            if ($email !== '') {
                $byEmail[$email] = $row;
            }
        }
    }
    return ['rows' => $rows, 'by_email' => $byEmail, 'by_id' => $byId];
}

function rohlik_match_employee_for_adjustment(?int $employeeId, string $email): ?array
{
    if ($employeeId) {
        $stmt = db()->prepare('SELECT id,name,email,warehouse_email,hourly_rate,contract_type FROM employees WHERE id = ? LIMIT 1');
        $stmt->execute([$employeeId]);
        $employee = $stmt->fetch();
        if ($employee) {
            return $employee;
        }
    }
    $cleanEmail = strtolower(trim($email));
    if ($cleanEmail === '') {
        return null;
    }
    $stmt = db()->prepare('SELECT id,name,email,warehouse_email,hourly_rate,contract_type FROM employees WHERE status = "active" AND (LOWER(email) = ? OR LOWER(warehouse_email) = ?) LIMIT 1');
    $stmt->execute([$cleanEmail, $cleanEmail]);
    $employee = $stmt->fetch();
    return $employee ?: null;
}

function rohlik_sync_employee_card(?int $employeeId, string $email, float $hourlyRate, string $contractType): ?int
{
    $employee = rohlik_match_employee_for_adjustment($employeeId, $email);
    if (!$employee) {
        return $employeeId;
    }
    $sets = [];
    $params = [];
    if ($hourlyRate > 0 && abs((float)($employee['hourly_rate'] ?? 0) - $hourlyRate) > 0.001) {
        $sets[] = 'hourly_rate = ?';
        $params[] = $hourlyRate;
    }
    if ($contractType !== '' && rohlik_contract_type((string)($employee['contract_type'] ?? '')) !== $contractType) {
        $sets[] = 'contract_type = ?';
        $params[] = $contractType;
    }
    if ($sets) {
        $params[] = (int)$employee['id'];
        db()->prepare('UPDATE employees SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($params);
    }
    return (int)$employee['id'];
}

function rohlik_periods(array $sourceRows, array $sumaRows = []): array
{
    $periods = [];
    foreach ($sourceRows as $row) {
        $key = sprintf('%04d-%02d', (int)$row['year'], (int)$row['month']);
        if (!isset($periods[$key])) {
            $periods[$key] = ['year' => (int)$row['year'], 'month' => (int)$row['month'], 'people' => [], 'worked_hours' => 0.0, 'billing_hours' => 0.0, 'rows' => 0];
        }
        $periods[$key]['people'][$row['email']] = true;
        $periods[$key]['worked_hours'] += (float)$row['worked_hours'];
        $periods[$key]['billing_hours'] += (float)$row['billing_hours'];
        $periods[$key]['rows']++;
    }
    foreach ($periods as &$period) {
        $period['people_count'] = count($period['people']);
        unset($period['people']);
        $period['worked_hours'] = round($period['worked_hours'], 2);
        $period['billing_hours'] = round($period['billing_hours'], 2);
    }
    unset($period);
    $resetSumaPeriods = [];
    foreach ($sumaRows as $row) {
        $periodStart = $row['period_start'] ?? null;
        if (!$periodStart) {
            continue;
        }
        $dt = new DateTime((string)$periodStart);
        $key = sprintf('%04d-%02d', (int)$dt->format('Y'), (int)$dt->format('n'));
        if (empty($resetSumaPeriods[$key])) {
            $periods[$key] = ['year' => (int)$dt->format('Y'), 'month' => (int)$dt->format('n'), 'people_count' => count($sumaRows), 'worked_hours' => 0.0, 'billing_hours' => 0.0, 'rows' => 0];
            $resetSumaPeriods[$key] = true;
        }
        $periods[$key]['worked_hours'] += (float)($row['worked_hours'] ?? 0);
        $periods[$key]['billing_hours'] += (float)($row['billing_hours'] ?? 0);
        $periods[$key]['rows']++;
    }
    foreach ($periods as &$period) {
        $period['worked_hours'] = round((float)$period['worked_hours'], 2);
        $period['billing_hours'] = round((float)$period['billing_hours'], 2);
    }
    unset($period);
    usort($periods, static fn($a, $b) => ($b['year'] <=> $a['year']) ?: ($b['month'] <=> $a['month']));
    return $periods;
}

function rohlik_month_archive(int $month, int $year): ?array
{
    $stmt = db()->prepare('SELECT a.*, u.name AS fixed_by_name FROM rohlik_month_archives a LEFT JOIN users u ON u.id = a.fixed_by WHERE a.month = ? AND a.year = ? LIMIT 1');
    $stmt->execute([$month, $year]);
    $row = $stmt->fetch();
    return $row ?: null;
}

function rohlik_archive_meta(array $archive): array
{
    return [
        'is_archived' => true,
        'fixed_at' => $archive['fixed_at'] ?? null,
        'updated_at' => $archive['updated_at'] ?? null,
        'fixed_by' => $archive['fixed_by_name'] ?? null,
        'source_hash' => $archive['source_hash'] ?? '',
    ];
}

function rohlik_decode_archive(array $archive): array
{
    $payload = json_decode((string)($archive['payload_json'] ?? ''), true);
    if (!is_array($payload)) {
        $payload = [];
    }
    $payload['archive'] = rohlik_archive_meta($archive);
    $payload['source'] = 'archive';
    return $payload;
}

function rohlik_archive_periods(): array
{
    $rows = db()->query('SELECT year, month, rows_count, people_count, worked_hours, fixed_at FROM rohlik_month_archives ORDER BY year DESC, month DESC')->fetchAll();
    return array_map(static fn($row): array => [
        'year' => (int)$row['year'],
        'month' => (int)$row['month'],
        'people_count' => (int)$row['people_count'],
        'worked_hours' => round((float)$row['worked_hours'], 2),
        'rows' => (int)$row['rows_count'],
        'archived' => true,
        'fixed_at' => $row['fixed_at'] ?? null,
    ], $rows);
}

function rohlik_other_expenses(int $month, int $year): array
{
    $stmt = db()->prepare("SELECT x.*, c.name AS company_name, u.name AS coordinator_name, e.name AS employee_name, e.avatar_path AS employee_avatar_path, v.plate_number AS vehicle_plate, cu.name AS created_by_name
        FROM coordinator_expenses x
        LEFT JOIN companies c ON c.id = x.company_id
        LEFT JOIN users u ON u.id = x.coordinator_user_id
        LEFT JOIN employees e ON e.id = x.employee_id
        LEFT JOIN company_vehicles v ON v.id = x.vehicle_id
        LEFT JOIN users cu ON cu.id = x.created_by
        WHERE MONTH(x.expense_date) = ?
          AND YEAR(x.expense_date) = ?
          AND (
            LOWER(COALESCE(c.name, '')) LIKE '%roshpit%'
            OR LOWER(COALESCE(c.name, '')) LIKE '%rohlik%'
            OR LOWER(COALESCE(x.title, '')) LIKE '%roshpit%'
            OR LOWER(COALESCE(x.title, '')) LIKE '%rohlik%'
            OR LOWER(COALESCE(x.note, '')) LIKE '%roshpit%'
            OR LOWER(COALESCE(x.note, '')) LIKE '%rohlik%'
            OR LOWER(COALESCE(e.name, '')) LIKE '%rohlik%'
            OR LOWER(COALESCE(v.plate_number, '')) LIKE '%rohlik%'
          )
        ORDER BY x.expense_date DESC, x.id DESC");
    $stmt->execute([$month, $year]);
    return $stmt->fetchAll();
}

function rohlik_merge_periods(array $sourcePeriods, array $archivePeriods): array
{
    $periods = [];
    foreach ($sourcePeriods as $period) {
        $key = sprintf('%04d-%02d', (int)$period['year'], (int)$period['month']);
        $period['archived'] = false;
        $periods[$key] = $period;
    }
    foreach ($archivePeriods as $period) {
        $key = sprintf('%04d-%02d', (int)$period['year'], (int)$period['month']);
        $periods[$key] = array_merge($periods[$key] ?? [], $period, ['archived' => true]);
    }
    $result = array_values($periods);
    usort($result, static fn($a, $b) => ((int)$b['year'] <=> (int)$a['year']) ?: ((int)$b['month'] <=> (int)$a['month']));
    return $result;
}

function rohlik_summary(array $sourceRows, int $month, int $year, array $sumaRows = []): array
{
    $employees = rohlik_employees();
    $adjustments = rohlik_adjustments($month, $year);
    $approvedAdvances = rohlik_approved_advances($month, $year);
    $summary = [];
    $daily = [];

    foreach ($sourceRows as $row) {
        if ((int)$row['month'] !== $month || (int)$row['year'] !== $year) {
            continue;
        }
        $email = $row['email'];
        if (!isset($summary[$email])) {
            $summary[$email] = [
                'email' => $email,
                'attendance_hours' => 0.0,
                'worked_hours' => 0.0,
                'billing_hours' => 0.0,
                'extra_hours' => 0.0,
                'productivity_sum' => 0.0,
                'efficiency_sum' => 0.0,
                'percent_count' => 0,
                'total_worked_hours' => 0.0,
                'positions' => [],
                'rate_labels' => [],
                'days' => 0,
            ];
        }
        $summary[$email]['attendance_hours'] += (float)$row['attendance_hours'];
        $summary[$email]['worked_hours'] += (float)$row['worked_hours'];
        $summary[$email]['billing_hours'] += (float)$row['billing_hours'];
        $summary[$email]['extra_hours'] += (float)$row['extra_hours'];
        $summary[$email]['productivity_sum'] += (float)$row['productivity_percent'];
        $summary[$email]['efficiency_sum'] += (float)$row['efficiency_percent'];
        $summary[$email]['percent_count']++;
        $summary[$email]['total_worked_hours'] = max((float)$summary[$email]['total_worked_hours'], (float)$row['total_worked_hours']);
        if ($row['position'] !== '') {
            $summary[$email]['positions'][$row['position']] = true;
        }
        if ($row['rate_label'] !== '') {
            $summary[$email]['rate_labels'][$row['rate_label']] = true;
        }
        $summary[$email]['days']++;
        $daily[] = $row;
    }

    foreach ($sumaRows as $suma) {
        $email = strtolower(trim((string)($suma['email'] ?? '')));
        if ($email === '') {
            continue;
        }
        if (!isset($summary[$email])) {
            $summary[$email] = [
                'email' => $email,
                'attendance_hours' => 0.0,
                'worked_hours' => 0.0,
                'billing_hours' => 0.0,
                'extra_hours' => 0.0,
                'productivity_sum' => 0.0,
                'efficiency_sum' => 0.0,
                'percent_count' => 0,
                'total_worked_hours' => 0.0,
                'positions' => [],
                'rate_labels' => [],
                'days' => 0,
            ];
        }
        $summary[$email]['suma'] = $suma;
        if (trim((string)($suma['position'] ?? '')) !== '') {
            $summary[$email]['positions'][(string)$suma['position']] = true;
        }
    }

    $rows = [];
    foreach ($summary as $email => $row) {
        $suma = $row['suma'] ?? null;
        $adjustment = $adjustments[$email] ?? [];
        $employee = null;
        if (!empty($adjustment['employee_id']) && isset($employees['by_id'][(int)$adjustment['employee_id']])) {
            $employee = $employees['by_id'][(int)$adjustment['employee_id']];
        } elseif (isset($employees['by_email'][$email])) {
            $employee = $employees['by_email'][$email];
        }
        $manualRate = (float)($adjustment['hourly_rate'] ?? 0);
        $employeeRate = $employee ? (float)($employee['hourly_rate'] ?? 0) : 0.0;
        $hourlyRate = $employeeRate > 0 ? $employeeRate : $manualRate;
        $rateSource = $employeeRate > 0 ? 'employee_card' : ($manualRate > 0 ? 'rohlik_manual' : 'missing');
        $rateMismatch = $employee && $manualRate > 0 && abs($manualRate - $employeeRate) > 0.001;
        $contractType = rohlik_contract_type((string)($adjustment['contract_type'] ?? '')) ?: rohlik_contract_type((string)($employee['contract_type'] ?? ''));
        $defaultEmployerHealth = rohlik_default_employer_health_amount($contractType);
        $storedEmployerHealth = $adjustment['employer_health_amount'] ?? null;
        $employerHealthAmount = $storedEmployerHealth === null || $storedEmployerHealth === ''
            ? $defaultEmployerHealth
            : round((float)$storedEmployerHealth, 2);
        $employerHealthPaid = !empty($adjustment['employer_health_paid']) ? 1 : 0;
        $employerHealthExpense = $employerHealthPaid ? $employerHealthAmount : 0.0;
        $manualAdvance = (float)($adjustment['advance_amount'] ?? 0);
        $requestedAdvance = $employee ? (float)($approvedAdvances[(int)$employee['id']] ?? 0) : 0.0;
        $advance = $manualAdvance + $requestedAdvance;
        $bonus = (float)($adjustment['bonus_amount'] ?? 0);
        $deduction = (float)($adjustment['deduction_amount'] ?? 0);
        $sourceWorkedHours = $suma ? (float)($suma['worked_hours'] ?? 0) : (float)$row['worked_hours'];
        $sourceBonusHours = $suma ? (float)($suma['bonus_hours'] ?? $suma['extra_hours'] ?? 0) : (float)$row['extra_hours'];
        $sourceBillingHours = $suma ? (float)($suma['billing_hours'] ?? 0) : (float)$row['billing_hours'];
        $bonusHours = $sourceBonusHours;
        $rawHours = $sourceBillingHours > 0 ? $sourceBillingHours : $sourceWorkedHours + $bonusHours;
        $hourDeductionPct = $employee ? max(0.0, min(100.0, (float)($employee['hour_deduction_pct'] ?? 0))) : 0.0;
        $payableHours = $hourDeductionPct > 0 ? round($rawHours * (1 - $hourDeductionPct / 100), 2) : $rawHours;
        $gross = round($payableHours * $hourlyRate, 2);
        $net = round($gross + $bonus - $deduction - $advance, 2);
        $card = (float)($adjustment['card_amount'] ?? 0);
        $cash = (float)($adjustment['cash_amount'] ?? 0);
        if ($card <= 0 && $cash <= 0 && $net > 0) {
            $cash = $net;
        }
        $balance = rohlik_balance($net, $card, $cash);
        $count = max(1, (int)$row['percent_count']);
        $rows[] = [
            'email' => $email,
            'employee_id' => $employee ? (int)$employee['id'] : (isset($adjustment['employee_id']) ? (int)$adjustment['employee_id'] : null),
            'employee_name' => trim((string)($adjustment['full_name'] ?? '')) ?: ($employee['name'] ?? ''),
            'employee_avatar_path' => $employee['avatar_path'] ?? '',
            'contract_type' => $contractType,
            'matched' => (bool)$employee,
            'position' => implode(', ', array_keys($row['positions'])),
            'rate_label' => implode(', ', array_keys($row['rate_labels'])),
            'source_key' => $suma ? 'SUMA' : 'daily',
            'days' => (int)$row['days'],
            'attendance_hours' => round((float)$row['attendance_hours'], 2),
            'worked_hours' => round($sourceWorkedHours, 2),
            'billing_hours' => round($sourceBillingHours, 2),
            'extra_hours' => round($sourceBonusHours, 2),
            'bonus_hours' => round($bonusHours, 2),
            'raw_hours' => round($rawHours, 2),
            'payable_hours' => round($payableHours, 2),
            'hour_deduction_pct' => round($hourDeductionPct, 2),
            'avg_productivity' => round((float)$row['productivity_sum'] / $count, 2),
            'avg_efficiency' => round((float)$row['efficiency_sum'] / $count, 2),
            'total_worked_hours' => round((float)$row['total_worked_hours'], 2),
            'hourly_rate' => $hourlyRate,
            'profile_hourly_rate' => $employeeRate,
            'manual_hourly_rate' => $manualRate,
            'employer_health_amount' => $employerHealthAmount,
            'employer_health_default_amount' => $defaultEmployerHealth,
            'employer_health_paid' => $employerHealthPaid,
            'employer_health_expense' => $employerHealthExpense,
            'rate_source' => $rateSource,
            'rate_mismatch' => $rateMismatch,
            'advance_amount' => $advance,
            'manual_advance_amount' => $manualAdvance,
            'requested_advance_amount' => $requestedAdvance,
            'bonus_amount' => $bonus,
            'deduction_amount' => $deduction,
            'gross_amount' => $gross,
            'net_amount' => $net,
            'card_amount' => $card,
            'cash_amount' => $cash,
            'remains_amount' => $balance['remains_amount'],
            'company_owes_amount' => $balance['company_owes_amount'],
            'employee_owes_amount' => $balance['employee_owes_amount'],
            'balance_status' => $balance['balance_status'],
            'balance_label' => $balance['balance_label'],
            'note' => (string)($adjustment['note'] ?? ''),
        ];
    }
    usort($rows, static fn($a, $b) => strcasecmp($a['employee_name'] ?: $a['email'], $b['employee_name'] ?: $b['email']));
    usort($daily, static fn($a, $b) => strcmp($b['work_date'], $a['work_date']) ?: strcmp($a['email'], $b['email']));
    return ['rows' => $rows, 'daily' => $daily, 'employees' => $employees['rows']];
}

function rohlik_totals(array $rows): array
{
    $totals = ['people' => count($rows), 'worked_hours' => 0.0, 'billing_hours' => 0.0, 'extra_hours' => 0.0, 'bonus_hours' => 0.0, 'raw_hours' => 0.0, 'payable_hours' => 0.0, 'gross_amount' => 0.0, 'advance_amount' => 0.0, 'manual_advance_amount' => 0.0, 'requested_advance_amount' => 0.0, 'net_amount' => 0.0, 'card_amount' => 0.0, 'cash_amount' => 0.0, 'employer_health_amount' => 0.0, 'employer_health_expense' => 0.0, 'remains_amount' => 0.0, 'company_owes_amount' => 0.0, 'employee_owes_amount' => 0.0, 'company_owes_people' => 0, 'employee_owes_people' => 0, 'settled_people' => 0, 'employer_health_paid_people' => 0, 'employer_health_unpaid_people' => 0];
    foreach ($rows as $row) {
        foreach (['worked_hours', 'billing_hours', 'extra_hours', 'bonus_hours', 'raw_hours', 'payable_hours', 'gross_amount', 'advance_amount', 'manual_advance_amount', 'requested_advance_amount', 'net_amount', 'card_amount', 'cash_amount', 'employer_health_amount', 'employer_health_expense', 'remains_amount', 'company_owes_amount', 'employee_owes_amount'] as $key) {
            $totals[$key] += (float)($row[$key] ?? 0);
        }
        if ((float)($row['employer_health_amount'] ?? 0) > 0) {
            if (!empty($row['employer_health_paid'])) {
                $totals['employer_health_paid_people']++;
            } else {
                $totals['employer_health_unpaid_people']++;
            }
        }
        if ((float)($row['company_owes_amount'] ?? 0) > 0) {
            $totals['company_owes_people']++;
        } elseif ((float)($row['employee_owes_amount'] ?? 0) > 0) {
            $totals['employee_owes_people']++;
        } else {
            $totals['settled_people']++;
        }
    }
    foreach ($totals as $key => $value) {
        if ($key !== 'people' && substr($key, -7) !== '_people') {
            $totals[$key] = round((float)$value, 2);
        }
    }
    return $totals;
}

function rohlik_live_payload(array $sourceRows, array $sumaRows, int $month, int $year, array $periods): array
{
    $summary = rohlik_summary($sourceRows, $month, $year, $sumaRows);
    return [
        'company' => ROHLIK_COMPANY_NAME,
        'object' => ROHLIK_OBJECT_NAME,
        'month' => $month,
        'year' => $year,
        'rows' => $summary['rows'],
        'daily' => $summary['daily'],
        'employees' => $summary['employees'],
        'other_expenses' => rohlik_other_expenses($month, $year),
        'periods' => $periods,
        'totals' => rohlik_totals($summary['rows']),
        'source_url' => rohlik_suma_csv_url(),
        'source' => 'google',
        'source_basis' => 'SUMA',
        'calc_version' => ROHLIK_CALC_VERSION,
        'archive' => ['is_archived' => false],
    ];
}

function rohlik_store_archive(array $payload, int $userId): array
{
    $month = (int)($payload['month'] ?? 0);
    $year = (int)($payload['year'] ?? 0);
    $storedPayload = $payload;
    unset($storedPayload['archive']);
    $storedPayload['source'] = 'archive';
    $json = json_encode($storedPayload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        throw new RuntimeException('Rohlik archive JSON failed');
    }
    $hash = hash('sha256', $json);
    $rowsCount = count($payload['rows'] ?? []);
    $peopleCount = (int)($payload['totals']['people'] ?? $rowsCount);
    $workedHours = (float)($payload['totals']['worked_hours'] ?? 0);
    $stmt = db()->prepare('INSERT INTO rohlik_month_archives (month,year,payload_json,source_hash,rows_count,people_count,worked_hours,fixed_by) VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE payload_json=VALUES(payload_json), source_hash=VALUES(source_hash), rows_count=VALUES(rows_count), people_count=VALUES(people_count), worked_hours=VALUES(worked_hours), fixed_by=VALUES(fixed_by), fixed_at=NOW()');
    $stmt->execute([$month, $year, $json, $hash, $rowsCount, $peopleCount, $workedHours, $userId]);
    $archive = rohlik_month_archive($month, $year);
    if (!$archive) {
        throw new RuntimeException('Rohlik archive was not saved');
    }
    return $archive;
}

function rohlik_unique_list(array $values): string
{
    $result = [];
    foreach ($values as $value) {
        $value = trim((string)$value);
        if ($value !== '') {
            $result[$value] = true;
        }
    }
    return implode(', ', array_keys($result));
}

function rohlik_personal_payload_from_summary(array $summary, ?int $employeeId): array
{
    if (!$employeeId) {
        return ['row' => null, 'rows' => [], 'daily' => []];
    }

    $stmt = db()->prepare('SELECT e.id,e.name,e.email,e.warehouse_email,e.hourly_rate,e.contract_type,e.avatar_path,COALESCE(c.hour_deduction_pct,0) AS hour_deduction_pct FROM employees e LEFT JOIN companies c ON c.id = e.company_id WHERE e.id = ? LIMIT 1');
    $stmt->execute([$employeeId]);
    $employee = $stmt->fetch();
    if (!$employee) {
        return ['row' => null, 'rows' => [], 'daily' => []];
    }

    $employeeEmails = [];
    foreach (['email', 'warehouse_email'] as $key) {
        $email = strtolower(trim((string)($employee[$key] ?? '')));
        if ($email !== '') {
            $employeeEmails[$email] = true;
        }
    }

    $rows = array_values(array_filter($summary['rows'], static function ($row) use ($employee, $employeeEmails) {
        if ((int)($row['employee_id'] ?? 0) === (int)$employee['id']) {
            return true;
        }
        return isset($employeeEmails[strtolower((string)($row['email'] ?? ''))]);
    }));

    $matchedEmails = [];
    foreach ($rows as $row) {
        $email = strtolower((string)($row['email'] ?? ''));
        if ($email !== '') {
            $matchedEmails[$email] = true;
        }
    }

    $daily = array_values(array_filter($summary['daily'], static function ($row) use ($matchedEmails) {
        return isset($matchedEmails[strtolower((string)($row['email'] ?? ''))]);
    }));

    if (!$rows) {
        return ['row' => null, 'rows' => [], 'daily' => $daily];
    }

    $combined = [
        'email' => rohlik_unique_list(array_column($rows, 'email')),
        'employee_id' => (int)$employee['id'],
        'employee_name' => $employee['name'],
        'employee_avatar_path' => $employee['avatar_path'] ?? '',
        'contract_type' => rohlik_unique_list(array_column($rows, 'contract_type')) ?: rohlik_contract_type((string)($employee['contract_type'] ?? '')),
        'matched' => true,
        'position' => rohlik_unique_list(array_column($rows, 'position')),
        'rate_label' => rohlik_unique_list(array_column($rows, 'rate_label')),
        'days' => 0,
        'attendance_hours' => 0.0,
        'worked_hours' => 0.0,
        'billing_hours' => 0.0,
        'extra_hours' => 0.0,
        'bonus_hours' => 0.0,
        'raw_hours' => 0.0,
        'payable_hours' => 0.0,
        'hour_deduction_pct' => 0.0,
        'avg_productivity' => 0.0,
        'avg_efficiency' => 0.0,
        'total_worked_hours' => 0.0,
        'hourly_rate' => 0.0,
        'profile_hourly_rate' => (float)($employee['hourly_rate'] ?? 0),
        'manual_hourly_rate' => 0.0,
        'employer_health_amount' => 0.0,
        'employer_health_default_amount' => 0.0,
        'employer_health_paid' => 0,
        'employer_health_expense' => 0.0,
        'rate_source' => 'employee_card',
        'rate_mismatch' => false,
        'advance_amount' => 0.0,
        'manual_advance_amount' => 0.0,
        'requested_advance_amount' => 0.0,
        'bonus_amount' => 0.0,
        'deduction_amount' => 0.0,
        'gross_amount' => 0.0,
        'net_amount' => 0.0,
        'card_amount' => 0.0,
        'cash_amount' => 0.0,
        'remains_amount' => 0.0,
        'company_owes_amount' => 0.0,
        'employee_owes_amount' => 0.0,
        'balance_status' => 'settled',
        'balance_label' => 'Vyrovnano',
        'note' => rohlik_unique_list(array_column($rows, 'note')),
    ];

    foreach ($rows as $row) {
        foreach (['days', 'attendance_hours', 'worked_hours', 'billing_hours', 'extra_hours', 'bonus_hours', 'raw_hours', 'payable_hours', 'advance_amount', 'manual_advance_amount', 'requested_advance_amount', 'bonus_amount', 'deduction_amount', 'gross_amount', 'net_amount', 'card_amount', 'cash_amount', 'employer_health_amount', 'employer_health_default_amount', 'employer_health_expense'] as $key) {
            $combined[$key] += (float)($row[$key] ?? 0);
        }
        $combined['hour_deduction_pct'] = max((float)$combined['hour_deduction_pct'], (float)($row['hour_deduction_pct'] ?? 0));
        $combined['employer_health_paid'] = (!empty($combined['employer_health_paid']) || !empty($row['employer_health_paid'])) ? 1 : 0;
        $combined['manual_hourly_rate'] = max((float)$combined['manual_hourly_rate'], (float)($row['manual_hourly_rate'] ?? 0));
        $combined['rate_mismatch'] = $combined['rate_mismatch'] || !empty($row['rate_mismatch']);
        $combined['avg_productivity'] += (float)($row['avg_productivity'] ?? 0);
        $combined['avg_efficiency'] += (float)($row['avg_efficiency'] ?? 0);
        $combined['total_worked_hours'] = max((float)$combined['total_worked_hours'], (float)($row['total_worked_hours'] ?? 0));
        if ((float)($row['hourly_rate'] ?? 0) > 0) {
            $combined['hourly_rate'] = (float)$row['hourly_rate'];
        }
    }

    if ($combined['hourly_rate'] <= 0) {
        $combined['hourly_rate'] = (float)($employee['hourly_rate'] ?? 0);
    }
    $combined['rate_source'] = (float)($employee['hourly_rate'] ?? 0) > 0 ? 'employee_card' : ((float)$combined['manual_hourly_rate'] > 0 ? 'rohlik_manual' : 'missing');
    $count = max(1, count($rows));
    $combined['avg_productivity'] = round((float)$combined['avg_productivity'] / $count, 2);
    $combined['avg_efficiency'] = round((float)$combined['avg_efficiency'] / $count, 2);
    $balance = rohlik_balance((float)$combined['net_amount'], (float)$combined['card_amount'], (float)$combined['cash_amount']);
    $combined['remains_amount'] = $balance['remains_amount'];
    $combined['company_owes_amount'] = $balance['company_owes_amount'];
    $combined['employee_owes_amount'] = $balance['employee_owes_amount'];
    $combined['balance_status'] = $balance['balance_status'];
    $combined['balance_label'] = $balance['balance_label'];
    foreach (['attendance_hours', 'worked_hours', 'billing_hours', 'extra_hours', 'bonus_hours', 'raw_hours', 'payable_hours', 'hour_deduction_pct', 'total_worked_hours', 'hourly_rate', 'profile_hourly_rate', 'manual_hourly_rate', 'advance_amount', 'manual_advance_amount', 'requested_advance_amount', 'bonus_amount', 'deduction_amount', 'gross_amount', 'net_amount', 'card_amount', 'cash_amount', 'employer_health_amount', 'employer_health_default_amount', 'employer_health_expense', 'remains_amount', 'company_owes_amount', 'employee_owes_amount'] as $key) {
        $combined[$key] = round((float)$combined[$key], 2);
    }
    $combined['days'] = (int)$combined['days'];

    return ['row' => $combined, 'rows' => $rows, 'daily' => $daily];
}

function rohlik_personal_payload(array $sourceRows, array $sumaRows, int $month, int $year, ?int $employeeId): array
{
    return rohlik_personal_payload_from_summary(rohlik_summary($sourceRows, $month, $year, $sumaRows), $employeeId);
}

if ($method === 'POST' && $action === 'archive') {
    $user = require_permission('rohlik.write');
    $data = read_json();
    $month = (int)($data['month'] ?? date('n'));
    $year = (int)($data['year'] ?? date('Y'));
    if ($month < 1 || $month > 12 || $year < 2020 || $year > 2100) {
        json_response(['ok' => false, 'error' => 'Invalid archive period'], 422);
    }
    $sourceRows = rohlik_fetch_rows();
    $sumaRows = rohlik_fetch_suma_rows($month, $year);
    $periods = rohlik_merge_periods(rohlik_periods($sourceRows, $sumaRows), rohlik_archive_periods());
    $payload = rohlik_live_payload($sourceRows, $sumaRows, $month, $year, $periods);
    $archive = rohlik_store_archive($payload, (int)$user['id']);
    $periods = rohlik_merge_periods(rohlik_periods($sourceRows, $sumaRows), rohlik_archive_periods());
    $archivedPayload = rohlik_decode_archive($archive);
    $archivedPayload['periods'] = $periods;
    audit_log($user, 'FIX_ARCHIVE', 'rohlik_month_archives', (int)$archive['id'], ['month' => $month, 'year' => $year]);
    json_response(['ok' => true, 'data' => $archivedPayload]);
}

if ($method === 'POST' && $action === 'adjustment') {
    $user = require_permission('rohlik.write');
    $data = read_json();
    require_fields($data, ['email', 'month', 'year']);
    $email = strtolower(trim((string)$data['email']));
    if ($email === '') {
        json_response(['ok' => false, 'error' => 'Email is required'], 422);
    }
    $employeeId = int_or_null($data, 'employee_id');
    $hourlyRate = money_value($data, 'hourly_rate');
    $contractType = rohlik_contract_type(nullable_string($data, 'contract_type', 40));
    $employeeId = rohlik_sync_employee_card($employeeId, $email, $hourlyRate, $contractType);
    $cardAmount = money_value($data, 'card_amount');
    $cashAmount = money_value($data, 'cash_amount');
    $stmt = db()->prepare('INSERT INTO rohlik_brno_adjustments (month,year,email,employee_id,full_name,contract_type,hourly_rate,advance_amount,bonus_amount,deduction_amount,card_amount,cash_amount,employer_health_amount,employer_health_paid,note,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE employee_id=VALUES(employee_id), full_name=VALUES(full_name), contract_type=VALUES(contract_type), hourly_rate=VALUES(hourly_rate), advance_amount=VALUES(advance_amount), bonus_amount=VALUES(bonus_amount), deduction_amount=VALUES(deduction_amount), card_amount=VALUES(card_amount), cash_amount=VALUES(cash_amount), employer_health_amount=VALUES(employer_health_amount), employer_health_paid=VALUES(employer_health_paid), note=VALUES(note), updated_by=VALUES(updated_by)');
    $stmt->execute([
        (int)$data['month'],
        (int)$data['year'],
        $email,
        $employeeId,
        nullable_string($data, 'full_name', 255),
        $contractType,
        $hourlyRate,
        money_value($data, 'advance_amount'),
        money_value($data, 'bonus_amount'),
        money_value($data, 'deduction_amount'),
        $cardAmount,
        $cashAmount,
        money_value($data, 'employer_health_amount'),
        !empty($data['employer_health_paid']) ? 1 : 0,
        nullable_string($data, 'note'),
        (int)$user['id'],
    ]);
    if ($employeeId) {
        $existingPayout = db()->prepare('SELECT id FROM payouts WHERE employee_id = ? AND month = ? AND year = ? AND deleted_at IS NULL LIMIT 1');
        $existingPayout->execute([(int)$employeeId, (int)$data['month'], (int)$data['year']]);
        if ($cardAmount != 0.0 || $cashAmount != 0.0 || $existingPayout->fetchColumn()) {
            $payout = db()->prepare('INSERT INTO payouts (employee_id,month,year,card_amount,cash_amount,note,created_by) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE card_amount=VALUES(card_amount), cash_amount=VALUES(cash_amount), note=VALUES(note), created_by=VALUES(created_by), deleted_at=NULL, deleted_by=NULL');
            $payout->execute([
                (int)$employeeId,
                (int)$data['month'],
                (int)$data['year'],
                $cardAmount,
                $cashAmount,
                nullable_string($data, 'note'),
                (int)$user['id'],
            ]);
        }
    }
    audit_log($user, 'UPSERT_ADJUSTMENT', 'rohlik_brno', null, ['email' => $email, 'month' => (int)$data['month'], 'year' => (int)$data['year']]);
    json_response(['ok' => true]);
}

if ($method === 'GET' && $action === 'me') {
    $user = require_permission('dashboard.view');
    $month = (int)($_GET['month'] ?? date('n'));
    $year = (int)($_GET['year'] ?? date('Y'));
    $archive = rohlik_month_archive($month, $year);
    if ($archive) {
        $archived = rohlik_decode_archive($archive);
        if (($archived['calc_version'] ?? '') === ROHLIK_CALC_VERSION) {
            $payload = rohlik_personal_payload_from_summary([
                'rows' => $archived['rows'] ?? [],
                'daily' => $archived['daily'] ?? [],
                'employees' => $archived['employees'] ?? [],
            ], isset($user['employee_id']) ? (int)$user['employee_id'] : null);
            $archiveMeta = $archived['archive'];
        } else {
            $archive = null;
        }
    }
    if (!$archive) {
        $sourceRows = rohlik_fetch_rows();
        $sumaRows = rohlik_fetch_suma_rows($month, $year);
        $payload = rohlik_personal_payload($sourceRows, $sumaRows, $month, $year, isset($user['employee_id']) ? (int)$user['employee_id'] : null);
        $archiveMeta = ['is_archived' => false];
    }
    json_response(['ok' => true, 'data' => [
        'company' => ROHLIK_COMPANY_NAME,
        'object' => ROHLIK_OBJECT_NAME,
        'month' => $month,
        'year' => $year,
        'row' => $payload['row'],
        'rows' => $payload['rows'],
        'daily' => $payload['daily'],
        'archive' => $archiveMeta,
    ]]);
}

if ($method === 'GET') {
    require_permission('rohlik.view');
    $month = (int)($_GET['month'] ?? date('n'));
    $year = (int)($_GET['year'] ?? date('Y'));
    $archive = rohlik_month_archive($month, $year);
    $sourceRows = null;
    try {
        $sourceRows = rohlik_fetch_rows();
    } catch (Throwable $error) {
        if (!$archive) {
            throw $error;
        }
    }
    $sumaRows = $sourceRows !== null ? rohlik_fetch_suma_rows($month, $year) : [];
    $sourcePeriods = $sourceRows !== null ? rohlik_periods($sourceRows, $sumaRows) : [];
    $periods = rohlik_merge_periods($sourcePeriods, rohlik_archive_periods());
    if ($archive) {
        $payload = rohlik_decode_archive($archive);
        if (($payload['calc_version'] ?? '') === ROHLIK_CALC_VERSION) {
            $payload['periods'] = $periods;
            json_response(['ok' => true, 'data' => $payload]);
        }
    }
    if ($sourceRows === null) {
        throw new RuntimeException('Rohlik Google Sheet is not available');
    }
    json_response(['ok' => true, 'data' => rohlik_live_payload($sourceRows, $sumaRows, $month, $year, $periods)]);
}

json_response(['ok' => false, 'error' => 'Rohlik route not found'], 404);
