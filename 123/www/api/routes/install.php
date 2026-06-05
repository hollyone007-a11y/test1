<?php
declare(strict_types=1);

$key = $_GET['key'] ?? '';
if (INSTALL_KEY === '' || !hash_equals(INSTALL_KEY, (string)$key)) {
    json_response(['ok' => false, 'error' => 'Install key required'], 403);
}

$schemaFile = __DIR__ . '/../../schema.sql';
if (!is_file($schemaFile)) {
    json_response(['ok' => false, 'error' => 'schema.sql not found'], 500);
}

$sql = file_get_contents($schemaFile);
if ($sql === false) {
    json_response(['ok' => false, 'error' => 'schema.sql unreadable'], 500);
}

$pdo = db();
try {
    $pdo->exec($sql);
    ensure_runtime_schema();
    ensure_default_admin();
    audit_log(null, 'INSTALL', 'schema', null, ['time' => date('c')]);
    json_response(['ok' => true, 'message' => 'Schema installed']);
} catch (Throwable $e) {
    throw $e;
}
