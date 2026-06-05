<?php
declare(strict_types=1);

$method = request_method();
$parts = explode('/', request_path());
$type = $parts[1] ?? ($_GET['type'] ?? 'sim_cards');
$id = isset($parts[2]) ? (int)$parts[2] : null;

if (!in_array($type, ['sim_cards', 'vehicles', 'tools', 'accommodations', 'coordinator_expenses'], true)) {
    json_response(['ok' => false, 'error' => 'Unknown resource type'], 404);
}

function resource_id_list(array $data, string $key): array
{
    $values = $data[$key] ?? [];
    if (!is_array($values)) {
        $values = [$values];
    }
    return array_values(array_unique(array_filter(array_map(static fn($value): int => (int)$value, $values))));
}

function sync_accommodation_occupants(int $accommodationId, array $employeeIds, float $monthlyCost): void
{
    db()->prepare('UPDATE employees SET accommodation_id = NULL, housing_cost = 0 WHERE accommodation_id = ?')->execute([$accommodationId]);
    if (!$employeeIds) {
        return;
    }
    $placeholders = implode(',', array_fill(0, count($employeeIds), '?'));
    $params = array_merge([$accommodationId, $monthlyCost], $employeeIds);
    db()->prepare("UPDATE employees SET accommodation_id = ?, housing_cost = ? WHERE id IN ($placeholders)")->execute($params);
}

function resource_status(string $value, array $allowed, string $fallback): string
{
    return in_array($value, $allowed, true) ? $value : $fallback;
}

if ($method === 'GET') {
    $user = require_permission('resources.view');
    $companyId = has_global_scope($user) ? (int)($_GET['company_id'] ?? 0) : 0;
    $companySql = $companyId > 0 ? 'WHERE %s.company_id = ?' : '';
    $params = $companyId > 0 ? [$companyId] : [];
    if ($type === 'sim_cards') {
        $stmt = db()->prepare('SELECT s.*, c.name AS company_name, e.name AS employee_name FROM company_sim_cards s LEFT JOIN companies c ON c.id = s.company_id LEFT JOIN employees e ON e.id = s.assigned_employee_id ' . sprintf($companySql, 's') . ' ORDER BY s.status, s.phone_number');
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
    } elseif ($type === 'vehicles') {
        $stmt = db()->prepare('SELECT v.*, c.name AS company_name, e.name AS employee_name FROM company_vehicles v LEFT JOIN companies c ON c.id = v.company_id LEFT JOIN employees e ON e.id = v.assigned_employee_id ' . sprintf($companySql, 'v') . ' ORDER BY v.status, v.plate_number');
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
    } elseif ($type === 'tools') {
        $stmt = db()->prepare('SELECT t.*, c.name AS company_name, e.name AS employee_name, e.avatar_path AS employee_avatar_path FROM company_tools t LEFT JOIN companies c ON c.id = t.company_id LEFT JOIN employees e ON e.id = t.assigned_employee_id ' . sprintf($companySql, 't') . ' ORDER BY FIELD(t.status, "assigned","available","service","lost","written_off"), t.name');
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
    } elseif ($type === 'coordinator_expenses') {
        $month = (int)($_GET['month'] ?? date('n'));
        $year = (int)($_GET['year'] ?? date('Y'));
        $where = ['MONTH(x.expense_date) = ?', 'YEAR(x.expense_date) = ?'];
        $expenseParams = [$month, $year];
        if ($companyId > 0) {
            $where[] = 'x.company_id = ?';
            $expenseParams[] = $companyId;
        }
        $stmt = db()->prepare('SELECT x.*, c.name AS company_name, u.name AS coordinator_name, e.name AS employee_name, e.avatar_path AS employee_avatar_path, v.plate_number AS vehicle_plate, cu.name AS created_by_name FROM coordinator_expenses x LEFT JOIN companies c ON c.id = x.company_id LEFT JOIN users u ON u.id = x.coordinator_user_id LEFT JOIN employees e ON e.id = x.employee_id LEFT JOIN company_vehicles v ON v.id = x.vehicle_id LEFT JOIN users cu ON cu.id = x.created_by WHERE ' . implode(' AND ', $where) . ' ORDER BY x.expense_date DESC, x.id DESC');
        $stmt->execute($expenseParams);
        $rows = $stmt->fetchAll();
    } else {
        $stmt = db()->prepare('SELECT a.*, c.name AS company_name, COUNT(e.id) AS occupants_count, GROUP_CONCAT(e.id ORDER BY e.name SEPARATOR ",") AS occupant_ids, GROUP_CONCAT(e.name ORDER BY e.name SEPARATOR ", ") AS occupant_names FROM accommodations a LEFT JOIN companies c ON c.id = a.company_id LEFT JOIN employees e ON e.accommodation_id = a.id AND e.status = "active" ' . sprintf($companySql, 'a') . ' GROUP BY a.id ORDER BY a.status, a.name');
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
    }
    json_response(['ok' => true, 'data' => $rows]);
}

if ($method === 'POST') {
    $user = require_permission('resources.write');
    $data = read_json();
    if ($type === 'sim_cards') {
        require_fields($data, ['phone_number']);
        $stmt = db()->prepare('INSERT INTO company_sim_cards (company_id,assigned_employee_id,phone_number,operator,iccid,registered_to,monthly_cost,status,notes) VALUES (?,?,?,?,?,?,?,?,?)');
        $stmt->execute([
            int_or_null($data, 'company_id'),
            int_or_null($data, 'assigned_employee_id'),
            first_string($data, 'phone_number', 80),
            nullable_string($data, 'operator', 120),
            nullable_string($data, 'iccid', 120),
            nullable_string($data, 'registered_to', 255),
            money_value($data, 'monthly_cost'),
            in_array(($data['status'] ?? 'active'), ['active', 'inactive', 'lost'], true) ? $data['status'] : 'active',
            nullable_string($data, 'notes'),
        ]);
    } elseif ($type === 'vehicles') {
        require_fields($data, ['plate_number']);
        $stmt = db()->prepare('INSERT INTO company_vehicles (company_id,assigned_employee_id,plate_number,brand_model,vin,insurance_until,stk_until,status,notes) VALUES (?,?,?,?,?,?,?,?,?)');
        $stmt->execute([
            int_or_null($data, 'company_id'),
            int_or_null($data, 'assigned_employee_id'),
            first_string($data, 'plate_number', 80),
            nullable_string($data, 'brand_model', 255),
            nullable_string($data, 'vin', 120),
            date_or_null($data, 'insurance_until'),
            date_or_null($data, 'stk_until'),
            in_array(($data['status'] ?? 'active'), ['active', 'service', 'inactive'], true) ? $data['status'] : 'active',
            nullable_string($data, 'notes'),
        ]);
    } elseif ($type === 'tools') {
        require_fields($data, ['name']);
        $stmt = db()->prepare('INSERT INTO company_tools (company_id,assigned_employee_id,name,category,inventory_number,serial_number,purchase_price,issued_at,status,notes) VALUES (?,?,?,?,?,?,?,?,?,?)');
        $assigned = int_or_null($data, 'assigned_employee_id');
        $stmt->execute([
            int_or_null($data, 'company_id'),
            $assigned,
            first_string($data, 'name'),
            nullable_string($data, 'category', 120),
            nullable_string($data, 'inventory_number', 120),
            nullable_string($data, 'serial_number', 120),
            money_value($data, 'purchase_price'),
            date_or_null($data, 'issued_at'),
            resource_status((string)($data['status'] ?? ($assigned ? 'assigned' : 'available')), ['available', 'assigned', 'service', 'lost', 'written_off'], $assigned ? 'assigned' : 'available'),
            nullable_string($data, 'notes'),
        ]);
    } elseif ($type === 'coordinator_expenses') {
        require_fields($data, ['expense_date', 'title']);
        $stmt = db()->prepare('INSERT INTO coordinator_expenses (company_id,coordinator_user_id,employee_id,vehicle_id,category,amount,expense_date,title,payment_method,receipt_number,note,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
        $stmt->execute([
            int_or_null($data, 'company_id'),
            int_or_null($data, 'coordinator_user_id') ?: (int)$user['id'],
            int_or_null($data, 'employee_id'),
            int_or_null($data, 'vehicle_id'),
            resource_status((string)($data['category'] ?? 'other'), ['advance', 'fuel', 'tool', 'housing', 'transport', 'other'], 'other'),
            money_value($data, 'amount'),
            date_or_null($data, 'expense_date') ?: date('Y-m-d'),
            first_string($data, 'title'),
            resource_status((string)($data['payment_method'] ?? 'cash'), ['cash', 'card', 'bank', 'other'], 'cash'),
            nullable_string($data, 'receipt_number', 120),
            nullable_string($data, 'note'),
            (int)$user['id'],
        ]);
    } else {
        require_fields($data, ['name']);
        $monthlyCost = money_value($data, 'monthly_cost');
        $stmt = db()->prepare('INSERT INTO accommodations (company_id,name,address,capacity,monthly_cost,contact_person,contact_phone,status,notes) VALUES (?,?,?,?,?,?,?,?,?)');
        $stmt->execute([
            int_or_null($data, 'company_id'),
            first_string($data, 'name'),
            nullable_string($data, 'address'),
            (int)($data['capacity'] ?? 0),
            $monthlyCost,
            nullable_string($data, 'contact_person', 255),
            nullable_string($data, 'contact_phone', 80),
            in_array(($data['status'] ?? 'active'), ['active', 'inactive'], true) ? $data['status'] : 'active',
            nullable_string($data, 'notes'),
        ]);
    }
    $newId = (int)db()->lastInsertId();
    if ($type === 'accommodations') {
        sync_accommodation_occupants($newId, resource_id_list($data, 'occupant_ids'), money_value($data, 'monthly_cost'));
    }
    audit_log($user, 'CREATE', $type, $newId, $data);
    json_response(['ok' => true, 'id' => $newId], 201);
}

if ($method === 'PUT' && $id) {
    $user = require_permission('resources.write');
    $data = read_json();
    if ($type === 'sim_cards') {
        require_fields($data, ['phone_number']);
        $stmt = db()->prepare('UPDATE company_sim_cards SET company_id=?, assigned_employee_id=?, phone_number=?, operator=?, iccid=?, registered_to=?, monthly_cost=?, status=?, notes=? WHERE id=?');
        $stmt->execute([
            int_or_null($data, 'company_id'),
            int_or_null($data, 'assigned_employee_id'),
            first_string($data, 'phone_number', 80),
            nullable_string($data, 'operator', 120),
            nullable_string($data, 'iccid', 120),
            nullable_string($data, 'registered_to', 255),
            money_value($data, 'monthly_cost'),
            in_array(($data['status'] ?? 'active'), ['active', 'inactive', 'lost'], true) ? $data['status'] : 'active',
            nullable_string($data, 'notes'),
            $id,
        ]);
    } elseif ($type === 'vehicles') {
        require_fields($data, ['plate_number']);
        $stmt = db()->prepare('UPDATE company_vehicles SET company_id=?, assigned_employee_id=?, plate_number=?, brand_model=?, vin=?, insurance_until=?, stk_until=?, status=?, notes=? WHERE id=?');
        $stmt->execute([
            int_or_null($data, 'company_id'),
            int_or_null($data, 'assigned_employee_id'),
            first_string($data, 'plate_number', 80),
            nullable_string($data, 'brand_model', 255),
            nullable_string($data, 'vin', 120),
            date_or_null($data, 'insurance_until'),
            date_or_null($data, 'stk_until'),
            in_array(($data['status'] ?? 'active'), ['active', 'service', 'inactive'], true) ? $data['status'] : 'active',
            nullable_string($data, 'notes'),
            $id,
        ]);
    } elseif ($type === 'tools') {
        require_fields($data, ['name']);
        $assigned = int_or_null($data, 'assigned_employee_id');
        $stmt = db()->prepare('UPDATE company_tools SET company_id=?, assigned_employee_id=?, name=?, category=?, inventory_number=?, serial_number=?, purchase_price=?, issued_at=?, status=?, notes=? WHERE id=?');
        $stmt->execute([
            int_or_null($data, 'company_id'),
            $assigned,
            first_string($data, 'name'),
            nullable_string($data, 'category', 120),
            nullable_string($data, 'inventory_number', 120),
            nullable_string($data, 'serial_number', 120),
            money_value($data, 'purchase_price'),
            date_or_null($data, 'issued_at'),
            resource_status((string)($data['status'] ?? ($assigned ? 'assigned' : 'available')), ['available', 'assigned', 'service', 'lost', 'written_off'], $assigned ? 'assigned' : 'available'),
            nullable_string($data, 'notes'),
            $id,
        ]);
    } elseif ($type === 'coordinator_expenses') {
        require_fields($data, ['expense_date', 'title']);
        $stmt = db()->prepare('UPDATE coordinator_expenses SET company_id=?, coordinator_user_id=?, employee_id=?, vehicle_id=?, category=?, amount=?, expense_date=?, title=?, payment_method=?, receipt_number=?, note=? WHERE id=?');
        $stmt->execute([
            int_or_null($data, 'company_id'),
            int_or_null($data, 'coordinator_user_id') ?: (int)$user['id'],
            int_or_null($data, 'employee_id'),
            int_or_null($data, 'vehicle_id'),
            resource_status((string)($data['category'] ?? 'other'), ['advance', 'fuel', 'tool', 'housing', 'transport', 'other'], 'other'),
            money_value($data, 'amount'),
            date_or_null($data, 'expense_date') ?: date('Y-m-d'),
            first_string($data, 'title'),
            resource_status((string)($data['payment_method'] ?? 'cash'), ['cash', 'card', 'bank', 'other'], 'cash'),
            nullable_string($data, 'receipt_number', 120),
            nullable_string($data, 'note'),
            $id,
        ]);
    } else {
        require_fields($data, ['name']);
        $monthlyCost = money_value($data, 'monthly_cost');
        $stmt = db()->prepare('UPDATE accommodations SET company_id=?, name=?, address=?, capacity=?, monthly_cost=?, contact_person=?, contact_phone=?, status=?, notes=? WHERE id=?');
        $stmt->execute([
            int_or_null($data, 'company_id'),
            first_string($data, 'name'),
            nullable_string($data, 'address'),
            (int)($data['capacity'] ?? 0),
            $monthlyCost,
            nullable_string($data, 'contact_person', 255),
            nullable_string($data, 'contact_phone', 80),
            in_array(($data['status'] ?? 'active'), ['active', 'inactive'], true) ? $data['status'] : 'active',
            nullable_string($data, 'notes'),
            $id,
        ]);
        sync_accommodation_occupants($id, resource_id_list($data, 'occupant_ids'), $monthlyCost);
    }
    audit_log($user, 'UPDATE', $type, $id, $data);
    json_response(['ok' => true]);
}

if ($method === 'DELETE' && $id) {
    $user = require_permission('resources.write');
    $table = ['sim_cards' => 'company_sim_cards', 'vehicles' => 'company_vehicles', 'tools' => 'company_tools', 'accommodations' => 'accommodations', 'coordinator_expenses' => 'coordinator_expenses'][$type];
    if ($type === 'accommodations') {
        db()->prepare('UPDATE employees SET accommodation_id = NULL, housing_cost = 0 WHERE accommodation_id = ?')->execute([$id]);
    }
    db()->prepare("DELETE FROM $table WHERE id = ?")->execute([$id]);
    audit_log($user, 'DELETE', $type, $id);
    json_response(['ok' => true]);
}

json_response(['ok' => false, 'error' => 'Resources route not found'], 404);
