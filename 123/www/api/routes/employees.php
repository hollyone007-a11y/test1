<?php
declare(strict_types=1);

$method = request_method();
$parts = explode('/', request_path());
$id = isset($parts[1]) ? (int)$parts[1] : null;
$sub = $parts[2] ?? '';

function jmhz_questionnaire_payload(array $data): ?string
{
    $keys = [
        'jmhz_first_names', 'jmhz_last_name', 'jmhz_titles', 'jmhz_birth_surname', 'jmhz_previous_surnames',
        'jmhz_gender', 'jmhz_birth_place', 'jmhz_birth_country', 'jmhz_citizenship', 'jmhz_education_level',
        'jmhz_id_document_type', 'jmhz_id_document_number',
        'jmhz_permanent_street', 'jmhz_permanent_house_number', 'jmhz_permanent_orientation_number', 'jmhz_permanent_zip', 'jmhz_permanent_city', 'jmhz_permanent_country', 'jmhz_permanent_ruian',
        'jmhz_contact_street', 'jmhz_contact_house_number', 'jmhz_contact_orientation_number', 'jmhz_contact_zip', 'jmhz_contact_city', 'jmhz_contact_country', 'jmhz_contact_ruian',
        'jmhz_data_box', 'jmhz_electronic_communication', 'jmhz_ecommunication_password',
        'jmhz_health_insurance_company', 'jmhz_tax_residence', 'jmhz_tax_declaration', 'jmhz_disability_pension', 'jmhz_student', 'jmhz_pension', 'jmhz_children_count',
        'jmhz_cz_isco', 'jmhz_weekly_hours', 'jmhz_foreigner_status', 'jmhz_work_permit_number', 'jmhz_work_permit_valid_until', 'jmhz_residence_permit_number', 'jmhz_residence_permit_valid_until',
        'jmhz_notes',
    ];
    $payload = [];
    foreach ($keys as $key) {
        $payload[$key] = trim((string)($data[$key] ?? ''));
    }
    $hasValue = false;
    foreach ($payload as $value) {
        if ($value !== '') {
            $hasValue = true;
            break;
        }
    }
    return $hasValue ? json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null;
}

function jmhz_questionnaire_keys(): array
{
    return [
        'jmhz_first_names', 'jmhz_last_name', 'jmhz_titles', 'jmhz_birth_surname', 'jmhz_previous_surnames',
        'jmhz_gender', 'jmhz_birth_place', 'jmhz_birth_country', 'jmhz_citizenship', 'jmhz_education_level',
        'jmhz_id_document_type', 'jmhz_id_document_number',
        'jmhz_permanent_street', 'jmhz_permanent_house_number', 'jmhz_permanent_orientation_number', 'jmhz_permanent_zip', 'jmhz_permanent_city', 'jmhz_permanent_country', 'jmhz_permanent_ruian',
        'jmhz_contact_street', 'jmhz_contact_house_number', 'jmhz_contact_orientation_number', 'jmhz_contact_zip', 'jmhz_contact_city', 'jmhz_contact_country', 'jmhz_contact_ruian',
        'jmhz_data_box', 'jmhz_electronic_communication', 'jmhz_ecommunication_password',
        'jmhz_health_insurance_company', 'jmhz_tax_residence', 'jmhz_tax_declaration', 'jmhz_disability_pension', 'jmhz_student', 'jmhz_pension', 'jmhz_children_count',
        'jmhz_cz_isco', 'jmhz_weekly_hours', 'jmhz_foreigner_status', 'jmhz_work_permit_number', 'jmhz_work_permit_valid_until', 'jmhz_residence_permit_number', 'jmhz_residence_permit_valid_until',
        'jmhz_notes',
    ];
}

function employee_self_value(array $data, array $old, string $key, int $max = 65535): ?string
{
    if (!array_key_exists($key, $data)) {
        return $old[$key] ?? null;
    }
    return nullable_string($data, $key, $max);
}

function employee_self_date(array $data, array $old, string $key): ?string
{
    if (!array_key_exists($key, $data)) {
        return $old[$key] ?? null;
    }
    return date_or_null($data, $key);
}

function employee_self_jmhz_payload(array $data, array $old): ?string
{
    $current = [];
    if (!empty($old['jmhz_questionnaire'])) {
        $parsed = json_decode((string)$old['jmhz_questionnaire'], true);
        $current = is_array($parsed) ? $parsed : [];
    }
    foreach (jmhz_questionnaire_keys() as $key) {
        if (array_key_exists($key, $data)) {
            $current[$key] = trim((string)$data[$key]);
        }
    }
    return jmhz_questionnaire_payload($current);
}

function employee_safe_file_part(string $name): string
{
    $name = preg_replace('/[^A-Za-z0-9._-]+/', '-', $name);
    return trim((string)$name, '.-') ?: 'file';
}

function employee_upload_dir(int $employeeId, string $type): string
{
    $dir = dirname(__DIR__, 2) . '/uploads/' . $type . '/' . $employeeId;
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
    return $dir;
}

function employee_delete_tree(string $dir): void
{
    $root = realpath(dirname(__DIR__, 2) . '/uploads');
    $target = realpath($dir);
    if (!$root || !$target || strpos($target, $root) !== 0 || !is_dir($target)) {
        return;
    }
    $items = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($target, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($items as $item) {
        $item->isDir() ? @rmdir($item->getPathname()) : @unlink($item->getPathname());
    }
    @rmdir($target);
}

if ($method === 'POST' && $id && $sub === 'avatar') {
    $user = require_permission('employees.view');
    require_employee_access($user, $id);
    if (empty($_FILES['file']) || !is_uploaded_file($_FILES['file']['tmp_name'])) {
        json_response(['ok' => false, 'error' => 'Avatar file is required'], 422);
    }
    if ((int)$_FILES['file']['size'] > 4 * 1024 * 1024) {
        json_response(['ok' => false, 'error' => 'Avatar is too large'], 422);
    }
    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $mime = $finfo ? (string)finfo_file($finfo, $_FILES['file']['tmp_name']) : (string)($_FILES['file']['type'] ?? '');
    if ($finfo) {
        finfo_close($finfo);
    }
    $extensions = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/webp' => 'webp',
    ];
    if (!isset($extensions[$mime])) {
        json_response(['ok' => false, 'error' => 'Avatar must be JPG, PNG or WEBP'], 422);
    }
    $stmt = db()->prepare('SELECT avatar_path FROM employees WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $oldPath = (string)($stmt->fetchColumn() ?: '');
    $storedName = 'avatar-' . date('Ymd-His') . '-' . bin2hex(random_bytes(4)) . '.' . $extensions[$mime];
    $dir = employee_upload_dir($id, 'avatars');
    $target = $dir . '/' . employee_safe_file_part($storedName);
    if (!move_uploaded_file($_FILES['file']['tmp_name'], $target)) {
        json_response(['ok' => false, 'error' => 'Avatar upload failed'], 500);
    }
    $relative = 'uploads/avatars/' . $id . '/' . basename($target);
    db()->prepare('UPDATE employees SET avatar_path = ? WHERE id = ?')->execute([$relative, $id]);
    if ($oldPath !== '' && strpos($oldPath, 'uploads/avatars/' . $id . '/') === 0) {
        $oldFull = dirname(__DIR__, 2) . '/' . $oldPath;
        if (is_file($oldFull)) {
            @unlink($oldFull);
        }
    }
    audit_log($user, 'UPLOAD_AVATAR', 'employees', $id, ['avatar_path' => $relative]);
    json_response(['ok' => true, 'avatar_path' => $relative]);
}

if ($method === 'GET') {
    $user = require_permission('employees.view');
    $status = $_GET['status'] ?? '';
    $conditions = [];
    $params = [];
    if ($status === 'archived') {
        $conditions[] = "e.status = 'archived'";
    } elseif ($status !== 'all') {
        $conditions[] = "e.status = 'active'";
    }
    if (has_global_scope($user) && (int)($_GET['company_id'] ?? 0) > 0) {
        $conditions[] = 'e.company_id = ?';
        $params[] = (int)$_GET['company_id'];
    }
    if (!has_global_scope($user)) {
        $conditions[] = 'e.id = ?';
        $params[] = (int)($user['employee_id'] ?? 0);
    }
    $where = $conditions ? 'WHERE ' . implode(' AND ', $conditions) : '';
    $sql = "SELECT e.*, o.name AS object_name, o.work_type AS object_work_type, c.name AS company_name, a.name AS accommodation_name
            FROM employees e
            LEFT JOIN objects o ON o.id = e.object_id
            LEFT JOIN companies c ON c.id = e.company_id
            LEFT JOIN accommodations a ON a.id = e.accommodation_id
            $where
            ORDER BY e.status, e.name";
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    json_response(['ok' => true, 'data' => $stmt->fetchAll()]);
}

if ($method === 'POST') {
    $user = require_permission('employees.write');
    if (!has_global_scope($user)) {
        json_response(['ok' => false, 'error' => 'Permission denied'], 403);
    }
    $data = read_json();
    require_fields($data, ['name']);
    $stmt = db()->prepare('INSERT INTO employees (name,hourly_rate,housing_cost,company_id,object_id,accommodation_id,status,phone,email,warehouse_email,birth_date,address,residence_address,passport_number,passport_valid_until,personal_id_number,emergency_contact,bank_account,contract_type,contract_number,contract_start,contract_end,documents_note,jmhz_questionnaire,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    $stmt->execute([
        first_string($data, 'name'),
        money_value($data, 'hourly_rate'),
        money_value($data, 'housing_cost'),
        int_or_null($data, 'company_id'),
        int_or_null($data, 'object_id'),
        int_or_null($data, 'accommodation_id'),
        in_array(($data['status'] ?? 'active'), ['active', 'archived'], true) ? $data['status'] : 'active',
        nullable_string($data, 'phone', 80),
        nullable_string($data, 'email', 255),
        nullable_string($data, 'warehouse_email', 255),
        date_or_null($data, 'birth_date'),
        nullable_string($data, 'address'),
        nullable_string($data, 'residence_address'),
        nullable_string($data, 'passport_number', 120),
        date_or_null($data, 'passport_valid_until'),
        nullable_string($data, 'personal_id_number', 120),
        nullable_string($data, 'emergency_contact', 255),
        nullable_string($data, 'bank_account', 120),
        nullable_string($data, 'contract_type', 120),
        nullable_string($data, 'contract_number', 120),
        date_or_null($data, 'contract_start'),
        date_or_null($data, 'contract_end'),
        nullable_string($data, 'documents_note'),
        jmhz_questionnaire_payload($data),
        nullable_string($data, 'notes'),
    ]);
    $newId = (int)db()->lastInsertId();
    audit_log($user, 'CREATE', 'employees', $newId, $data);
    json_response(['ok' => true, 'id' => $newId], 201);
}

if ($method === 'PATCH' && $id && $sub === 'self') {
    $user = require_auth();
    require_employee_access($user, $id);
    $data = read_json();
    $oldStmt = db()->prepare('SELECT id,name,phone,email,birth_date,address,residence_address,passport_number,passport_valid_until,personal_id_number,emergency_contact,bank_account,documents_note,jmhz_questionnaire FROM employees WHERE id = ? LIMIT 1');
    $oldStmt->execute([$id]);
    $old = $oldStmt->fetch();
    if (!$old) {
        json_response(['ok' => false, 'error' => 'Employee not found'], 404);
    }
    $name = array_key_exists('name', $data) && trim((string)$data['name']) !== ''
        ? first_string($data, 'name')
        : (string)($old['name'] ?? '');
    $stmt = db()->prepare('UPDATE employees SET name=?, phone=?, email=?, birth_date=?, address=?, residence_address=?, passport_number=?, passport_valid_until=?, personal_id_number=?, emergency_contact=?, bank_account=?, documents_note=?, jmhz_questionnaire=? WHERE id=?');
    $stmt->execute([
        $name,
        employee_self_value($data, $old, 'phone', 80),
        employee_self_value($data, $old, 'email', 255),
        employee_self_date($data, $old, 'birth_date'),
        employee_self_value($data, $old, 'address'),
        employee_self_value($data, $old, 'residence_address'),
        employee_self_value($data, $old, 'passport_number', 120),
        employee_self_date($data, $old, 'passport_valid_until'),
        employee_self_value($data, $old, 'personal_id_number', 120),
        employee_self_value($data, $old, 'emergency_contact', 255),
        employee_self_value($data, $old, 'bank_account', 120),
        employee_self_value($data, $old, 'documents_note'),
        employee_self_jmhz_payload($data, $old),
        $id,
    ]);
    audit_log($user, 'UPDATE_SELF', 'employees', $id, $data, $old);
    json_response(['ok' => true]);
}

if ($method === 'PUT' && $id) {
    if ($sub === 'jmhz') {
        $user = require_auth();
        require_employee_access($user, $id);
        if ((int)($user['employee_id'] ?? 0) !== $id && !can($user, 'employees.write')) {
            json_response(['ok' => false, 'error' => 'Permission denied'], 403);
        }
        $data = read_json();
        $oldStmt = db()->prepare('SELECT id,documents_note,jmhz_questionnaire FROM employees WHERE id = ? LIMIT 1');
        $oldStmt->execute([$id]);
        $old = $oldStmt->fetch();
        if (!$old) {
            json_response(['ok' => false, 'error' => 'Employee not found'], 404);
        }
        db()->prepare('UPDATE employees SET documents_note=?, jmhz_questionnaire=? WHERE id=?')->execute([
            employee_self_value($data, $old, 'documents_note'),
            employee_self_jmhz_payload($data, $old),
            $id,
        ]);
        audit_log($user, 'UPDATE_JMHZ', 'employees', $id, $data, $old);
        json_response(['ok' => true]);
    }
    $user = require_permission('employees.write');
    require_employee_access($user, $id);
    if ($sub === 'restore') {
        if (!has_global_scope($user)) {
            json_response(['ok' => false, 'error' => 'Permission denied'], 403);
        }
        db()->prepare("UPDATE employees SET status = 'active', archived_at = NULL WHERE id = ?")->execute([$id]);
        audit_log($user, 'RESTORE', 'employees', $id);
        json_response(['ok' => true]);
    }
    $data = read_json();
    require_fields($data, ['name']);
    if (!has_global_scope($user)) {
        $stmt = db()->prepare('UPDATE employees SET name=?, phone=?, email=?, warehouse_email=?, birth_date=?, address=?, residence_address=?, passport_number=?, passport_valid_until=?, personal_id_number=?, emergency_contact=?, bank_account=?, contract_type=?, contract_number=?, contract_start=?, contract_end=?, documents_note=?, jmhz_questionnaire=?, notes=? WHERE id=?');
        $stmt->execute([
            first_string($data, 'name'),
            nullable_string($data, 'phone', 80),
            nullable_string($data, 'email', 255),
            nullable_string($data, 'warehouse_email', 255),
            date_or_null($data, 'birth_date'),
            nullable_string($data, 'address'),
            nullable_string($data, 'residence_address'),
            nullable_string($data, 'passport_number', 120),
            date_or_null($data, 'passport_valid_until'),
            nullable_string($data, 'personal_id_number', 120),
            nullable_string($data, 'emergency_contact', 255),
            nullable_string($data, 'bank_account', 120),
            nullable_string($data, 'contract_type', 120),
            nullable_string($data, 'contract_number', 120),
            date_or_null($data, 'contract_start'),
            date_or_null($data, 'contract_end'),
            nullable_string($data, 'documents_note'),
            jmhz_questionnaire_payload($data),
            nullable_string($data, 'notes'),
            $id,
        ]);
        audit_log($user, 'UPDATE_SELF', 'employees', $id, $data);
        json_response(['ok' => true]);
    }
    $status = in_array(($data['status'] ?? 'active'), ['active', 'archived'], true) ? $data['status'] : 'active';
    $stmt = db()->prepare("UPDATE employees SET name=?, hourly_rate=?, housing_cost=?, company_id=?, object_id=?, accommodation_id=?, status=?, phone=?, email=?, warehouse_email=?, birth_date=?, address=?, residence_address=?, passport_number=?, passport_valid_until=?, personal_id_number=?, emergency_contact=?, bank_account=?, contract_type=?, contract_number=?, contract_start=?, contract_end=?, documents_note=?, jmhz_questionnaire=?, notes=?, archived_at = IF(? = 'archived' AND archived_at IS NULL, NOW(), IF(? = 'active', NULL, archived_at)) WHERE id=?");
    $stmt->execute([
        first_string($data, 'name'),
        money_value($data, 'hourly_rate'),
        money_value($data, 'housing_cost'),
        int_or_null($data, 'company_id'),
        int_or_null($data, 'object_id'),
        int_or_null($data, 'accommodation_id'),
        $status,
        nullable_string($data, 'phone', 80),
        nullable_string($data, 'email', 255),
        nullable_string($data, 'warehouse_email', 255),
        date_or_null($data, 'birth_date'),
        nullable_string($data, 'address'),
        nullable_string($data, 'residence_address'),
        nullable_string($data, 'passport_number', 120),
        date_or_null($data, 'passport_valid_until'),
        nullable_string($data, 'personal_id_number', 120),
        nullable_string($data, 'emergency_contact', 255),
        nullable_string($data, 'bank_account', 120),
        nullable_string($data, 'contract_type', 120),
        nullable_string($data, 'contract_number', 120),
        date_or_null($data, 'contract_start'),
        date_or_null($data, 'contract_end'),
        nullable_string($data, 'documents_note'),
        jmhz_questionnaire_payload($data),
        nullable_string($data, 'notes'),
        $status,
        $status,
        $id,
    ]);
    audit_log($user, 'UPDATE', 'employees', $id, $data);
    json_response(['ok' => true]);
}

if ($method === 'DELETE' && $id && $sub === 'force') {
    $user = require_permission('employees.write');
    if (!has_global_scope($user)) {
        json_response(['ok' => false, 'error' => 'Permission denied'], 403);
    }
    $stmt = db()->prepare('SELECT status FROM employees WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $status = (string)($stmt->fetchColumn() ?: '');
    if ($status === '') {
        json_response(['ok' => false, 'error' => 'Employee not found'], 404);
    }
    if ($status !== 'archived') {
        json_response(['ok' => false, 'error' => 'Employee must be archived before delete'], 422);
    }
    db()->prepare('DELETE FROM employees WHERE id = ?')->execute([$id]);
    employee_delete_tree(dirname(__DIR__, 2) . '/uploads/employees/' . $id);
    employee_delete_tree(dirname(__DIR__, 2) . '/uploads/avatars/' . $id);
    audit_log($user, 'DELETE_FORCE', 'employees', $id);
    json_response(['ok' => true]);
}

if ($method === 'DELETE' && $id) {
    $user = require_permission('employees.write');
    if (!has_global_scope($user)) {
        json_response(['ok' => false, 'error' => 'Permission denied'], 403);
    }
    $stmt = db()->prepare("UPDATE employees SET status = 'archived', archived_at = NOW() WHERE id = ?");
    $stmt->execute([$id]);
    audit_log($user, 'ARCHIVE', 'employees', $id);
    json_response(['ok' => true]);
}

json_response(['ok' => false, 'error' => 'Employees route not found'], 404);
