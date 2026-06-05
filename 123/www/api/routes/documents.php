<?php
declare(strict_types=1);

$method = request_method();
$parts = explode('/', request_path());
$id = isset($parts[1]) ? (int)$parts[1] : null;
$sub = $parts[2] ?? '';

function document_upload_dir(int $employeeId): string
{
    $dir = dirname(__DIR__, 2) . '/uploads/employees/' . $employeeId;
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
    return $dir;
}

function safe_file_part(string $name): string
{
    $name = preg_replace('/[^A-Za-z0-9._-]+/', '-', $name);
    return trim((string)$name, '.-') ?: 'file';
}

function document_can_view(array $user, array $doc): bool
{
    if (has_global_scope($user)) {
        return true;
    }
    if ((int)($user['employee_id'] ?? 0) === (int)$doc['employee_id']) {
        return true;
    }
    return (int)($doc['uploaded_by'] ?? 0) === (int)$user['id'];
}

function document_can_view_employee(array $user, int $employeeId): bool
{
    if ($employeeId <= 0) {
        return false;
    }
    if (has_global_scope($user) || (int)($user['employee_id'] ?? 0) === $employeeId) {
        return true;
    }
    $stmt = db()->prepare('SELECT COUNT(*) FROM employee_documents WHERE employee_id = ? AND uploaded_by = ?');
    $stmt->execute([$employeeId, (int)$user['id']]);
    return (int)$stmt->fetchColumn() > 0;
}

function document_stream(array $doc): void
{
    $path = dirname(__DIR__, 2) . '/' . $doc['stored_path'];
    if (!is_file($path)) {
        json_response(['ok' => false, 'error' => 'File not found'], 404);
    }
    $fileName = safe_file_part((string)($doc['original_name'] ?? basename($path)));
    $mime = (string)($doc['mime_type'] ?? 'application/octet-stream') ?: 'application/octet-stream';
    if (!preg_match('~^[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+$~', $mime)) {
        $mime = 'application/octet-stream';
    }
    header('Content-Type: ' . $mime);
    header('Content-Length: ' . (string)filesize($path));
    header('Content-Disposition: inline; filename="' . $fileName . '"');
    header('Cache-Control: private, max-age=0, must-revalidate');
    readfile($path);
    exit;
}

if ($method === 'GET' && $id && $sub === 'download') {
    $user = require_permission('documents.view');
    $stmt = db()->prepare('SELECT * FROM employee_documents WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $doc = $stmt->fetch();
    if (!$doc) {
        json_response(['ok' => false, 'error' => 'Document not found'], 404);
    }
    if (!document_can_view($user, $doc)) {
        json_response(['ok' => false, 'error' => 'Permission denied'], 403);
    }
    document_stream($doc);
}

if ($method === 'GET') {
    $user = require_permission('documents.view');
    $employeeId = (int)($_GET['employee_id'] ?? ($user['employee_id'] ?? 0));
    if (!document_can_view_employee($user, $employeeId)) {
        json_response(['ok' => false, 'error' => 'Permission denied'], 403);
    }
    $ownEmployee = (int)($user['employee_id'] ?? 0) === $employeeId;
    $onlyOwnUploads = !has_global_scope($user) && !$ownEmployee;
    $extraSql = $onlyOwnUploads ? ' AND d.uploaded_by = ?' : '';
    $params = [$employeeId];
    if ($onlyOwnUploads) {
        $params[] = (int)$user['id'];
    }
    $stmt = db()->prepare('SELECT d.*, u.name AS uploaded_by_name, ru.name AS reviewed_by_name FROM employee_documents d LEFT JOIN users u ON u.id = d.uploaded_by LEFT JOIN users ru ON ru.id = d.reviewed_by WHERE d.employee_id = ?' . $extraSql . ' ORDER BY FIELD(d.status, "pending","approved","rejected"), FIELD(d.document_type, "passport","visa","residence","work_permit","insurance","contract","photo","phone","other"), d.created_at DESC');
    $stmt->execute($params);
    json_response(['ok' => true, 'data' => $stmt->fetchAll()]);
}

if ($method === 'POST') {
    $user = require_permission('documents.write');
    $employeeId = (int)($_POST['employee_id'] ?? ($user['employee_id'] ?? 0));
    require_employee_access($user, $employeeId);
    if (empty($_FILES['file']) || !is_uploaded_file($_FILES['file']['tmp_name'])) {
        json_response(['ok' => false, 'error' => 'File is required'], 422);
    }
    if ((int)$_FILES['file']['size'] > 12 * 1024 * 1024) {
        json_response(['ok' => false, 'error' => 'File is too large'], 422);
    }
    $original = safe_file_part((string)$_FILES['file']['name']);
    $ext = pathinfo($original, PATHINFO_EXTENSION);
    $blocked = ['php', 'phtml', 'phar', 'php3', 'php4', 'php5', 'php7', 'php8', 'htaccess'];
    if ($ext && in_array(strtolower($ext), $blocked, true)) {
        json_response(['ok' => false, 'error' => 'This file type is not allowed'], 422);
    }
    $storedName = date('Ymd-His') . '-' . bin2hex(random_bytes(4)) . ($ext ? '.' . safe_file_part($ext) : '');
    $dir = document_upload_dir($employeeId);
    $target = $dir . '/' . $storedName;
    if (!move_uploaded_file($_FILES['file']['tmp_name'], $target)) {
        json_response(['ok' => false, 'error' => 'Upload failed'], 500);
    }
    $relative = 'uploads/employees/' . $employeeId . '/' . $storedName;
    $type = first_string($_POST, 'document_type', 120) ?: 'other';
    $title = first_string($_POST, 'title') ?: $original;
    $status = has_global_scope($user) ? 'approved' : 'pending';
    $stmt = db()->prepare('INSERT INTO employee_documents (employee_id,document_type,title,original_name,stored_path,mime_type,file_size,issued_at,expires_at,note,uploaded_by,status,reviewed_by,reviewed_at,rejection_note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)');
    $stmt->execute([
        $employeeId,
        $type,
        $title,
        $original,
        $relative,
        $_FILES['file']['type'] ?? null,
        (int)$_FILES['file']['size'],
        date_or_null($_POST, 'issued_at'),
        date_or_null($_POST, 'expires_at'),
        nullable_string($_POST, 'note'),
        (int)$user['id'],
        $status,
        $status === 'approved' ? (int)$user['id'] : null,
        $status === 'approved' ? date('Y-m-d H:i:s') : null,
    ]);
    $newId = (int)db()->lastInsertId();
    audit_log($user, 'UPLOAD', 'employee_documents', $newId, ['employee_id' => $employeeId, 'title' => $title]);
    if ($status === 'pending') {
        push_notify_admins((int)$user['id']);
    } else {
        push_notify_employee($employeeId, (int)$user['id']);
    }
    json_response(['ok' => true, 'id' => $newId], 201);
}

if ($method === 'PUT' && $id && in_array($sub, ['approve', 'reject'], true)) {
    $user = require_permission('documents.write');
    if (!has_global_scope($user)) {
        json_response(['ok' => false, 'error' => 'Only administrator can review documents'], 403);
    }
    $data = read_json();
    $stmt = db()->prepare('SELECT employee_id FROM employee_documents WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $employeeId = (int)$stmt->fetchColumn();
    if (!$employeeId) {
        json_response(['ok' => false, 'error' => 'Document not found'], 404);
    }
    require_employee_access($user, $employeeId);
    $status = $sub === 'approve' ? 'approved' : 'rejected';
    db()->prepare('UPDATE employee_documents SET status=?, reviewed_by=?, reviewed_at=NOW(), rejection_note=? WHERE id=?')->execute([
        $status,
        (int)$user['id'],
        $status === 'rejected' ? nullable_string($data, 'rejection_note') : null,
        $id,
    ]);
    audit_log($user, strtoupper($sub), 'employee_documents', $id, $data);
    push_notify_employee($employeeId, (int)$user['id']);
    json_response(['ok' => true, 'status' => $status]);
}

if ($method === 'DELETE' && $id) {
    $user = require_permission('documents.write');
    if (!has_global_scope($user)) {
        json_response(['ok' => false, 'error' => 'Only administrator can delete documents'], 403);
    }
    $stmt = db()->prepare('SELECT * FROM employee_documents WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $doc = $stmt->fetch();
    if (!$doc) {
        json_response(['ok' => false, 'error' => 'Document not found'], 404);
    }
    require_employee_access($user, (int)$doc['employee_id']);
    $path = dirname(__DIR__, 2) . '/' . $doc['stored_path'];
    if (is_file($path)) {
        unlink($path);
    }
    db()->prepare('DELETE FROM employee_documents WHERE id = ?')->execute([$id]);
    audit_log($user, 'DELETE', 'employee_documents', $id);
    json_response(['ok' => true]);
}

json_response(['ok' => false, 'error' => 'Documents route not found'], 404);
