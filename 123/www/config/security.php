<?php
declare(strict_types=1);

function permission_labels(): array
{
    return [
        'dashboard.view' => 'Dashboard',
        'scope.all' => 'Viditelnost vsech lidi',
        'employees.view' => 'Zamestnanci - cteni',
        'employees.write' => 'Zamestnanci - upravy',
        'documents.view' => 'Dokumenty zamestnancu - cteni',
        'documents.write' => 'Dokumenty zamestnancu - nahravani',
        'companies.view' => 'Firmy - cteni',
        'companies.write' => 'Firmy - upravy',
        'objects.view' => 'Objekty - cteni',
        'objects.write' => 'Objekty - upravy',
        'timesheets.view' => 'Hodiny - cteni',
        'timesheets.write' => 'Hodiny - upravy',
        'timesheets.approve' => 'Hodiny - schvalovani',
        'salary.view' => 'Mzdy',
        'accounting.view' => 'Ucetni prehled',
        'payouts.view' => 'Vyplaty - cteni',
        'payouts.write' => 'Vyplaty - upravy',
        'finance.view' => 'Naklady / prijmy - cteni',
        'finance.write' => 'Naklady / prijmy - upravy',
        'monthclose.view' => 'Uzaverky - cteni',
        'monthclose.write' => 'Uzaverky - sprava',
        'exports.view' => 'Exporty CSV',
        'advances.view' => 'Zalohy - cteni',
        'advances.write' => 'Zalohy - upravy',
        'checkins.view' => 'Check-iny - cteni',
        'checkins.write' => 'Check-iny - upravy',
        'chat.view' => 'Chat se zamestnanci - cteni',
        'chat.write' => 'Chat se zamestnanci - psani',
        'stavba.view' => 'Stavba - cteni',
        'stavba.write' => 'Stavba - rucni hodiny',
        'resources.view' => 'SIM, auta, bydleni - cteni',
        'resources.write' => 'SIM, auta, bydleni - upravy',
        'recruitment.view' => 'Naborova databaze - cteni',
        'recruitment.write' => 'Naborova databaze - upravy',
        'rohlik.view' => 'Rohlik Brno - cteni',
        'rohlik.write' => 'Rohlik Brno - upravy',
        'rohlik_shifts.view' => 'Rohlik smeny - cteni',
        'rohlik_shifts.request' => 'Rohlik smeny - zadosti o volno',
        'rohlik_shifts.write' => 'Rohlik smeny - planovani a schvalovani',
        'warehouse.view' => 'Sklad - cteni',
        'warehouse.sync' => 'Sklad - synchronizace',
        'cash.view' => 'Hotovost - cteni',
        'cash.write' => 'Hotovost - upravy',
        'logs.view' => 'Logy',
        'users.view' => 'Uzivatele - cteni',
        'users.write' => 'Uzivatele - upravy',
        'permissions.write' => 'Opravneni',
    ];
}

function self_default_permissions(): array
{
    return [
        'dashboard.view',
        'employees.view',
        'documents.view',
        'documents.write',
        'timesheets.view',
        'timesheets.write',
        'advances.view',
        'advances.write',
        'checkins.view',
        'checkins.write',
        'chat.view',
        'chat.write',
        'rohlik_shifts.view',
        'rohlik_shifts.request',
    ];
}

function coordinator_default_permissions(): array
{
    return [
        'dashboard.view',
        'scope.all',
        'companies.view',
        'objects.view',
        'employees.view',
        'documents.view',
        'timesheets.view',
        'checkins.view',
        'chat.view',
        'chat.write',
        'stavba.view',
        'rohlik_shifts.view',
        'rohlik_shifts.request',
        'rohlik_shifts.write',
        'resources.view',
        'resources.write',
        'advances.view',
        'advances.write',
    ];
}

function accountant_default_permissions(): array
{
    return [
        'dashboard.view',
        'scope.all',
        'companies.view',
        'objects.view',
        'employees.view',
        'documents.view',
        'salary.view',
        'accounting.view',
        'payouts.view',
        'finance.view',
        'exports.view',
        'monthclose.view',
        'rohlik.view',
        'warehouse.view',
    ];
}

function default_permissions_for_role(string $role): array
{
    if ($role === 'coordinator') {
        return coordinator_default_permissions();
    }
    if ($role === 'accountant') {
        return accountant_default_permissions();
    }
    return self_default_permissions();
}

function can(array $user, string $permission): bool
{
    $role = (string)($user['role'] ?? '');
    if ($role === 'admin') {
        return true;
    }
    if (in_array($permission, default_permissions_for_role($role), true)) {
        return true;
    }
    $stmt = db()->prepare('SELECT allowed FROM user_permissions WHERE user_id = ? AND permission_key = ? LIMIT 1');
    $stmt->execute([(int)$user['id'], $permission]);
    return (bool)$stmt->fetchColumn();
}

function has_global_scope(array $user): bool
{
    return (($user['role'] ?? '') === 'admin') || can($user, 'scope.all');
}

function require_employee_access(array $user, int $employeeId): void
{
    if (has_global_scope($user)) {
        return;
    }
    if (!$employeeId || (int)($user['employee_id'] ?? 0) !== $employeeId) {
        json_response(['ok' => false, 'error' => 'Permission denied'], 403);
    }
}

function current_employee_filter(array $user, string $alias = 'e'): array
{
    if (has_global_scope($user)) {
        $companyId = (int)($_GET['company_id'] ?? 0);
        if ($companyId > 0) {
            return [" AND $alias.company_id = ?", [$companyId]];
        }
        return ['', []];
    }
    $employeeId = (int)($user['employee_id'] ?? 0);
    if (!$employeeId) {
        return [" AND $alias.id = 0", []];
    }
    return [" AND $alias.id = ?", [$employeeId]];
}

function permissions_for_user(array $user): array
{
    $role = (string)($user['role'] ?? '');
    if ($role === 'admin') {
        return array_fill_keys(array_keys(permission_labels()), true);
    }
    $stmt = db()->prepare('SELECT permission_key, allowed FROM user_permissions WHERE user_id = ?');
    $stmt->execute([(int)$user['id']]);
    $result = array_fill_keys(array_keys(permission_labels()), false);
    foreach ($stmt->fetchAll() as $row) {
        $result[$row['permission_key']] = (bool)$row['allowed'];
    }
    foreach (default_permissions_for_role($role) as $key) {
        $result[$key] = true;
    }
    return $result;
}

function public_user(array $user): array
{
    return [
        'id' => (int)$user['id'],
        'email' => $user['email'],
        'name' => $user['name'],
        'role' => $user['role'],
        'employee_id' => $user['employee_id'] === null ? null : (int)$user['employee_id'],
        'permissions' => permissions_for_user($user),
    ];
}

function assign_default_permissions(int $userId, string $role = 'user'): void
{
    $allowed = default_permissions_for_role($role);
    $stmt = db()->prepare('INSERT INTO user_permissions (user_id,permission_key,allowed) VALUES (?,?,?) ON DUPLICATE KEY UPDATE allowed = VALUES(allowed)');
    foreach (permission_labels() as $key => $_) {
        $stmt->execute([$userId, $key, in_array($key, $allowed, true) ? 1 : 0]);
    }
}

function ensure_default_admin(): void
{
    if (!table_exists('users')) {
        return;
    }
    $count = (int)db()->query('SELECT COUNT(*) FROM users')->fetchColumn();
    if ($count > 0) {
        return;
    }
    $stmt = db()->prepare('INSERT INTO users (email,password_hash,role,name) VALUES (?,?,?,?)');
    $stmt->execute([
        DEFAULT_ADMIN_EMAIL,
        password_hash(DEFAULT_ADMIN_PASSWORD, PASSWORD_DEFAULT),
        'admin',
        'Administrator',
    ]);
}
