-- Invoice Portal — Fresh Database Install
-- Drop ALL tables and recreate from scratch. Run this on an empty database
-- or when you want to wipe everything and start fresh.
--
-- Usage: mysql -u user -p database < fresh_install.sql

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS invoice_approvals;
DROP TABLE IF EXISTS processing_logs;
DROP TABLE IF EXISTS invoice_lines;
DROP TABLE IF EXISTS invoice_files;
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS supplier_aliases;
DROP TABLE IF EXISTS suppliers;
DROP TABLE IF EXISTS role_changes;
DROP TABLE IF EXISTS user_tenants;
DROP TABLE IF EXISTS portal_users;
DROP TABLE IF EXISTS email_inboxes;
DROP TABLE IF EXISTS tenant_settings;
DROP TABLE IF EXISTS tenants;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS schema_migrations;
-- Legacy tables from old schema
DROP TABLE IF EXISTS invoice_items_old;
DROP TABLE IF EXISTS invoices_old;
DROP TABLE IF EXISTS invoice_items;
DROP TABLE IF EXISTS portal_user_credentials;

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- 1. Tenants
-- ============================================================
CREATE TABLE tenants (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  tenant_key VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY ux_tenants_tenant_key (tenant_key)
) ENGINE=InnoDB;

-- ============================================================
-- 2. Tenant Settings
-- ============================================================
CREATE TABLE tenant_settings (
  tenant_id CHAR(36) NOT NULL,
  approval_enabled TINYINT(1) NOT NULL DEFAULT 1,
  auto_submit_for_approval TINYINT(1) NOT NULL DEFAULT 1,
  auto_export_on_approval TINYINT(1) NOT NULL DEFAULT 0,
  futursoft_base_url VARCHAR(255) NULL,
  futursoft_subscription_key VARCHAR(255) NULL,
  futursoft_ws_base_url VARCHAR(255) NULL,
  wf_order_proposal_enabled TINYINT(1) NOT NULL DEFAULT 0,
  wf_order_confirmation_enabled TINYINT(1) NOT NULL DEFAULT 0,
  wf_order_enabled TINYINT(1) NOT NULL DEFAULT 0,
  wf_receiving_enabled TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id),
  CONSTRAINT fk_tenant_settings_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- 3. Email Inboxes (IMAP polling per tenant)
-- ============================================================
CREATE TABLE email_inboxes (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  tenant_id CHAR(36) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  folder VARCHAR(255) NOT NULL DEFAULT 'INBOX',
  imap_host VARCHAR(255) NOT NULL,
  imap_port INT NOT NULL DEFAULT 993,
  imap_tls TINYINT(1) NOT NULL DEFAULT 1,
  imap_user VARCHAR(255) NOT NULL,
  imap_password_enc TEXT NOT NULL,
  last_uid BIGINT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY ux_email_inboxes_tenant (tenant_id),
  CONSTRAINT fk_email_inboxes_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- 4. Portal Users (auto-created on Futursoft login)
-- ============================================================
CREATE TABLE portal_users (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  fs_username VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NULL,
  last_login_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY ux_portal_users_fs_username (fs_username)
) ENGINE=InnoDB;

-- ============================================================
-- 5. User ↔ Tenant membership + role
-- ============================================================
CREATE TABLE user_tenants (
  user_id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  role ENUM('reviewer','approver','tenant_admin') NOT NULL,
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, tenant_id),
  KEY idx_user_tenants_tenant (tenant_id),
  KEY idx_user_tenants_tenant_role (tenant_id, role),
  CONSTRAINT fk_user_tenants_user
    FOREIGN KEY (user_id) REFERENCES portal_users(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_user_tenants_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- 6. Role change audit log
-- ============================================================
CREATE TABLE role_changes (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  tenant_id CHAR(36) NOT NULL,
  target_user_id CHAR(36) NOT NULL,
  changed_by_user_id CHAR(36) NOT NULL,
  old_role ENUM('reviewer','approver','tenant_admin') NULL,
  new_role ENUM('reviewer','approver','tenant_admin') NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_role_changes_tenant_created (tenant_id, created_at),
  CONSTRAINT fk_role_changes_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_role_changes_target_user
    FOREIGN KEY (target_user_id) REFERENCES portal_users(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_role_changes_changed_by_user
    FOREIGN KEY (changed_by_user_id) REFERENCES portal_users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- 7. Suppliers
-- ============================================================
CREATE TABLE suppliers (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  tenant_id CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  vat_number VARCHAR(64) NULL,
  reg_number VARCHAR(64) NULL,
  address TEXT NULL,
  bank_account VARCHAR(64) NULL,
  futursoft_supplier_nr VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_suppliers_tenant (tenant_id),
  UNIQUE KEY ux_suppliers_tenant_name (tenant_id, name),
  KEY idx_suppliers_tenant_fs_nr (tenant_id, futursoft_supplier_nr),
  CONSTRAINT fk_suppliers_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- 7b. Supplier Aliases
-- ============================================================
CREATE TABLE supplier_aliases (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  supplier_id CHAR(36) NOT NULL,
  alias VARCHAR(255) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY ux_supplier_aliases_alias (supplier_id, alias),
  KEY idx_supplier_aliases_supplier (supplier_id),
  CONSTRAINT fk_supplier_aliases_supplier
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- 8. Invoices
-- ============================================================
CREATE TABLE invoices (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  tenant_id CHAR(36) NOT NULL,
  status ENUM(
    'queued','processing','needs_review','ready',
    'pending_approval','approved','rejected',
    'exporting','exported','failed'
  ) NOT NULL DEFAULT 'queued',
  source_type ENUM('upload','email') NOT NULL DEFAULT 'upload',
  source_ref VARCHAR(512) NULL,
  source_meta LONGTEXT NOT NULL DEFAULT ('{}'),
  CONSTRAINT chk_invoices_source_meta_json CHECK (JSON_VALID(source_meta)),
  file_hash VARCHAR(128) NULL,
  original_filename VARCHAR(512) NULL,
  supplier_name VARCHAR(255) NULL,
  supplier_id CHAR(36) NULL,
  invoice_number VARCHAR(255) NULL,
  invoice_date DATE NULL,
  due_date DATE NULL,
  currency VARCHAR(8) NULL,
  net_total DECIMAL(14,2) NULL,
  vat_total DECIMAL(14,2) NULL,
  gross_total DECIMAL(14,2) NULL,
  purchase_order_nr VARCHAR(255) NULL,
  reference_number VARCHAR(255) NULL,
  supplier_vat_number VARCHAR(64) NULL,
  supplier_reg_number VARCHAR(64) NULL,
  supplier_address TEXT NULL,
  supplier_bank_account VARCHAR(64) NULL,
  penalty_rate VARCHAR(32) NULL,
  payment_terms VARCHAR(255) NULL,
  delivery_date DATE NULL,
  delivery_method VARCHAR(255) NULL,
  delivery_note_nr VARCHAR(255) NULL,
  buyer_reference VARCHAR(255) NULL,
  seller_reference VARCHAR(255) NULL,
  requires_approval TINYINT(1) NOT NULL DEFAULT 1,
  approval_status ENUM('none','pending','approved','rejected') NOT NULL DEFAULT 'none',
  approved_by CHAR(36) NULL,
  approved_at DATETIME(3) NULL,
  rejected_by CHAR(36) NULL,
  rejected_at DATETIME(3) NULL,
  rejection_reason TEXT NULL,
  exported_at DATETIME(3) NULL,
  export_ref VARCHAR(255) NULL,
  error_message TEXT NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_invoices_tenant_status (tenant_id, status),
  KEY idx_invoices_tenant_created (tenant_id, created_at),
  KEY idx_invoices_tenant_approval (tenant_id, approval_status, created_at),
  UNIQUE KEY ux_invoices_tenant_filehash (tenant_id, file_hash),
  CONSTRAINT fk_invoices_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE,
  KEY idx_invoices_supplier (supplier_id),
  CONSTRAINT fk_invoices_supplier
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
  CONSTRAINT fk_invoices_approved_by
    FOREIGN KEY (approved_by) REFERENCES portal_users(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_invoices_rejected_by
    FOREIGN KEY (rejected_by) REFERENCES portal_users(id)
    ON DELETE SET NULL
) ENGINE=InnoDB;

-- ============================================================
-- 8. Invoice Files (PDF storage references)
-- ============================================================
CREATE TABLE invoice_files (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  invoice_id CHAR(36) NOT NULL,
  storage_key VARCHAR(1024) NOT NULL,
  filename VARCHAR(512) NOT NULL,
  mime VARCHAR(128) NOT NULL DEFAULT 'application/pdf',
  size_bytes BIGINT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_invoice_files_invoice (invoice_id),
  CONSTRAINT fk_invoice_files_invoice
    FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- 9. Invoice Lines (extracted rows from PDF)
-- ============================================================
CREATE TABLE invoice_lines (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  invoice_id CHAR(36) NOT NULL,
  row_no INT NOT NULL,
  product_code VARCHAR(255) NULL,
  description TEXT NULL,
  qty DECIMAL(14,3) NULL,
  unit VARCHAR(32) NULL,
  unit_price DECIMAL(14,4) NULL,
  net DECIMAL(14,2) NULL,
  vat_rate DECIMAL(6,3) NULL,
  vat_amount DECIMAL(14,2) NULL,
  gross DECIMAL(14,2) NULL,
  match_data LONGTEXT NULL,
  CONSTRAINT chk_invoice_lines_match_json CHECK (match_data IS NULL OR JSON_VALID(match_data)),
  raw LONGTEXT NOT NULL DEFAULT ('{}'),
  CONSTRAINT chk_invoice_lines_raw_json CHECK (JSON_VALID(raw)),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY ux_invoice_lines_row (invoice_id, row_no),
  KEY idx_invoice_lines_invoice (invoice_id),
  CONSTRAINT fk_invoice_lines_invoice
    FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- 10. Processing Logs (extraction/validation audit trail)
-- ============================================================
CREATE TABLE processing_logs (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  invoice_id CHAR(36) NOT NULL,
  step VARCHAR(64) NOT NULL,
  level ENUM('info','warn','error') NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  payload LONGTEXT NULL,
  CONSTRAINT chk_processing_logs_payload_json CHECK (payload IS NULL OR JSON_VALID(payload)),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_processing_logs_invoice_created (invoice_id, created_at),
  CONSTRAINT fk_processing_logs_invoice
    FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- 11. Invoice Approvals (approval workflow history)
-- ============================================================
CREATE TABLE invoice_approvals (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  invoice_id CHAR(36) NOT NULL,
  action ENUM('submit','approve','reject','revoke') NOT NULL,
  actor_user_id CHAR(36) NOT NULL,
  actor_role ENUM('reviewer','approver','tenant_admin') NULL,
  comment TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_invoice_approvals_invoice_created (invoice_id, created_at),
  CONSTRAINT fk_invoice_approvals_invoice
    FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_invoice_approvals_actor_user
    FOREIGN KEY (actor_user_id) REFERENCES portal_users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- 12. Sessions (express-session store)
-- ============================================================
CREATE TABLE sessions (
  session_id VARCHAR(128) NOT NULL,
  expires INT UNSIGNED NOT NULL,
  data MEDIUMTEXT,
  PRIMARY KEY (session_id)
) ENGINE=InnoDB;

-- ============================================================
-- 13. Schema Migrations (migration runner tracking)
-- ============================================================
CREATE TABLE schema_migrations (
  name VARCHAR(255) NOT NULL,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (name)
) ENGINE=InnoDB;

-- Mark all migrations as applied (fresh install = fully up to date)
INSERT INTO schema_migrations (name) VALUES
  ('001_baseline.sql'),
  ('002_target_schema.sql'),
  ('003_drop_credentials.sql'),
  ('004_email_inboxes.sql'),
  ('005_workflow_steps.sql'),
  ('006_suppliers.sql');
