<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/bootstrap.php';

try {
    $path = request_path();
    $segment = explode('/', $path)[0] ?: 'health';

    if ($segment === 'health') {
        json_response(['ok' => true, 'app' => APP_NAME, 'time' => date('c')]);
    }

    if ($segment !== 'install') {
        ensure_schema_loaded();
        ensure_default_admin();
    }
    if ($segment !== 'auth' && $segment !== 'health' && $segment !== 'install') {
        require_csrf();
    }

    $routes = [
        'auth' => __DIR__ . '/routes/auth.php',
        'dashboard' => __DIR__ . '/routes/dashboard.php',
        'companies' => __DIR__ . '/routes/companies.php',
        'employees' => __DIR__ . '/routes/employees.php',
        'documents' => __DIR__ . '/routes/documents.php',
        'objects' => __DIR__ . '/routes/objects.php',
        'timesheets' => __DIR__ . '/routes/timesheets.php',
        'advances' => __DIR__ . '/routes/advances.php',
        'housing' => __DIR__ . '/routes/housing.php',
        'salary' => __DIR__ . '/routes/salary.php',
        'payouts' => __DIR__ . '/routes/payouts.php',
        'finance' => __DIR__ . '/routes/finance.php',
        'finance-receipt' => __DIR__ . '/routes/finance_receipt.php',
        'finance_receipt' => __DIR__ . '/routes/finance_receipt.php',
        'monthclose' => __DIR__ . '/routes/monthclose.php',
        'exports' => __DIR__ . '/routes/exports.php',
        'checkins' => __DIR__ . '/routes/checkins.php',
        'chat' => __DIR__ . '/routes/chat.php',
        'push' => __DIR__ . '/routes/push.php',
        'weather' => __DIR__ . '/routes/weather.php',
        'stavba' => __DIR__ . '/routes/stavba.php',
        'resources' => __DIR__ . '/routes/resources.php',
        'recruitment' => __DIR__ . '/routes/recruitment.php',
        'rohlik' => __DIR__ . '/routes/rohlik.php',
        'rohlik-shifts' => __DIR__ . '/routes/rohlik_shifts.php',
        'warehouse' => __DIR__ . '/routes/warehouse.php',
        'cash' => __DIR__ . '/routes/cash.php',
        'users' => __DIR__ . '/routes/users.php',
        'blocks' => __DIR__ . '/routes/blocks.php',
        'logs' => __DIR__ . '/routes/logs.php',
        'install' => __DIR__ . '/routes/install.php',
    ];

    if (!isset($routes[$segment])) {
        json_response(['ok' => false, 'error' => 'Route not found'], 404);
    }
    require $routes[$segment];
} catch (Throwable $e) {
    error_log('API error: ' . $e->getMessage());
    json_response(['ok' => false, 'error' => APP_DEBUG ? $e->getMessage() : 'Server error'], 500);
}
