<?php
declare(strict_types=1);

$exportUser = require_permission('exports.view');

$type = $_GET['type'] ?? 'salary';
$month = (int)($_GET['month'] ?? date('n'));
$year = (int)($_GET['year'] ?? date('Y'));

function csv_out(string $filename, array $headers, array $rows): void
{
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF");
    fputcsv($out, $headers, ';');
    foreach ($rows as $row) {
        fputcsv($out, $row, ';');
    }
    fclose($out);
    exit;
}

if ($type === 'employees' || $type === 'employee_archive') {
    require_permission('employees.view');
    [$scopeSql, $scopeParams] = current_employee_filter($exportUser, 'e');
    $status = $type === 'employee_archive' ? 'archived' : 'active';
    $stmt = db()->prepare("SELECT e.name,e.phone,e.email,e.warehouse_email,c.name AS company_name,o.name AS object_name,e.hourly_rate,e.housing_cost,e.status,e.contract_type,e.notes FROM employees e LEFT JOIN companies c ON c.id=e.company_id LEFT JOIN objects o ON o.id=e.object_id WHERE e.status = ? $scopeSql ORDER BY e.name");
    array_unshift($scopeParams, $status);
    $stmt->execute($scopeParams);
    $rows = $stmt->fetchAll();
    csv_out($type === 'employee_archive' ? 'buildpay-employees-archive.csv' : 'buildpay-employees.csv', ['Jmeno', 'Telefon', 'E-mail', 'Sklad e-mail', 'Firma', 'Objekt', 'Sazba', 'Bydleni', 'Stav', 'Kontrakt', 'Poznamka'], array_map(fn($r) => [
        $r['name'], $r['phone'], $r['email'], $r['warehouse_email'], $r['company_name'], $r['object_name'], $r['hourly_rate'], $r['housing_cost'], $r['status'], $r['contract_type'], $r['notes'],
    ], $rows));
}

if ($type === 'cash') {
    require_permission('cash.view');
    $companyId = has_global_scope($exportUser) ? (int)($_GET['company_id'] ?? 0) : 0;
    $companySql = $companyId > 0 ? ' AND o.company_id = ?' : '';
    $stmt = db()->prepare("SELECT c.type,c.amount,c.description,c.date,o.name AS object_name,u.name AS user_name FROM cash_register c LEFT JOIN objects o ON o.id=c.object_id LEFT JOIN users u ON u.id=c.created_by WHERE MONTH(c.date)=? AND YEAR(c.date)=? $companySql ORDER BY c.date DESC, c.id DESC");
    $stmt->execute($companyId > 0 ? [$month, $year, $companyId] : [$month, $year]);
    csv_out("buildpay-cash-$year-$month.csv", ['Typ', 'Castka', 'Popis', 'Datum', 'Objekt', 'Uzivatel'], array_map(fn($r) => [
        $r['type'], $r['amount'], $r['description'], $r['date'], $r['object_name'], $r['user_name'],
    ], $stmt->fetchAll()));
}

if ($type === 'salary') {
    require_permission('salary.view');
    $rows = payroll_rows($month, $year, $exportUser, true);
    csv_out("buildpay-salary-$year-$month.csv", ['Zamestnanec', 'Firma', 'Objekt', 'Bydleni', 'Zdroj', 'Hodiny', 'Bonus hodiny', 'Hodiny k vyplate', 'Sazba', 'Zdroj sazby', 'Hrube', 'Bonusy', 'Srazky', 'Zalohy schvalene', 'Zalohy rucne', 'Zalohy celkem', 'Srazka bydleni', 'Bonus pojisteni', 'Final k vyplate', 'Karta', 'Hotovost', 'Zustava'], array_map(fn($r) => [
        $r['employee_name'], $r['company_name'], $r['object_name'], $r['accommodation_name'] ?? '', $r['source'], $r['hours'], $r['bonus_hours'], $r['payable_hours'], $r['hourly_rate'], $r['rate_source'] ?? '', $r['gross'], $r['bonus_amount'], $r['deduction_amount'], $r['approved_advances'] ?? 0, $r['manual_advances'] ?? 0, $r['advances'], $r['housing'], $r['insurance_amount'] ?? 0, $r['net'], $r['card_amount'] ?? 0, $r['cash_amount'] ?? 0, $r['remains'] ?? 0,
    ], $rows));
}

if ($type === 'accounting') {
    require_permission('accounting.view');
    $rows = array_merge(
        payroll_rows($month, $year, $exportUser, true),
        payroll_stavba_rows($month, $year, $exportUser, true)
    );
    csv_out("buildpay-accounting-$year-$month.csv", ['Jmeno a prijmeni', 'Firma', 'Objekt', 'Cislo uctu', 'Na ucet', 'Hotovost', 'Cislo smlouvy', 'Dohoda / kontrakt', 'Socialka zaplacena', 'Zdravotka zaplacena', 'Final k vyplate'], array_map(fn($r) => [
        $r['employee_name'],
        $r['company_name'],
        $r['object_name'],
        $r['bank_account'] ?? '',
        $r['card_amount'] ?? 0,
        $r['cash_amount'] ?? 0,
        $r['contract_number'] ?? '',
        $r['contract_type'] ?? '',
        !empty($r['social_paid']) ? 'ANO' : 'NE',
        !empty($r['health_paid']) ? 'ANO' : 'NE',
        $r['net'] ?? 0,
    ], $rows));
}

json_response(['ok' => false, 'error' => 'Unknown export type'], 404);

