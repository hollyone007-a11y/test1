<?php
declare(strict_types=1);

$privateFile = __DIR__ . '/private.php';
$private = is_file($privateFile) ? require $privateFile : [];

define('APP_NAME', 'BuildPay');
define('APP_URL', rtrim((string)($private['app_url'] ?? ''), '/'));
define('APP_SECRET', (string)($private['app_secret'] ?? 'change-me'));
define('APP_DEBUG', (bool)($private['app_debug'] ?? false));
define('INSTALL_KEY', (string)($private['install_key'] ?? ''));

define('DB_HOST', (string)($private['db_host'] ?? 'sql5.webzdarma.cz'));
define('DB_NAME', (string)($private['db_name'] ?? ''));
define('DB_USER', (string)($private['db_user'] ?? ''));
define('DB_PASS', (string)($private['db_pass'] ?? ''));

define('DEFAULT_ADMIN_EMAIL', (string)($private['admin_email'] ?? 'admin@buildpay.cz'));
define('DEFAULT_ADMIN_PASSWORD', (string)($private['admin_password'] ?? 'BuildPay2026!'));
define('PUSH_PUBLIC_KEY', (string)($private['push_public_key'] ?? ''));
define('PUSH_PRIVATE_KEY', (string)($private['push_private_key'] ?? ''));
define('PUSH_PRIVATE_PEM', (string)($private['push_private_pem'] ?? ''));
define('PUSH_SUBJECT', (string)($private['push_subject'] ?? (APP_URL ?: 'mailto:admin@buildpay.cz')));

const SESSION_NAME = 'pokladna_session';
const DEFAULT_PERMISSIONS = [
    'dashboard.view',
    'scope.all',
    'employees.view',
    'employees.write',
    'documents.view',
    'documents.write',
    'companies.view',
    'companies.write',
    'objects.view',
    'objects.write',
    'timesheets.view',
    'timesheets.write',
    'timesheets.approve',
    'salary.view',
    'accounting.view',
    'payouts.view',
    'payouts.write',
    'monthclose.view',
    'monthclose.write',
    'exports.view',
    'advances.view',
    'advances.write',
    'checkins.view',
    'checkins.write',
    'chat.view',
    'chat.write',
    'stavba.view',
    'stavba.write',
    'resources.view',
    'resources.write',
    'recruitment.view',
    'recruitment.write',
    'rohlik.view',
    'rohlik.write',
    'warehouse.view',
    'warehouse.sync',
    'cash.view',
    'cash.write',
    'logs.view',
    'users.view',
    'users.write',
    'permissions.write',
];
