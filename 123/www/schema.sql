SET NAMES utf8mb4;
SET time_zone = '+01:00';

CREATE TABLE IF NOT EXISTS companies (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS objects (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NULL,
  name VARCHAR(255) NOT NULL,
  address TEXT NULL,
  work_type VARCHAR(40) NOT NULL DEFAULT 'general',
  status ENUM('active','archived') NOT NULL DEFAULT 'active',
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_objects_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS employees (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  hourly_rate DECIMAL(10,2) NOT NULL DEFAULT 0,
  housing_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
  company_id INT UNSIGNED NULL,
  object_id INT UNSIGNED NULL,
  accommodation_id INT UNSIGNED NULL,
  status ENUM('active','archived') NOT NULL DEFAULT 'active',
  phone VARCHAR(80) NULL,
  email VARCHAR(255) NULL,
  warehouse_email VARCHAR(255) NULL,
  birth_date DATE NULL,
  address TEXT NULL,
  residence_address TEXT NULL,
  passport_number VARCHAR(120) NULL,
  passport_valid_until DATE NULL,
  personal_id_number VARCHAR(120) NULL,
  emergency_contact VARCHAR(255) NULL,
  bank_account VARCHAR(120) NULL,
  contract_type VARCHAR(120) NULL,
  contract_number VARCHAR(120) NULL,
  contract_start DATE NULL,
  contract_end DATE NULL,
  documents_note TEXT NULL,
  jmhz_questionnaire LONGTEXT NULL,
  avatar_path VARCHAR(255) NULL,
  notes TEXT NULL,
  archived_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_employees_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL,
  CONSTRAINT fk_employees_object FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','coordinator','accountant','user') NOT NULL DEFAULT 'user',
  employee_id INT UNSIGNED NULL,
  name VARCHAR(255) NOT NULL,
  last_login_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id INT UNSIGNED NOT NULL,
  permission_key VARCHAR(80) NOT NULL,
  allowed TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, permission_key),
  CONSTRAINT fk_user_permissions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS timesheets (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  work_date DATE NOT NULL,
  work_start_at DATETIME NULL,
  work_end_at DATETIME NULL,
  month TINYINT UNSIGNED NOT NULL,
  year SMALLINT UNSIGNED NOT NULL,
  hours DECIMAL(7,2) NOT NULL DEFAULT 0,
  note TEXT NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'approved',
  submitted_by INT UNSIGNED NULL,
  approved_by INT UNSIGNED NULL,
  approved_at DATETIME NULL,
  rejection_note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_timesheet_day (employee_id, work_date),
  KEY idx_timesheets_employee (employee_id),
  KEY idx_timesheets_period (year, month),
  CONSTRAINT fk_timesheets_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS advances (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  date DATE NOT NULL,
  month TINYINT UNSIGNED NOT NULL,
  year SMALLINT UNSIGNED NOT NULL,
  note TEXT NULL,
  created_by INT UNSIGNED NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'approved',
  approved_by INT UNSIGNED NULL,
  approved_at DATETIME NULL,
  paid_at DATE NULL,
  rejection_note TEXT NULL,
  deleted_at DATETIME NULL,
  deleted_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_advances_period (year, month),
  CONSTRAINT fk_advances_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  CONSTRAINT fk_advances_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS housing (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  month TINYINT UNSIGNED NOT NULL,
  year SMALLINT UNSIGNED NOT NULL,
  amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_housing_period (employee_id, month, year),
  KEY idx_housing_period (year, month),
  CONSTRAINT fk_housing_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS checkins (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  object_id INT UNSIGNED NULL,
  user_id INT UNSIGNED NULL,
  time_in DATETIME NOT NULL,
  time_out DATETIME NULL,
  lat DECIMAL(10,7) NULL,
  lng DECIMAL(10,7) NULL,
  location_accuracy DECIMAL(10,2) NULL,
  location_captured_at DATETIME NULL,
  location_source VARCHAR(40) NULL,
  location_locked TINYINT(1) NOT NULL DEFAULT 0,
  movement_points INT UNSIGNED NOT NULL DEFAULT 0,
  last_seen_at DATETIME NULL,
  duration_hours DECIMAL(7,2) NULL,
  break_minutes INT UNSIGNED NOT NULL DEFAULT 30,
  raw_duration_hours DECIMAL(7,2) NULL,
  location_name VARCHAR(255) NULL,
  note TEXT NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'approved',
  approved_by INT UNSIGNED NULL,
  approved_at DATETIME NULL,
  rejection_note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_checkins_time (time_in),
  CONSTRAINT fk_checkins_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  CONSTRAINT fk_checkins_object FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE SET NULL,
  CONSTRAINT fk_checkins_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS employee_documents (
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
  KEY idx_employee_documents_employee (employee_id),
  CONSTRAINT fk_employee_documents_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  CONSTRAINT fk_employee_documents_user FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS company_sim_cards (
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
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_sim_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL,
  CONSTRAINT fk_sim_employee FOREIGN KEY (assigned_employee_id) REFERENCES employees(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS company_vehicles (
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
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_vehicle_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL,
  CONSTRAINT fk_vehicle_employee FOREIGN KEY (assigned_employee_id) REFERENCES employees(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS company_tools (
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
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_tool_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL,
  CONSTRAINT fk_tool_employee FOREIGN KEY (assigned_employee_id) REFERENCES employees(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS accommodations (
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
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_accommodation_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coordinator_expenses (
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
  KEY idx_coordinator_expenses_period (expense_date, category),
  CONSTRAINT fk_coord_exp_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL,
  CONSTRAINT fk_coord_exp_user FOREIGN KEY (coordinator_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_coord_exp_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  CONSTRAINT fk_coord_exp_vehicle FOREIGN KEY (vehicle_id) REFERENCES company_vehicles(id) ON DELETE SET NULL,
  CONSTRAINT fk_coord_exp_created FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recruitment_candidates (
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
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_recruitment_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recruitment_comments (
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
  KEY idx_recruitment_comments_candidate (candidate_id, created_at),
  CONSTRAINT fk_recruitment_comments_candidate FOREIGN KEY (candidate_id) REFERENCES recruitment_candidates(id) ON DELETE CASCADE,
  CONSTRAINT fk_recruitment_comments_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payouts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  month TINYINT UNSIGNED NOT NULL,
  year SMALLINT UNSIGNED NOT NULL,
  card_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  cash_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  insurance_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  debt_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  debt_note TEXT NULL,
  debt_carried_over TINYINT(1) NOT NULL DEFAULT 0,
  social_paid TINYINT(1) NOT NULL DEFAULT 0,
  health_paid TINYINT(1) NOT NULL DEFAULT 0,
  paid_at DATE NULL,
  note TEXT NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  deleted_by INT UNSIGNED NULL,
  UNIQUE KEY uq_payout_period (employee_id, month, year),
  CONSTRAINT fk_payouts_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  CONSTRAINT fk_payouts_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS company_expenses (
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
  KEY idx_company_expenses_period (company_id, year, month),
  CONSTRAINT fk_company_expenses_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL,
  CONSTRAINT fk_company_expenses_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS company_revenues (
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
  KEY idx_company_revenues_period (company_id, year, month),
  CONSTRAINT fk_company_revenues_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL,
  CONSTRAINT fk_company_revenues_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stavba_manual_hours (
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
  KEY idx_stavba_manual_date (work_date),
  CONSTRAINT fk_stavba_manual_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  CONSTRAINT fk_stavba_manual_created FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_stavba_manual_updated FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS warehouse_suma (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS warehouse_daily (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rohlik_brno_adjustments (
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
  KEY idx_rohlik_employee (employee_id),
  CONSTRAINT fk_rohlik_adjustment_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  CONSTRAINT fk_rohlik_adjustment_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rohlik_month_archives (
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
  KEY idx_rohlik_archive_fixed_by (fixed_by),
  CONSTRAINT fk_rohlik_archive_user FOREIGN KEY (fixed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rohlik_shifts (
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
  KEY idx_rohlik_shifts_employee (employee_id),
  CONSTRAINT fk_rohlik_shift_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  CONSTRAINT fk_rohlik_shift_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_rohlik_shift_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rohlik_shift_requests (
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
  KEY idx_rohlik_shift_requests_employee (employee_id),
  CONSTRAINT fk_rohlik_shift_request_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  CONSTRAINT fk_rohlik_shift_request_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_rohlik_shift_request_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sync_runs (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS permission_blocks (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  permissions LONGTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cash_register (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  type ENUM('income','expense') NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  description TEXT NOT NULL,
  date DATE NOT NULL,
  object_id INT UNSIGNED NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  deleted_by INT UNSIGNED NULL,
  KEY idx_cash_date (date),
  CONSTRAINT fk_cash_object FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE SET NULL,
  CONSTRAINT fk_cash_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS month_closings (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  month TINYINT UNSIGNED NOT NULL,
  year SMALLINT UNSIGNED NOT NULL,
  closed_by INT UNSIGNED NULL,
  snapshot LONGTEXT NULL,
  notes TEXT NULL,
  closed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_month_closings_period (month, year),
  CONSTRAINT fk_month_closings_user FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS employee_chat_messages (
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
  deleted_by_worker_at DATETIME NULL,
  deleted_by_admin_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_employee_chat_employee (employee_id, created_at),
  KEY idx_employee_chat_channel (channel_key, created_at),
  KEY idx_employee_chat_sender_user (sender_user_id),
  CONSTRAINT fk_employee_chat_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  CONSTRAINT fk_employee_chat_user FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_employee_chat_sender_employee FOREIGN KEY (sender_employee_id) REFERENCES employees(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS push_subscriptions (
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
  KEY idx_push_employee (employee_id),
  CONSTRAINT fk_push_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_push_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
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
  KEY idx_audit_logs_created (created_at),
  CONSTRAINT fk_audit_logs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO objects (name, address)
SELECT 'Stavba Praha', 'Wenceslas Square 1, Praha 1'
WHERE NOT EXISTS (SELECT 1 FROM objects WHERE name = 'Stavba Praha');

INSERT INTO objects (name, address)
SELECT 'Stavba Brno', 'Namesti Svobody 8, Brno'
WHERE NOT EXISTS (SELECT 1 FROM objects WHERE name = 'Stavba Brno');
