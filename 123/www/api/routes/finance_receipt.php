<?php
declare(strict_types=1);

$user = require_permission('finance.write');
$expenseId = (int)($_GET['expense_id'] ?? 0);
if (!$expenseId) {
    json_response(['ok' => false, 'error' => 'Missing expense_id'], 422);
}
if (empty($_FILES['receipt']) || !is_uploaded_file($_FILES['receipt']['tmp_name'])) {
    json_response(['ok' => false, 'error' => 'Missing receipt file'], 422);
}

$stmt = db()->prepare('SELECT * FROM company_expenses WHERE id = ? AND deleted_at IS NULL LIMIT 1');
$stmt->execute([$expenseId]);
$expense = $stmt->fetch();
if (!$expense) {
    json_response(['ok' => false, 'error' => 'Expense not found'], 404);
}
if (!has_global_scope($user)) {
    json_response(['ok' => false, 'error' => 'Permission denied'], 403);
}

$name = (string)($_FILES['receipt']['name'] ?? 'receipt');
$ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
$allowed = ['jpg', 'jpeg', 'png', 'webp', 'pdf'];
if (!in_array($ext, $allowed, true)) {
    json_response(['ok' => false, 'error' => 'Unsupported receipt type'], 422);
}

$dir = dirname(__DIR__, 2) . '/uploads/receipts';
if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
    json_response(['ok' => false, 'error' => 'Cannot create receipt directory'], 500);
}
$filename = 'receipt-' . $expenseId . '-' . date('YmdHis') . '-' . bin2hex(random_bytes(4)) . '.' . $ext;
$target = $dir . '/' . $filename;
if (!move_uploaded_file($_FILES['receipt']['tmp_name'], $target)) {
    json_response(['ok' => false, 'error' => 'Upload failed'], 500);
}
$path = 'uploads/receipts/' . $filename;
db()->prepare('UPDATE company_expenses SET receipt_path = ? WHERE id = ?')->execute([$path, $expenseId]);
audit_log($user, 'RECEIPT_UPLOAD', 'company_expenses', $expenseId, ['path' => $path]);
json_response(['ok' => true, 'path' => $path]);
