<?php
declare(strict_types=1);

const PAYROLL_ROHLIK_SHEET_ID = '1KK6MldPNM3oCQ6rms0V7RT4beOo9i-Z6IoFG4o5B76I';
const PAYROLL_ROHLIK_DAILY_GID = '444006528';
const PAYROLL_ROHLIK_SUMA_GID = '1333031371';

function payroll_decimal(?string $value): float
{
    $value = trim((string)$value);
    $value = str_replace(["\xc2\xa0", ' ', '%'], '', $value);
    $value = str_replace(',', '.', $value);
    return is_numeric($value) ? round((float)$value, 2) : 0.0;
}

function payroll_rohlik_date(?string $value): ?string
{
    $value = trim((string)$value);
    if ($value === '') {
        return null;
    }
    $dt = DateTime::createFromFormat('j.n.Y', $value)
        ?: DateTime::createFromFormat('d.m.Y', $value)
        ?: DateTime::createFromFormat('Y-m-d', $value);
    return $dt ? $dt->format('Y-m-d') : null;
}

function payroll_contract_kind(?string $value): string
{
    $raw = trim((string)$value);
    if ($raw === '') {
        return '';
    }
    $normalized = strtoupper(str_replace([' ', '-', '_', '.', '/', '\\'], '', $raw));
    if (strpos($normalized, 'HPP') !== false) return 'HPP';
    if (strpos($normalized, 'DPP') !== false) return 'DPP';
    if (strpos($normalized, 'DPC') !== false) return 'DPC';
    if (strpos($normalized, 'ZIVNOST') !== false || strpos($normalized, 'ZL') !== false || strpos($normalized, 'ICO') !== false) return 'Zivnost';
    return substr(strtoupper($raw), 0, 40);
}

function payroll_rohlik_csv(string $gid): ?string
{
    $url = 'https://docs.google.com/spreadsheets/d/' . PAYROLL_ROHLIK_SHEET_ID . '/export?format=csv&gid=' . $gid;
    $context = stream_context_create([
        'http' => [
            'timeout' => 10,
            'header' => "User-Agent: BuildPayPayroll/1.0\r\n",
        ],
    ]);
    $csv = @file_get_contents($url, false, $context);
    if ($csv === false || trim($csv) === '') {
        return null;
    }
    return $csv;
}

function payroll_rohlik_suma_rows(int $month, int $year): array
{
    $csv = payroll_rohlik_csv(PAYROLL_ROHLIK_SUMA_GID);
    if ($csv === null) {
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

    $periodStart = payroll_rohlik_date($rows[0][2] ?? '');
    $periodEnd = payroll_rohlik_date($rows[0][4] ?? '');
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
        $worked = payroll_decimal($row[2] ?? null);
        $bonus = payroll_decimal($row[3] ?? null);
        $billing = payroll_decimal($row[4] ?? null);
        $summary[$email] = [
            'worked_hours' => $worked,
            'bonus_hours' => $bonus,
            'billing_hours' => $billing,
            'payable_hours' => $billing > 0 ? $billing : round($worked + $bonus, 2),
            'position' => trim((string)($row[1] ?? '')),
            'source_key' => 'SUMA',
        ];
    }
    return $summary;
}

function payroll_rohlik_daily_rows(int $month, int $year): array
{
    $csv = payroll_rohlik_csv(PAYROLL_ROHLIK_DAILY_GID);
    if ($csv === null) {
        return [];
    }
    $summary = [];
    $handle = fopen('php://temp', 'r+');
    fwrite($handle, $csv);
    rewind($handle);
    fgetcsv($handle, 0, ',');
    while (($row = fgetcsv($handle, 0, ',')) !== false) {
        $date = payroll_rohlik_date($row[0] ?? '');
        $email = strtolower(trim((string)($row[1] ?? '')));
        $supplier = strtoupper(trim((string)($row[2] ?? '')));
        if (!$date || $email === '' || $supplier !== 'ROSHPIT') {
            continue;
        }
        $dt = new DateTime($date);
        if ((int)$dt->format('n') !== $month || (int)$dt->format('Y') !== $year) {
            continue;
        }
        if (!isset($summary[$email])) {
            $summary[$email] = [
                'worked_hours' => 0.0,
                'bonus_hours' => 0.0,
            ];
        }
        $summary[$email]['worked_hours'] += payroll_decimal($row[4] ?? null);
        $summary[$email]['bonus_hours'] += payroll_decimal($row[9] ?? null);
        $summary[$email]['billing_hours'] = ($summary[$email]['billing_hours'] ?? 0.0) + payroll_decimal($row[8] ?? null);
    }
    fclose($handle);

    foreach ($summary as &$row) {
        $row['worked_hours'] = round((float)$row['worked_hours'], 2);
        $row['bonus_hours'] = round((float)$row['bonus_hours'], 2);
        $row['billing_hours'] = round((float)($row['billing_hours'] ?? 0), 2);
        $row['payable_hours'] = $row['billing_hours'] > 0 ? $row['billing_hours'] : round($row['worked_hours'] + $row['bonus_hours'], 2);
        $row['source_key'] = 'daily';
    }
    unset($row);
    return $summary;
}

function payroll_rohlik_source_rows(int $month, int $year): array
{
    $suma = payroll_rohlik_suma_rows($month, $year);
    if ($suma) {
        return $suma;
    }
    return payroll_rohlik_daily_rows($month, $year);
}

function payroll_rohlik_adjustments(int $month, int $year): array
{
    $stmt = db()->prepare('SELECT * FROM rohlik_brno_adjustments WHERE month = ? AND year = ?');
    $stmt->execute([$month, $year]);
    $byEmail = [];
    $byEmployee = [];
    foreach ($stmt->fetchAll() as $row) {
        $email = strtolower(trim((string)($row['email'] ?? '')));
        if ($email !== '') {
            $byEmail[$email] = $row;
        }
        if (!empty($row['employee_id'])) {
            $byEmployee[(int)$row['employee_id']] = $row;
        }
    }
    return ['by_email' => $byEmail, 'by_employee' => $byEmployee];
}

function payroll_match_rohlik(array $employee, array $sourceRows, array $adjustments): array
{
    $emails = array_values(array_filter(array_map(static fn($value): string => strtolower(trim((string)$value)), [
        $employee['warehouse_email'] ?? '',
        $employee['email'] ?? '',
    ])));
    foreach ($emails as $email) {
        if (isset($sourceRows[$email])) {
            return [$sourceRows[$email], $adjustments['by_email'][$email] ?? ($adjustments['by_employee'][(int)$employee['employee_id']] ?? [])];
        }
    }
    $adjustment = $adjustments['by_employee'][(int)$employee['employee_id']] ?? null;
    if ($adjustment) {
        $email = strtolower(trim((string)($adjustment['email'] ?? '')));
        return [$sourceRows[$email] ?? null, $adjustment];
    }
    return [null, []];
}

function payroll_stavba_employee_sql(string $employeeAlias = 'e', string $companyAlias = 'c', string $objectAlias = 'o'): string
{
    $employee = preg_replace('/[^A-Za-z0-9_]/', '', $employeeAlias);
    $company = preg_replace('/[^A-Za-z0-9_]/', '', $companyAlias);
    $object = preg_replace('/[^A-Za-z0-9_]/', '', $objectAlias);
    return " AND (
        COALESCE($object.work_type, '') = 'stavba'
        OR LOWER(COALESCE($object.name, '')) LIKE '%stavba%'
        OR LOWER(COALESCE($object.name, '')) LIKE '%fasada%'
        OR LOWER(COALESCE($company.name, '')) LIKE '%stavba%'
        OR LOWER(COALESCE($company.name, '')) LIKE '%fasada%'
      )
      AND LOWER(COALESCE($object.name, '')) NOT LIKE '%rohlik%'
      AND LOWER(COALESCE($company.name, '')) NOT LIKE '%rohlik%'
      AND LOWER(COALESCE($company.name, '')) NOT LIKE '%roshpit%'
      AND LOWER(COALESCE($employee.email, '')) NOT LIKE '%@brno1.rohlik.cz%'
      AND LOWER(COALESCE($employee.warehouse_email, '')) NOT LIKE '%@brno1.rohlik.cz%'";
}

function payroll_non_stavba_employee_sql(string $companyAlias = 'c', string $objectAlias = 'o'): string
{
    $company = preg_replace('/[^A-Za-z0-9_]/', '', $companyAlias);
    $object = preg_replace('/[^A-Za-z0-9_]/', '', $objectAlias);
    return " AND NOT (
        COALESCE($object.work_type, '') = 'stavba'
        OR LOWER(COALESCE($object.name, '')) LIKE '%stavba%'
        OR LOWER(COALESCE($object.name, '')) LIKE '%fasada%'
        OR LOWER(COALESCE($company.name, '')) LIKE '%stavba%'
        OR LOWER(COALESCE($company.name, '')) LIKE '%fasada%'
      )";
}

function payroll_period_bounds(int $month, int $year): array
{
    $start = DateTime::createFromFormat('!Y-n-j', $year . '-' . $month . '-1') ?: new DateTime('first day of this month');
    $end = (clone $start)->modify('+1 month');
    return [$start->format('Y-m-d'), $end->format('Y-m-d')];
}

function payroll_stavba_rows(int $month, int $year, array $user, bool $includePayouts = false): array
{
    [$start, $end] = payroll_period_bounds($month, $year);
    [$scopeSql, $scopeParams] = current_employee_filter($user, 'e');
    $stavbaSql = payroll_stavba_employee_sql('e', 'c', 'o');
    $payoutSelect = $includePayouts ? ', p.id AS payout_id, COALESCE(p.card_amount, 0) AS card_amount, COALESCE(p.cash_amount, 0) AS cash_amount, COALESCE(p.insurance_amount, 0) AS insurance_amount, COALESCE(p.debt_amount, 0) AS debt_amount, p.debt_note, COALESCE(p.debt_carried_over, 0) AS debt_carried_over, COALESCE(p.social_paid, 0) AS social_paid, COALESCE(p.health_paid, 0) AS health_paid, p.paid_at, p.note AS payout_note' : '';
    $payoutJoin = $includePayouts ? ' LEFT JOIN payouts p ON p.employee_id = e.id AND p.month = ? AND p.year = ? AND p.deleted_at IS NULL' : '';
    $params = [$start, $end, $month, $year, $start, $end, $month, $year, $month, $year];
    if ($includePayouts) {
        $params[] = $month;
        $params[] = $year;
    }
    $params = array_merge($params, $scopeParams);

    $sql = "
    SELECT
      e.id AS employee_id,
      e.name AS employee_name,
      e.email,
      e.warehouse_email,
      e.avatar_path AS employee_avatar_path,
      e.bank_account,
      e.contract_type,
      e.contract_number,
      e.company_id,
      e.hourly_rate AS employee_hourly_rate,
      c.name AS company_name,
      COALESCE(c.hour_deduction_pct, 0) AS company_hour_deduction_pct,
      o.name AS object_name,
      o.work_type AS object_work_type,
      ac.name AS accommodation_name,
      COALESCE(ci.checkin_hours, 0) AS checkin_hours,
      COALESCE(ci.checkin_count, 0) AS checkin_count,
      ci.last_checkin_at,
      COALESCE(t.timesheet_hours, 0) AS timesheet_hours,
      COALESCE(t.timesheet_count, 0) AS timesheet_count,
      t.last_timesheet_date,
      COALESCE(m.manual_hours, 0) AS manual_hours,
      COALESCE(m.manual_count, 0) AS manual_count,
      m.last_manual_date,
      COALESCE(h.amount, NULLIF(e.housing_cost, 0), ac.monthly_cost, 0) AS housing,
      COALESCE(a.advances, 0) AS approved_advances
      $payoutSelect
    FROM employees e
    LEFT JOIN companies c ON c.id = e.company_id
    LEFT JOIN objects o ON o.id = e.object_id
    LEFT JOIN accommodations ac ON ac.id = e.accommodation_id
    LEFT JOIN (
      SELECT employee_id,
        ROUND(COALESCE(SUM(CASE WHEN duration_hours IS NOT NULL AND duration_hours > 0 THEN duration_hours ELSE TIMESTAMPDIFF(MINUTE, time_in, time_out) / 60 END), 0), 2) AS checkin_hours,
        COUNT(id) AS checkin_count,
        MAX(time_in) AS last_checkin_at
      FROM checkins
      WHERE time_out IS NOT NULL AND status <> 'rejected' AND time_in >= ? AND time_in < ?
      GROUP BY employee_id
    ) ci ON ci.employee_id = e.id
    LEFT JOIN (
      SELECT employee_id, ROUND(COALESCE(SUM(hours), 0), 2) AS timesheet_hours, COUNT(id) AS timesheet_count, MAX(work_date) AS last_timesheet_date
      FROM timesheets
      WHERE month = ? AND year = ? AND status = 'approved' AND COALESCE(note, '') NOT LIKE 'Check-in %'
      GROUP BY employee_id
    ) t ON t.employee_id = e.id
    LEFT JOIN (
      SELECT employee_id, ROUND(COALESCE(SUM(hours), 0), 2) AS manual_hours, COUNT(id) AS manual_count, MAX(work_date) AS last_manual_date
      FROM stavba_manual_hours
      WHERE work_date >= ? AND work_date < ?
      GROUP BY employee_id
    ) m ON m.employee_id = e.id
    LEFT JOIN housing h ON h.employee_id = e.id AND h.month = ? AND h.year = ?
    LEFT JOIN (SELECT employee_id, SUM(amount) AS advances FROM advances WHERE month = ? AND year = ? AND status = 'approved' AND deleted_at IS NULL GROUP BY employee_id) a ON a.employee_id = e.id
    $payoutJoin
    WHERE e.status = 'active' $scopeSql $stavbaSql
    ORDER BY e.name";
    $stmt = db()->prepare($sql);
    $stmt->execute($params);

    $adjustments = payroll_rohlik_adjustments($month, $year);
    $rows = [];
    foreach ($stmt->fetchAll() as $row) {
        [, $adjustment] = payroll_match_rohlik($row, [], $adjustments);
        $employeeRate = (float)($row['employee_hourly_rate'] ?? 0);
        $manualRate = (float)($adjustment['hourly_rate'] ?? 0);
        $hourlyRate = $employeeRate > 0 ? $employeeRate : $manualRate;
        $manualAdvance = (float)($adjustment['advance_amount'] ?? 0);
        $approvedAdvances = (float)$row['approved_advances'];
        $advances = round($approvedAdvances + $manualAdvance, 2);
        $bonusAmount = (float)($adjustment['bonus_amount'] ?? 0);
        $deductionAmount = (float)($adjustment['deduction_amount'] ?? 0);
        $contractKind = payroll_contract_kind((string)($adjustment['contract_type'] ?? '')) ?: payroll_contract_kind((string)($row['contract_type'] ?? ''));
        $checkinHours = round((float)$row['checkin_hours'], 2);
        $timesheetHours = round((float)$row['timesheet_hours'], 2);
        $manualHours = round((float)$row['manual_hours'], 2);
        $payableHours = round($checkinHours + $timesheetHours + $manualHours, 2);
        $housing = (float)$row['housing'];
        $insuranceAmount = $includePayouts ? (float)($row['insurance_amount'] ?? 0) : 0.0;
        $gross = round($payableHours * $hourlyRate, 2);
        $net = round($gross + $bonusAmount + $insuranceAmount - $deductionAmount - $advances - $housing, 2);
        $row['source'] = 'stavba';
        $row['contract_type'] = $contractKind ?: (string)($row['contract_type'] ?? '');
        $row['contract_kind'] = $contractKind ?: '-';
        $row['hours'] = $checkinHours;
        $row['bonus_hours'] = 0.0;
        $row['payable_hours'] = $payableHours;
        $row['raw_hours'] = $payableHours;
        $row['hour_deduction_pct'] = 0.0;
        $row['total_hours'] = $payableHours;
        $row['checkin_hours'] = $checkinHours;
        $row['timesheet_hours'] = $timesheetHours;
        $row['manual_hours'] = $manualHours;
        $row['hourly_rate'] = round($hourlyRate, 2);
        $row['profile_hourly_rate'] = round($employeeRate, 2);
        $row['manual_hourly_rate'] = round($manualRate, 2);
        $row['rate_source'] = $employeeRate > 0 ? 'employee_card' : ($manualRate > 0 ? 'stavba_manual' : 'missing');
        $row['approved_advances'] = round($approvedAdvances, 2);
        $row['manual_advances'] = round($manualAdvance, 2);
        $row['advances'] = $advances;
        $row['bonus_amount'] = round($bonusAmount, 2);
        $row['deduction_amount'] = round($deductionAmount, 2);
        $row['insurance_amount'] = round($insuranceAmount, 2);
        $row['gross'] = $gross;
        $row['gross_amount'] = $gross;
        $row['net'] = $net;
        if ($includePayouts) {
            $row['card_amount'] = round((float)($row['card_amount'] ?? 0), 2);
            $row['cash_amount'] = round((float)($row['cash_amount'] ?? 0), 2);
            $row['debt_amount'] = round((float)($row['debt_amount'] ?? 0), 2);
            $row['debt_note'] = $row['debt_note'] ?? null;
            $row['debt_carried_over'] = (int)($row['debt_carried_over'] ?? 0);
            $row['social_paid'] = (int)($row['social_paid'] ?? 0);
            $row['health_paid'] = (int)($row['health_paid'] ?? 0);
            $row['remains'] = round($net - $row['card_amount'] - $row['cash_amount'] - $row['debt_amount'], 2);
        }
        $rows[] = $row;
    }
    return $rows;
}

function payroll_rows(int $month, int $year, array $user, bool $includePayouts = false): array
{
    [$scopeSql, $scopeParams] = current_employee_filter($user, 'e');
    $nonStavbaSql = payroll_non_stavba_employee_sql('c', 'o');
    $timesheetStatusSql = has_global_scope($user) ? " AND status = 'approved'" : '';
    $payoutSelect = $includePayouts ? ', p.id AS payout_id, COALESCE(p.card_amount, 0) AS card_amount, COALESCE(p.cash_amount, 0) AS cash_amount, COALESCE(p.insurance_amount, 0) AS insurance_amount, COALESCE(p.debt_amount, 0) AS debt_amount, p.debt_note, COALESCE(p.debt_carried_over, 0) AS debt_carried_over, COALESCE(p.social_paid, 0) AS social_paid, COALESCE(p.health_paid, 0) AS health_paid, p.paid_at, p.note AS payout_note' : '';
    $payoutJoin = $includePayouts ? ' LEFT JOIN payouts p ON p.employee_id = e.id AND p.month = ? AND p.year = ? AND p.deleted_at IS NULL' : '';
    $params = [$month, $year, $month, $year, $month, $year];
    if ($includePayouts) {
        $params[] = $month;
        $params[] = $year;
    }
    $params = array_merge($params, $scopeParams);

    $sql = "
    SELECT
      e.id AS employee_id,
      e.name AS employee_name,
      e.email,
      e.warehouse_email,
      e.avatar_path AS employee_avatar_path,
      e.bank_account,
      e.contract_type,
      e.contract_number,
      e.company_id,
      e.hourly_rate AS employee_hourly_rate,
      c.name AS company_name,
      COALESCE(c.hour_deduction_pct, 0) AS company_hour_deduction_pct,
      o.name AS object_name,
      ac.name AS accommodation_name,
      COALESCE(t.hours, 0) AS timesheet_hours,
      COALESCE(h.amount, NULLIF(e.housing_cost, 0), ac.monthly_cost, 0) AS housing,
      COALESCE(a.advances, 0) AS approved_advances
      $payoutSelect
    FROM employees e
    LEFT JOIN companies c ON c.id = e.company_id
    LEFT JOIN objects o ON o.id = e.object_id
    LEFT JOIN accommodations ac ON ac.id = e.accommodation_id
    LEFT JOIN (SELECT employee_id, SUM(hours) AS hours FROM timesheets WHERE month = ? AND year = ? $timesheetStatusSql GROUP BY employee_id) t ON t.employee_id = e.id
    LEFT JOIN housing h ON h.employee_id = e.id AND h.month = ? AND h.year = ?
    LEFT JOIN (SELECT employee_id, SUM(amount) AS advances FROM advances WHERE month = ? AND year = ? AND status = 'approved' AND deleted_at IS NULL GROUP BY employee_id) a ON a.employee_id = e.id
    $payoutJoin
    WHERE e.status = 'active' $scopeSql $nonStavbaSql
    ORDER BY e.name";
    $stmt = db()->prepare($sql);
    $stmt->execute($params);

    $rohlikRows = payroll_rohlik_source_rows($month, $year);
    $adjustments = payroll_rohlik_adjustments($month, $year);
    $rows = [];
    foreach ($stmt->fetchAll() as $row) {
        [$rohlik, $adjustment] = payroll_match_rohlik($row, $rohlikRows, $adjustments);
        $isRohlik = is_array($rohlik);
        $hours = $isRohlik ? (float)$rohlik['worked_hours'] : (float)$row['timesheet_hours'];
        $bonusHours = $isRohlik ? (float)$rohlik['bonus_hours'] : 0.0;
        $rawPayableHours = $isRohlik ? (float)$rohlik['payable_hours'] : $hours;
        $deductionPct = $isRohlik ? max(0.0, min(100.0, (float)($row['company_hour_deduction_pct'] ?? 0))) : 0.0;
        $payableHours = $deductionPct > 0 ? round($rawPayableHours * (1 - $deductionPct / 100), 2) : $rawPayableHours;
        $employeeRate = (float)($row['employee_hourly_rate'] ?? 0);
        $manualRate = (float)($adjustment['hourly_rate'] ?? 0);
        $hourlyRate = $employeeRate > 0 ? $employeeRate : $manualRate;
        $manualAdvance = (float)($adjustment['advance_amount'] ?? 0);
        $approvedAdvances = (float)$row['approved_advances'];
        $advances = round($approvedAdvances + $manualAdvance, 2);
        $bonusAmount = (float)($adjustment['bonus_amount'] ?? 0);
        $deductionAmount = (float)($adjustment['deduction_amount'] ?? 0);
        $contractKind = payroll_contract_kind((string)($adjustment['contract_type'] ?? '')) ?: payroll_contract_kind((string)($row['contract_type'] ?? ''));
        $housing = (float)$row['housing'];
        $insuranceAmount = $includePayouts ? (float)($row['insurance_amount'] ?? 0) : 0.0;
        $gross = round($payableHours * $hourlyRate, 2);
        $net = round($gross + $bonusAmount + $insuranceAmount - $deductionAmount - $advances - $housing, 2);
        $row['source'] = $isRohlik ? 'rohlik' : 'timesheets';
        $row['contract_type'] = $contractKind ?: (string)($row['contract_type'] ?? '');
        $row['contract_kind'] = $contractKind ?: '-';
        $row['hours'] = round($hours, 2);
        $row['bonus_hours'] = round($bonusHours, 2);
        $row['payable_hours'] = round($payableHours, 2);
        $row['raw_hours'] = round($rawPayableHours, 2);
        $row['hour_deduction_pct'] = round($deductionPct, 2);
        $row['hourly_rate'] = round($hourlyRate, 2);
        $row['profile_hourly_rate'] = round($employeeRate, 2);
        $row['manual_hourly_rate'] = round($manualRate, 2);
        $row['rate_source'] = $employeeRate > 0 ? 'employee_card' : ($manualRate > 0 ? 'rohlik_manual' : 'missing');
        $row['approved_advances'] = round($approvedAdvances, 2);
        $row['manual_advances'] = round($manualAdvance, 2);
        $row['advances'] = $advances;
        $row['bonus_amount'] = round($bonusAmount, 2);
        $row['deduction_amount'] = round($deductionAmount, 2);
        $row['insurance_amount'] = round($insuranceAmount, 2);
        $row['gross'] = $gross;
        $row['net'] = $net;
        if ($includePayouts) {
            $row['card_amount'] = round((float)($row['card_amount'] ?? 0), 2);
            $row['cash_amount'] = round((float)($row['cash_amount'] ?? 0), 2);
            $row['debt_amount'] = round((float)($row['debt_amount'] ?? 0), 2);
            $row['debt_note'] = $row['debt_note'] ?? null;
            $row['debt_carried_over'] = (int)($row['debt_carried_over'] ?? 0);
            $row['social_paid'] = (int)($row['social_paid'] ?? 0);
            $row['health_paid'] = (int)($row['health_paid'] ?? 0);
            $row['remains'] = round($net - $row['card_amount'] - $row['cash_amount'] - $row['debt_amount'], 2);
        }
        $rows[] = $row;
    }
    return $rows;
}

function payroll_totals(array $rows, array $keys): array
{
    $totals = array_fill_keys($keys, 0.0);
    foreach ($rows as $row) {
        foreach ($keys as $key) {
            $totals[$key] += (float)($row[$key] ?? 0);
        }
    }
    foreach ($totals as &$value) {
        $value = round((float)$value, 2);
    }
    unset($value);
    return $totals;
}
