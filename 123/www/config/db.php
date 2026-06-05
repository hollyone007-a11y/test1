<?php
declare(strict_types=1);

function db_hosts(): array
{
    return array_values(array_unique(array_filter([
        DB_HOST,
        'sql5.webzdarma.cz',
        'mysql.webzdarma.cz',
    ])));
}

function db_users(): array
{
    $user = DB_USER;
    $base = preg_replace('/[^A-Za-z0-9_]+/', '_', $user);
    $first = explode('.', $user)[0] ?? $user;
    return array_values(array_unique(array_filter([
        $user,
        $first,
        $base,
        str_replace('.', '_', $user),
    ])));
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    if (DB_USER === '' || DB_PASS === '') {
        throw new RuntimeException('Database credentials are not configured.');
    }

    $options = [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ];

    $errors = [];
    foreach (db_hosts() as $host) {
        foreach (db_users() as $user) {
            $dbNames = array_values(array_unique(array_filter([
                DB_NAME,
                $user,
                preg_replace('/[^A-Za-z0-9_]+/', '_', $user),
                explode('.', $user)[0] ?? $user,
            ])));
            foreach ($dbNames as $dbName) {
                try {
                    $pdo = new PDO('mysql:host=' . $host . ';dbname=' . $dbName . ';charset=utf8mb4', $user, DB_PASS, $options);
                    $pdo->exec("SET time_zone = '+01:00'");
                    return $pdo;
                } catch (Throwable $e) {
                    $errors[] = $host . '/' . $user . '/' . $dbName . ': ' . $e->getMessage();
                }
            }
        }
    }

    foreach (db_hosts() as $host) {
        foreach (db_users() as $user) {
            try {
                $server = new PDO('mysql:host=' . $host . ';charset=utf8mb4', $user, DB_PASS, $options);
                $rows = $server->query('SHOW DATABASES')->fetchAll(PDO::FETCH_COLUMN);
                foreach ($rows as $dbName) {
                    try {
                        $pdo = new PDO('mysql:host=' . $host . ';dbname=' . $dbName . ';charset=utf8mb4', $user, DB_PASS, $options);
                        return $pdo;
                    } catch (Throwable $e) {
                        $errors[] = $host . '/' . $user . '/' . $dbName . ': ' . $e->getMessage();
                    }
                }
            } catch (Throwable $e) {
                $errors[] = $host . '/' . $user . ': ' . $e->getMessage();
            }
        }    
    }

    error_log('DB connection failed: ' . implode(' | ', $errors));
    throw new RuntimeException('Database connection failed.');
}

function table_exists(string $table): bool
{
    $stmt = db()->prepare('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?');
    $stmt->execute([$table]);
    return ((int)$stmt->fetchColumn()) > 0;
}

function column_exists(string $table, string $column): bool
{
    $stmt = db()->prepare('SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?');
    $stmt->execute([$table, $column]);
    return ((int)$stmt->fetchColumn()) > 0;
}

function index_exists(string $table, string $index): bool
{
    $stmt = db()->prepare('SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?');
    $stmt->execute([$table, $index]);
    return ((int)$stmt->fetchColumn()) > 0;
}

function add_column_if_missing(string $table, string $column, string $definition): void
{
    if (!column_exists($table, $column)) {
        db()->exec("ALTER TABLE `$table` ADD COLUMN $definition");
    }
}

function merged_timesheet_status(array $summary, ?string $currentStatus = null): string
{
    if ($currentStatus === 'pending' || (int)($summary['pending_count'] ?? 0) > 0) {
        return 'pending';
    }
    if ($currentStatus === 'approved' || (int)($summary['approved_count'] ?? 0) > 0) {
        return 'approved';
    }
    return 'rejected';
}

function merged_timesheet_note(?string $currentNote, ?string $addedNote): ?string
{
    $parts = array_values(array_filter([
        trim((string)$currentNote),
        trim((string)$addedNote),
    ], static fn(string $value): bool => $value !== ''));
    return $parts ? implode("\n", $parts) : null;
}

function normalize_timesheet_missing_work_dates(PDO $pdo): void
{
    if (!table_exists('timesheets') || !column_exists('timesheets', 'work_date')) {
        return;
    }
    $pdo->exec('SET SESSION group_concat_max_len = 65535');
    $groups = $pdo->query("SELECT
            employee_id,
            STR_TO_DATE(CONCAT(year, '-', month, '-1'), '%Y-%c-%e') AS target_date,
            MIN(id) AS keep_id,
            SUM(hours) AS merged_hours,
            GROUP_CONCAT(NULLIF(TRIM(COALESCE(note, '')), '') ORDER BY id SEPARATOR '\n') AS merged_note,
            SUM(status = 'pending') AS pending_count,
            SUM(status = 'approved') AS approved_count
        FROM timesheets
        WHERE work_date IS NULL
        GROUP BY employee_id, STR_TO_DATE(CONCAT(year, '-', month, '-1'), '%Y-%c-%e')")->fetchAll();

    $findExisting = $pdo->prepare('SELECT id, note, status FROM timesheets WHERE employee_id = ? AND work_date = ? LIMIT 1');
    $updateExisting = $pdo->prepare('UPDATE timesheets SET hours = hours + ?, note = ?, status = ? WHERE id = ?');
    $deleteNullGroup = $pdo->prepare("DELETE FROM timesheets WHERE employee_id = ? AND work_date IS NULL AND STR_TO_DATE(CONCAT(year, '-', month, '-1'), '%Y-%c-%e') = ?");
    $updateKeeper = $pdo->prepare('UPDATE timesheets SET work_date = ?, month = MONTH(?), year = YEAR(?), hours = ?, note = ?, status = ? WHERE id = ?');
    $deleteOtherNulls = $pdo->prepare("DELETE FROM timesheets WHERE employee_id = ? AND work_date IS NULL AND STR_TO_DATE(CONCAT(year, '-', month, '-1'), '%Y-%c-%e') = ? AND id <> ?");

    foreach ($groups as $group) {
        $employeeId = (int)$group['employee_id'];
        $targetDate = (string)$group['target_date'];
        $findExisting->execute([$employeeId, $targetDate]);
        $existing = $findExisting->fetch();
        if ($existing) {
            $updateExisting->execute([
                (float)$group['merged_hours'],
                merged_timesheet_note($existing['note'] ?? null, $group['merged_note'] ?? null),
                merged_timesheet_status($group, (string)$existing['status']),
                (int)$existing['id'],
            ]);
            $deleteNullGroup->execute([$employeeId, $targetDate]);
            continue;
        }
        $updateKeeper->execute([
            $targetDate,
            $targetDate,
            $targetDate,
            (float)$group['merged_hours'],
            $group['merged_note'] !== null ? (string)$group['merged_note'] : null,
            merged_timesheet_status($group),
            (int)$group['keep_id'],
        ]);
        $deleteOtherNulls->execute([$employeeId, $targetDate, (int)$group['keep_id']]);
    }
}

function normalize_timesheet_day_duplicates(PDO $pdo): void
{
    if (!table_exists('timesheets') || !column_exists('timesheets', 'work_date')) {
        return;
    }
    $pdo->exec('SET SESSION group_concat_max_len = 65535');
    $groups = $pdo->query("SELECT
            employee_id,
            work_date,
            MIN(id) AS keep_id,
            SUM(hours) AS merged_hours,
            GROUP_CONCAT(NULLIF(TRIM(COALESCE(note, '')), '') ORDER BY id SEPARATOR '\n') AS merged_note,
            SUM(status = 'pending') AS pending_count,
            SUM(status = 'approved') AS approved_count
        FROM timesheets
        WHERE work_date IS NOT NULL
        GROUP BY employee_id, work_date
        HAVING COUNT(*) > 1")->fetchAll();

    $updateKeeper = $pdo->prepare('UPDATE timesheets SET month = MONTH(work_date), year = YEAR(work_date), hours = ?, note = ?, status = ? WHERE id = ?');
    $deleteDuplicates = $pdo->prepare('DELETE FROM timesheets WHERE employee_id = ? AND work_date = ? AND id <> ?');

    foreach ($groups as $group) {
        $updateKeeper->execute([
            (float)$group['merged_hours'],
            $group['merged_note'] !== null ? (string)$group['merged_note'] : null,
            merged_timesheet_status($group),
            (int)$group['keep_id'],
        ]);
        $deleteDuplicates->execute([
            (int)$group['employee_id'],
            (string)$group['work_date'],
            (int)$group['keep_id'],
        ]);
    }
}

function ensure_runtime_schema(): void
{
    $pdo = db();

    if (table_exists('users') && column_exists('users', 'role')) {
        $pdo->exec("ALTER TABLE users MODIFY role ENUM('admin','coordinator','accountant','user') NOT NULL DEFAULT 'user'");
    }

    $pdo->exec("CREATE TABLE IF NOT EXISTS companies (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      ico VARCHAR(80) NULL,
      dic VARCHAR(80) NULL,
      address TEXT NULL,
      contact_person VARCHAR(255) NULL,
      phone VARCHAR(80) NULL,
      email VARCHAR(255) NULL,
      hour_deduction_pct DECIMAL(5,2) NOT NULL DEFAULT 0.00,
      notes TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    add_column_if_missing('companies', 'hour_deduction_pct', 'hour_deduction_pct DECIMAL(5,2) NOT NULL DEFAULT 0.00 AFTER email');
    $pdo->exec("UPDATE companies SET hour_deduction_pct = 3.00 WHERE hour_deduction_pct = 0 AND (LOWER(name) LIKE '%rohlik%' OR LOWER(name) LIKE '%roshpit%')");

    add_column_if_missing('objects', 'company_id', 'company_id INT UNSIGNED NULL AFTER id');
    add_column_if_missing('objects', 'work_type', "work_type VARCHAR(40) NOT NULL DEFAULT 'general' AFTER address");
    add_column_if_missing('objects', 'status', "status ENUM('active','archived') NOT NULL DEFAULT 'active' AFTER address");
    add_column_if_missing('objects', 'notes', 'notes TEXT NULL AFTER status');
    $pdo->exec("UPDATE objects SET work_type = 'stavba' WHERE work_type = 'general' AND (LOWER(name) LIKE '%stavba%' OR LOWER(name) LIKE '%fasada%' OR LOWER(name) LIKE '%fasáda%')");
    $pdo->exec("INSERT INTO objects (name, work_type, status, notes)
      SELECT 'Brno fasada', 'stavba', 'active', 'Default stavba group'
      WHERE NOT EXISTS (SELECT 1 FROM objects WHERE LOWER(name) IN ('brno fasada', 'brno fasáda'))");

    add_column_if_missing('employees', 'company_id', 'company_id INT UNSIGNED NULL AFTER housing_cost');
    add_column_if_missing('employees', 'accommodation_id', 'accommodation_id INT UNSIGNED NULL AFTER object_id');
    add_column_if_missing('employees', 'email', 'email VARCHAR(255) NULL AFTER phone');
    add_column_if_missing('employees', 'warehouse_email', 'warehouse_email VARCHAR(255) NULL AFTER email');
    add_column_if_missing('employees', 'birth_date', 'birth_date DATE NULL AFTER email');
    add_column_if_missing('employees', 'address', 'address TEXT NULL AFTER birth_date');
    add_column_if_missing('employees', 'residence_address', 'residence_address TEXT NULL AFTER address');
    add_column_if_missing('employees', 'passport_number', 'passport_number VARCHAR(120) NULL AFTER residence_address');
    add_column_if_missing('employees', 'passport_valid_until', 'passport_valid_until DATE NULL AFTER passport_number');
    add_column_if_missing('employees', 'personal_id_number', 'personal_id_number VARCHAR(120) NULL AFTER passport_valid_until');
    add_column_if_missing('employees', 'emergency_contact', 'emergency_contact VARCHAR(255) NULL AFTER personal_id_number');
    add_column_if_missing('employees', 'bank_account', 'bank_account VARCHAR(120) NULL AFTER emergency_contact');
    add_column_if_missing('employees', 'contract_type', 'contract_type VARCHAR(120) NULL AFTER bank_account');
    add_column_if_missing('employees', 'contract_number', 'contract_number VARCHAR(120) NULL AFTER contract_type');
    add_column_if_missing('employees', 'contract_start', 'contract_start DATE NULL AFTER contract_number');
    add_column_if_missing('employees', 'contract_end', 'contract_end DATE NULL AFTER contract_start');
    add_column_if_missing('employees', 'documents_note', 'documents_note TEXT NULL AFTER contract_end');
    add_column_if_missing('employees', 'jmhz_questionnaire', 'jmhz_questionnaire LONGTEXT NULL AFTER documents_note');
    add_column_if_missing('employees', 'avatar_path', 'avatar_path VARCHAR(255) NULL AFTER jmhz_questionnaire');

    add_column_if_missing('timesheets', 'work_date', 'work_date DATE NULL AFTER employee_id');
    add_column_if_missing('timesheets', 'work_start_at', 'work_start_at DATETIME NULL AFTER work_date');
    add_column_if_missing('timesheets', 'work_end_at', 'work_end_at DATETIME NULL AFTER work_start_at');
    if (!index_exists('timesheets', 'idx_timesheets_employee')) {
        $pdo->exec('ALTER TABLE timesheets ADD INDEX idx_timesheets_employee (employee_id)');
    }
    if (index_exists('timesheets', 'uq_timesheet_period')) {
        $pdo->exec('ALTER TABLE timesheets DROP INDEX uq_timesheet_period');
    }
    add_column_if_missing('timesheets', 'status', "status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'approved' AFTER note");
    add_column_if_missing('timesheets', 'submitted_by', 'submitted_by INT UNSIGNED NULL AFTER status');
    add_column_if_missing('timesheets', 'approved_by', 'approved_by INT UNSIGNED NULL AFTER submitted_by');
    add_column_if_missing('timesheets', 'approved_at', 'approved_at DATETIME NULL AFTER approved_by');
    add_column_if_missing('timesheets', 'rejection_note', 'rejection_note TEXT NULL AFTER approved_at');
    normalize_timesheet_missing_work_dates($pdo);
    normalize_timesheet_day_duplicates($pdo);
    if (!index_exists('timesheets', 'uq_timesheet_day')) {
        $pdo->exec('ALTER TABLE timesheets ADD UNIQUE KEY uq_timesheet_day (employee_id, work_date)');
    }

    add_column_if_missing('advances', 'status', "status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'approved' AFTER created_by");
    add_column_if_missing('advances', 'approved_by', 'approved_by INT UNSIGNED NULL AFTER status');
    add_column_if_missing('advances', 'approved_at', 'approved_at DATETIME NULL AFTER approved_by');
    add_column_if_missing('advances', 'paid_at', 'paid_at DATE NULL AFTER approved_at');
    add_column_if_missing('advances', 'rejection_note', 'rejection_note TEXT NULL AFTER paid_at');
    add_column_if_missing('advances', 'deleted_at', 'deleted_at DATETIME NULL AFTER rejection_note');
    add_column_if_missing('advances', 'deleted_by', 'deleted_by INT UNSIGNED NULL AFTER deleted_at');

    $pdo->exec("CREATE TABLE IF NOT EXISTS housing (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      employee_id INT UNSIGNED NOT NULL,
      month TINYINT UNSIGNED NOT NULL,
      year SMALLINT UNSIGNED NOT NULL,
      amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_housing_period (employee_id, month, year),
      KEY idx_housing_period (year, month)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    add_column_if_missing('checkins', 'last_seen_at', 'last_seen_at DATETIME NULL AFTER lng');
    add_column_if_missing('checkins', 'location_accuracy', 'location_accuracy DECIMAL(10,2) NULL AFTER lng');
    add_column_if_missing('checkins', 'location_captured_at', 'location_captured_at DATETIME NULL AFTER location_accuracy');
    add_column_if_missing('checkins', 'location_source', 'location_source VARCHAR(40) NULL AFTER location_captured_at');
    add_column_if_missing('checkins', 'location_locked', 'location_locked TINYINT(1) NOT NULL DEFAULT 0 AFTER location_source');
    add_column_if_missing('checkins', 'movement_points', 'movement_points INT UNSIGNED NOT NULL DEFAULT 0 AFTER location_locked');
    add_column_if_missing('checkins', 'duration_hours', 'duration_hours DECIMAL(7,2) NULL AFTER last_seen_at');
    add_column_if_missing('checkins', 'break_minutes', 'break_minutes INT UNSIGNED NOT NULL DEFAULT 30 AFTER duration_hours');
    add_column_if_missing('checkins', 'raw_duration_hours', 'raw_duration_hours DECIMAL(7,2) NULL AFTER break_minutes');
    add_column_if_missing('checkins', 'object_id', 'object_id INT UNSIGNED NULL AFTER employee_id');
    add_column_if_missing('checkins', 'status', "status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'approved' AFTER note");
    add_column_if_missing('checkins', 'approved_by', 'approved_by INT UNSIGNED NULL AFTER status');
    add_column_if_missing('checkins', 'approved_at', 'approved_at DATETIME NULL AFTER approved_by');
    add_column_if_missing('checkins', 'rejection_note', 'rejection_note TEXT NULL AFTER approved_at');

    $pdo->exec("CREATE TABLE IF NOT EXISTS company_sim_cards (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id INT UNSIGNED NULL,
      assigned_employee_id INT UNSIGNED NULL,
      phone_number VARCHAR(80) NOT NULL,
      operator VARCHAR(120) NULL,
      iccid VARCHAR(120) NULL,
      registered_to VARCHAR(255) NULL,
      monthly_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
      status ENUM('active','inactive','lost') NOT NULL DEFAULT 'active',
      notes TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS company_vehicles (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id INT UNSIGNED NULL,
      assigned_employee_id INT UNSIGNED NULL,
      plate_number VARCHAR(80) NOT NULL,
      brand_model VARCHAR(255) NULL,
      vin VARCHAR(120) NULL,
      insurance_until DATE NULL,
      stk_until DATE NULL,
      status ENUM('active','service','inactive') NOT NULL DEFAULT 'active',
      notes TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS company_tools (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id INT UNSIGNED NULL,
      assigned_employee_id INT UNSIGNED NULL,
      name VARCHAR(255) NOT NULL,
      category VARCHAR(120) NULL,
      inventory_number VARCHAR(120) NULL,
      serial_number VARCHAR(120) NULL,
      purchase_price DECIMAL(10,2) NOT NULL DEFAULT 0,
      issued_at DATE NULL,
      status ENUM('available','assigned','service','lost','written_off') NOT NULL DEFAULT 'available',
      notes TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS accommodations (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id INT UNSIGNED NULL,
      name VARCHAR(255) NOT NULL,
      address TEXT NULL,
      capacity INT UNSIGNED NOT NULL DEFAULT 0,
      monthly_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
      contact_person VARCHAR(255) NULL,
      contact_phone VARCHAR(80) NULL,
      status ENUM('active','inactive') NOT NULL DEFAULT 'active',
      notes TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS coordinator_expenses (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id INT UNSIGNED NULL,
      coordinator_user_id INT UNSIGNED NULL,
      employee_id INT UNSIGNED NULL,
      vehicle_id INT UNSIGNED NULL,
      category ENUM('advance','fuel','tool','housing','transport','other') NOT NULL DEFAULT 'other',
      amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      expense_date DATE NOT NULL,
      title VARCHAR(255) NOT NULL,
      payment_method ENUM('cash','card','bank','other') NOT NULL DEFAULT 'cash',
      receipt_number VARCHAR(120) NULL,
      note TEXT NULL,
      created_by INT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_coordinator_expenses_period (expense_date, category)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS recruitment_candidates (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      phone VARCHAR(80) NULL,
      email VARCHAR(255) NULL,
      source VARCHAR(120) NULL,
      desired_position VARCHAR(255) NULL,
      status ENUM('new','called','no_answer','interview','rejected','hired','blacklist') NOT NULL DEFAULT 'new',
      contacted_status VARCHAR(40) NOT NULL DEFAULT 'pending',
      work_result VARCHAR(40) NOT NULL DEFAULT 'undecided',
      last_contact_at DATETIME NULL,
      arrival_date DATE NULL,
      feedback TEXT NULL,
      result_note TEXT NULL,
      next_contact_at DATETIME NULL,
      created_by INT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    add_column_if_missing('recruitment_candidates', 'contacted_status', "contacted_status VARCHAR(40) NOT NULL DEFAULT 'pending' AFTER status");
    add_column_if_missing('recruitment_candidates', 'work_result', "work_result VARCHAR(40) NOT NULL DEFAULT 'undecided' AFTER contacted_status");
    add_column_if_missing('recruitment_candidates', 'last_contact_at', 'last_contact_at DATETIME NULL AFTER work_result');
    add_column_if_missing('recruitment_candidates', 'arrival_date', 'arrival_date DATE NULL AFTER last_contact_at');
    add_column_if_missing('recruitment_candidates', 'result_note', 'result_note TEXT NULL AFTER feedback');

    $pdo->exec("CREATE TABLE IF NOT EXISTS recruitment_comments (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      candidate_id INT UNSIGNED NOT NULL,
      reaction VARCHAR(40) NOT NULL DEFAULT 'note',
      contacted_status VARCHAR(40) NOT NULL DEFAULT 'pending',
      work_result VARCHAR(40) NOT NULL DEFAULT 'undecided',
      comment TEXT NULL,
      next_contact_at DATETIME NULL,
      arrival_date DATE NULL,
      created_by INT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_recruitment_comments_candidate (candidate_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS employee_documents (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      employee_id INT UNSIGNED NOT NULL,
      document_type VARCHAR(120) NOT NULL,
      title VARCHAR(255) NOT NULL,
      original_name VARCHAR(255) NOT NULL,
      stored_path VARCHAR(500) NOT NULL,
      mime_type VARCHAR(160) NULL,
      file_size INT UNSIGNED NOT NULL DEFAULT 0,
      issued_at DATE NULL,
      expires_at DATE NULL,
      note TEXT NULL,
      uploaded_by INT UNSIGNED NULL,
      status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'approved',
      reviewed_by INT UNSIGNED NULL,
      reviewed_at DATETIME NULL,
      rejection_note TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_employee_documents_employee (employee_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    add_column_if_missing('employee_documents', 'status', "status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'approved' AFTER uploaded_by");
    add_column_if_missing('employee_documents', 'reviewed_by', 'reviewed_by INT UNSIGNED NULL AFTER status');
    add_column_if_missing('employee_documents', 'reviewed_at', 'reviewed_at DATETIME NULL AFTER reviewed_by');
    add_column_if_missing('employee_documents', 'rejection_note', 'rejection_note TEXT NULL AFTER reviewed_at');

    $pdo->exec("CREATE TABLE IF NOT EXISTS payouts (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      employee_id INT UNSIGNED NOT NULL,
      month TINYINT UNSIGNED NOT NULL,
      year SMALLINT UNSIGNED NOT NULL,
      card_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      cash_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      insurance_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      paid_at DATE NULL,
      note TEXT NULL,
      created_by INT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_payout_period (employee_id, month, year)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    add_column_if_missing('payouts', 'insurance_amount', 'insurance_amount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER cash_amount');
    add_column_if_missing('payouts', 'debt_amount', 'debt_amount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER insurance_amount');
    add_column_if_missing('payouts', 'debt_note', 'debt_note TEXT NULL AFTER debt_amount');
    add_column_if_missing('payouts', 'debt_carried_over', 'debt_carried_over TINYINT(1) NOT NULL DEFAULT 0 AFTER debt_note');
    add_column_if_missing('payouts', 'social_paid', 'social_paid TINYINT(1) NOT NULL DEFAULT 0 AFTER insurance_amount');
    add_column_if_missing('payouts', 'health_paid', 'health_paid TINYINT(1) NOT NULL DEFAULT 0 AFTER social_paid');
    add_column_if_missing('payouts', 'deleted_at', 'deleted_at DATETIME NULL AFTER updated_at');
    add_column_if_missing('payouts', 'deleted_by', 'deleted_by INT UNSIGNED NULL AFTER deleted_at');

    $pdo->exec("CREATE TABLE IF NOT EXISTS cash_register (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      type ENUM('income','expense') NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      description TEXT NOT NULL,
      date DATE NOT NULL,
      object_id INT UNSIGNED NULL,
      created_by INT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_cash_date (date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    add_column_if_missing('cash_register', 'deleted_at', 'deleted_at DATETIME NULL AFTER created_at');
    add_column_if_missing('cash_register', 'deleted_by', 'deleted_by INT UNSIGNED NULL AFTER deleted_at');

    $pdo->exec("CREATE TABLE IF NOT EXISTS company_expenses (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id INT UNSIGNED NULL,
      month TINYINT UNSIGNED NOT NULL,
      year SMALLINT UNSIGNED NOT NULL,
      category VARCHAR(80) NOT NULL DEFAULT 'other',
      label VARCHAR(255) NULL,
      amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      notes TEXT NULL,
      is_recurring TINYINT(1) NOT NULL DEFAULT 0,
      is_auto TINYINT(1) NOT NULL DEFAULT 0,
      receipt_path VARCHAR(500) NULL,
      created_by INT UNSIGNED NULL,
      deleted_at DATETIME NULL,
      deleted_by INT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_company_expenses_period (company_id, year, month)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS company_revenues (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id INT UNSIGNED NULL,
      month TINYINT UNSIGNED NOT NULL,
      year SMALLINT UNSIGNED NOT NULL,
      source_type VARCHAR(40) NOT NULL DEFAULT 'manual',
      source_id INT UNSIGNED NULL,
      label VARCHAR(255) NULL,
      billed_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      cost_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      notes TEXT NULL,
      created_by INT UNSIGNED NULL,
      deleted_at DATETIME NULL,
      deleted_by INT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_company_revenues_period (company_id, year, month)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS audit_logs (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NULL,
      user_name VARCHAR(255) NULL,
      action VARCHAR(80) NOT NULL,
      entity VARCHAR(80) NOT NULL,
      entity_id INT UNSIGNED NULL,
      old_data LONGTEXT NULL,
      new_data LONGTEXT NULL,
      ip_address VARCHAR(45) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_audit_logs_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    add_column_if_missing('audit_logs', 'old_data', 'old_data LONGTEXT NULL AFTER entity_id');

    $pdo->exec("CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NULL,
      employee_id INT UNSIGNED NULL,
      endpoint_hash CHAR(64) NOT NULL,
      endpoint TEXT NOT NULL,
      p256dh VARCHAR(255) NULL,
      auth VARCHAR(255) NULL,
      user_agent VARCHAR(255) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_push_endpoint_hash (endpoint_hash),
      KEY idx_push_user (user_id),
      KEY idx_push_employee (employee_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS stavba_manual_hours (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      employee_id INT UNSIGNED NOT NULL,
      work_date DATE NOT NULL,
      hours DECIMAL(10,2) NOT NULL DEFAULT 0,
      note TEXT NULL,
      created_by INT UNSIGNED NULL,
      updated_by INT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_stavba_manual_day (employee_id, work_date),
      KEY idx_stavba_manual_employee (employee_id),
      KEY idx_stavba_manual_date (work_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS warehouse_suma (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      source_key VARCHAR(80) NOT NULL DEFAULT 'selitra',
      employee_id INT UNSIGNED NULL,
      period_start DATE NULL,
      period_end DATE NULL,
      email VARCHAR(255) NOT NULL,
      position VARCHAR(80) NULL,
      worked_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
      extra_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
      billing_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
      productivity_percent DECIMAL(10,2) NOT NULL DEFAULT 0,
      efficiency_percent DECIMAL(10,2) NOT NULL DEFAULT 0,
      note TEXT NULL,
      imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_warehouse_suma (source_key, period_start, period_end, email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    add_column_if_missing('warehouse_suma', 'employee_id', 'employee_id INT UNSIGNED NULL AFTER source_key');
    add_column_if_missing('warehouse_suma', 'productivity_percent', 'productivity_percent DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER billing_hours');
    add_column_if_missing('warehouse_suma', 'efficiency_percent', 'efficiency_percent DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER productivity_percent');
    add_column_if_missing('warehouse_suma', 'note', 'note TEXT NULL AFTER efficiency_percent');

    $pdo->exec("CREATE TABLE IF NOT EXISTS warehouse_daily (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      source_key VARCHAR(80) NOT NULL DEFAULT 'selitra',
      work_date DATE NOT NULL,
      email VARCHAR(255) NOT NULL,
      supplier VARCHAR(120) NULL,
      attendance_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
      worked_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
      attendance_percent DECIMAL(10,2) NOT NULL DEFAULT 0,
      productivity_percent DECIMAL(10,2) NOT NULL DEFAULT 0,
      efficiency_percent DECIMAL(10,2) NOT NULL DEFAULT 0,
      billing_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
      extra_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
      position VARCHAR(80) NULL,
      total_worked_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
      rate_label VARCHAR(120) NULL,
      imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_warehouse_daily (source_key, work_date, email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS rohlik_brno_adjustments (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      month TINYINT UNSIGNED NOT NULL,
      year SMALLINT UNSIGNED NOT NULL,
      email VARCHAR(255) NOT NULL,
      employee_id INT UNSIGNED NULL,
      full_name VARCHAR(255) NULL,
      contract_type VARCHAR(40) NULL,
      hourly_rate DECIMAL(10,2) NOT NULL DEFAULT 0,
      advance_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      bonus_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      deduction_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      card_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      cash_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      employer_health_amount DECIMAL(10,2) NULL DEFAULT NULL,
      employer_health_paid TINYINT(1) NOT NULL DEFAULT 0,
      note TEXT NULL,
      updated_by INT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_rohlik_adjustment (year, month, email),
      KEY idx_rohlik_employee (employee_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    add_column_if_missing('rohlik_brno_adjustments', 'contract_type', 'contract_type VARCHAR(40) NULL AFTER full_name');
    add_column_if_missing('rohlik_brno_adjustments', 'card_amount', 'card_amount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER deduction_amount');
    add_column_if_missing('rohlik_brno_adjustments', 'cash_amount', 'cash_amount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER card_amount');
    add_column_if_missing('rohlik_brno_adjustments', 'employer_health_amount', 'employer_health_amount DECIMAL(10,2) NULL DEFAULT NULL AFTER cash_amount');
    add_column_if_missing('rohlik_brno_adjustments', 'employer_health_paid', 'employer_health_paid TINYINT(1) NOT NULL DEFAULT 0 AFTER employer_health_amount');

    $pdo->exec("CREATE TABLE IF NOT EXISTS rohlik_month_archives (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      month TINYINT UNSIGNED NOT NULL,
      year SMALLINT UNSIGNED NOT NULL,
      payload_json LONGTEXT NOT NULL,
      source_hash CHAR(64) NOT NULL,
      rows_count INT UNSIGNED NOT NULL DEFAULT 0,
      people_count INT UNSIGNED NOT NULL DEFAULT 0,
      worked_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
      fixed_by INT UNSIGNED NULL,
      fixed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_rohlik_month_archive (year, month),
      KEY idx_rohlik_archive_fixed_by (fixed_by)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS rohlik_shifts (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      employee_id INT UNSIGNED NOT NULL,
      department VARCHAR(80) NOT NULL DEFAULT 'Kompletace',
      work_date DATE NOT NULL,
      shift_start TIME NULL,
      shift_end TIME NULL,
      shift_label VARCHAR(120) NOT NULL DEFAULT '',
      workplace VARCHAR(255) NULL,
      status ENUM('planned','cancelled') NOT NULL DEFAULT 'planned',
      note TEXT NULL,
      created_by INT UNSIGNED NULL,
      updated_by INT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_rohlik_shift_day (employee_id, work_date, shift_start),
      KEY idx_rohlik_shifts_date (work_date),
      KEY idx_rohlik_shifts_employee (employee_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    add_column_if_missing('rohlik_shifts', 'department', "department VARCHAR(80) NOT NULL DEFAULT 'Kompletace' AFTER employee_id");

    $pdo->exec("CREATE TABLE IF NOT EXISTS rohlik_shift_requests (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      employee_id INT UNSIGNED NOT NULL,
      request_type ENUM('day_off','vacation') NOT NULL DEFAULT 'day_off',
      date_from DATE NOT NULL,
      date_to DATE NOT NULL,
      note TEXT NULL,
      status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
      created_by INT UNSIGNED NULL,
      reviewed_by INT UNSIGNED NULL,
      reviewed_at DATETIME NULL,
      rejection_note TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_rohlik_shift_requests_period (date_from, date_to, status),
      KEY idx_rohlik_shift_requests_employee (employee_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS sync_runs (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      source_key VARCHAR(80) NOT NULL,
      status ENUM('ok','failed') NOT NULL DEFAULT 'ok',
      message TEXT NULL,
      rows_suma INT UNSIGNED NOT NULL DEFAULT 0,
      rows_daily INT UNSIGNED NOT NULL DEFAULT 0,
      started_at DATETIME NOT NULL,
      finished_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_sync_runs_source (source_key, started_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS permission_blocks (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT NULL,
      permissions LONGTEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS employee_chat_messages (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      employee_id INT UNSIGNED NOT NULL,
      channel_key VARCHAR(80) NULL,
      channel_label VARCHAR(120) NULL,
      sender_user_id INT UNSIGNED NULL,
      sender_employee_id INT UNSIGNED NULL,
      sender_role ENUM('worker','admin','coordinator') NOT NULL DEFAULT 'worker',
      message TEXT NOT NULL,
      attachment_path VARCHAR(255) NULL,
      attachment_name VARCHAR(255) NULL,
      attachment_mime VARCHAR(120) NULL,
      attachment_size INT UNSIGNED NULL,
      is_read_by_worker TINYINT(1) NOT NULL DEFAULT 0,
      is_read_by_admin TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_employee_chat_employee (employee_id, created_at),
      KEY idx_employee_chat_channel (channel_key, created_at),
      KEY idx_employee_chat_sender_user (sender_user_id),
      CONSTRAINT fk_employee_chat_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
      CONSTRAINT fk_employee_chat_user FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT fk_employee_chat_sender_employee FOREIGN KEY (sender_employee_id) REFERENCES employees(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    add_column_if_missing('employee_chat_messages', 'channel_key', 'channel_key VARCHAR(80) NULL AFTER employee_id');
    add_column_if_missing('employee_chat_messages', 'channel_label', 'channel_label VARCHAR(120) NULL AFTER channel_key');
    add_column_if_missing('employee_chat_messages', 'attachment_path', 'attachment_path VARCHAR(255) NULL AFTER message');
    add_column_if_missing('employee_chat_messages', 'attachment_name', 'attachment_name VARCHAR(255) NULL AFTER attachment_path');
    add_column_if_missing('employee_chat_messages', 'attachment_mime', 'attachment_mime VARCHAR(120) NULL AFTER attachment_name');
    add_column_if_missing('employee_chat_messages', 'attachment_size', 'attachment_size INT UNSIGNED NULL AFTER attachment_mime');
    add_column_if_missing('employee_chat_messages', 'deleted_by_worker_at', 'deleted_by_worker_at DATETIME NULL AFTER is_read_by_admin');
    add_column_if_missing('employee_chat_messages', 'deleted_by_admin_at', 'deleted_by_admin_at DATETIME NULL AFTER deleted_by_worker_at');
    if (!index_exists('employee_chat_messages', 'idx_employee_chat_channel')) {
        $pdo->exec('ALTER TABLE employee_chat_messages ADD INDEX idx_employee_chat_channel (channel_key, created_at)');
    }

    $stmt = $pdo->prepare('SELECT id FROM companies WHERE name = ? LIMIT 1');
    $stmt->execute(['ROSHPIT']);
    $companyId = (int)$stmt->fetchColumn();
    if (!$companyId) {
        $pdo->prepare('INSERT INTO companies (name, notes) VALUES (?, ?)')->execute(['ROSHPIT', 'Automaticky vytvoreno pro Rohlik Brno']);
        $companyId = (int)$pdo->lastInsertId();
    }
    $stmt = $pdo->prepare('SELECT id FROM objects WHERE name = ? LIMIT 1');
    $stmt->execute(['Rohlik Brno']);
    $objectId = (int)$stmt->fetchColumn();
    if ($objectId) {
        $pdo->prepare('UPDATE objects SET company_id = ?, status = "active" WHERE id = ?')->execute([$companyId, $objectId]);
    } else {
        $pdo->prepare('INSERT INTO objects (company_id, name, status, notes) VALUES (?, ?, "active", ?)')->execute([$companyId, 'Rohlik Brno', 'Automaticky vytvoreno pro firmu ROSHPIT']);
    }
}

function ensure_schema_loaded(): void
{
    if (!table_exists('users')) {
        throw new RuntimeException('Database schema is not installed.');
    }
    ensure_runtime_schema();
}
