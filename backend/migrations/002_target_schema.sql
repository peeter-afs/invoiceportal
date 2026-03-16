-- Migration: Transform schema to target workflow model
-- Adds Futursoft config to tenant_settings, new invoice model, and supporting tables.

-- 1. Add Futursoft config columns to tenant_settings
ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS futursoft_base_url VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS futursoft_subscription_key VARCHAR(255) NULL;

-- 2. Drop foreign keys from old tables before renaming.
--    InnoDB constraint names are global per database; if we just rename the table
--    the old FK names persist and the new CREATE TABLE will fail with errno 121.
ALTER TABLE invoice_items DROP FOREIGN KEY IF EXISTS fk_invoice_items_invoice;
ALTER TABLE invoices DROP FOREIGN KEY IF EXISTS fk_invoices_tenant;
ALTER TABLE invoices DROP FOREIGN KEY IF EXISTS fk_invoices_created_by;
ALTER TABLE invoices DROP FOREIGN KEY IF EXISTS fk_invoices_approved_by;
ALTER TABLE invoices DROP FOREIGN KEY IF EXISTS fk_invoices_rejected_by;
ALTER TABLE invoices DROP FOREIGN KEY IF EXISTS invoices_ibfk_1;
ALTER TABLE invoices DROP FOREIGN KEY IF EXISTS invoices_ibfk_2;
ALTER TABLE invoice_items DROP FOREIGN KEY IF EXISTS invoice_items_ibfk_1;

-- Rename old tables
RENAME TABLE invoices TO invoices_old;
RENAME TABLE invoice_items TO invoice_items_old;

CREATE TABLE invoices (
  id               CHAR(36) NOT NULL DEFAULT (UUID()),
  tenant_id        CHAR(36) NOT NULL,
  status           ENUM(
                     'queued','processing','needs_review','ready',
                     'pending_approval','approved','rejected',
                     'exporting','exported','failed'
                   ) NOT NULL DEFAULT 'queued',
  source_type      ENUM('upload','email') NOT NULL DEFAULT 'upload',
  source_ref       VARCHAR(512) NULL,
  source_meta      LONGTEXT NOT NULL DEFAULT ('{}'),
  CONSTRAINT chk_invoices_source_meta_json CHECK (JSON_VALID(source_meta)),
  file_hash        VARCHAR(128) NULL,
  original_filename VARCHAR(512) NULL,
  supplier_name    VARCHAR(255) NULL,
  invoice_number   VARCHAR(255) NULL,
  invoice_date     DATE NULL,
  due_date         DATE NULL,
  currency         VARCHAR(8) NULL,
  net_total        DECIMAL(14,2) NULL,
  vat_total        DECIMAL(14,2) NULL,
  gross_total      DECIMAL(14,2) NULL,
  purchase_order_nr VARCHAR(255) NULL,
  requires_approval TINYINT(1) NOT NULL DEFAULT 1,
  approval_status  ENUM('none','pending','approved','rejected') NOT NULL DEFAULT 'none',
  approved_by      CHAR(36) NULL,
  approved_at      DATETIME(3) NULL,
  rejected_by      CHAR(36) NULL,
  rejected_at      DATETIME(3) NULL,
  rejection_reason TEXT NULL,
  exported_at      DATETIME(3) NULL,
  export_ref       VARCHAR(255) NULL,
  error_message    TEXT NULL,
  created_by       CHAR(36) NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_invoices_tenant_status (tenant_id, status),
  KEY idx_invoices_tenant_created (tenant_id, created_at),
  KEY idx_invoices_tenant_approval (tenant_id, approval_status, created_at),
  UNIQUE KEY ux_invoices_tenant_filehash (tenant_id, file_hash),
  CONSTRAINT fk_invoices_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_invoices_approved_by
    FOREIGN KEY (approved_by) REFERENCES portal_users(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_invoices_rejected_by
    FOREIGN KEY (rejected_by) REFERENCES portal_users(id)
    ON DELETE SET NULL
) ENGINE=InnoDB;

-- 3. Migrate old invoice data into new table
INSERT INTO invoices (
  id, tenant_id, status, source_type, supplier_name, invoice_number,
  due_date, net_total, vat_total, gross_total, created_by, created_at, updated_at
)
SELECT
  id, tenant_id,
  CASE status
    WHEN 'draft' THEN 'needs_review'
    WHEN 'sent' THEN 'pending_approval'
    WHEN 'paid' THEN 'exported'
    WHEN 'overdue' THEN 'needs_review'
    WHEN 'cancelled' THEN 'rejected'
  END,
  'upload',
  client_name,
  invoice_number,
  due_date,
  subtotal,
  tax,
  total,
  created_by,
  created_at,
  updated_at
FROM invoices_old;

-- 4. Create invoice_lines table (replaces invoice_items)
CREATE TABLE invoice_lines (
  id           CHAR(36) NOT NULL DEFAULT (UUID()),
  invoice_id   CHAR(36) NOT NULL,
  row_no       INT NOT NULL,
  product_code VARCHAR(255) NULL,
  description  TEXT NULL,
  qty          DECIMAL(14,3) NULL,
  unit         VARCHAR(32) NULL,
  unit_price   DECIMAL(14,4) NULL,
  net          DECIMAL(14,2) NULL,
  vat_rate     DECIMAL(6,3) NULL,
  vat_amount   DECIMAL(14,2) NULL,
  gross        DECIMAL(14,2) NULL,
  match_data   LONGTEXT NULL,
  CONSTRAINT chk_invoice_lines_match_json CHECK (match_data IS NULL OR JSON_VALID(match_data)),
  raw          LONGTEXT NOT NULL DEFAULT ('{}'),
  CONSTRAINT chk_invoice_lines_raw_json CHECK (JSON_VALID(raw)),
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY ux_invoice_lines_row (invoice_id, row_no),
  KEY idx_invoice_lines_invoice (invoice_id),
  CONSTRAINT fk_invoice_lines_invoice
    FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

-- 5. Migrate old invoice_items into invoice_lines
INSERT INTO invoice_lines (id, invoice_id, row_no, description, qty, unit_price, net, created_at)
SELECT
  id,
  invoice_id,
  ROW_NUMBER() OVER (PARTITION BY invoice_id ORDER BY created_at),
  description,
  quantity,
  unit_price,
  amount,
  created_at
FROM invoice_items_old;

-- 6. Create invoice_files table
CREATE TABLE invoice_files (
  id          CHAR(36) NOT NULL DEFAULT (UUID()),
  invoice_id  CHAR(36) NOT NULL,
  storage_key VARCHAR(1024) NOT NULL,
  filename    VARCHAR(512) NOT NULL,
  mime        VARCHAR(128) NOT NULL DEFAULT 'application/pdf',
  size_bytes  BIGINT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_invoice_files_invoice (invoice_id),
  CONSTRAINT fk_invoice_files_invoice
    FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

-- 7. Create processing_logs table
CREATE TABLE processing_logs (
  id          CHAR(36) NOT NULL DEFAULT (UUID()),
  invoice_id  CHAR(36) NOT NULL,
  step        VARCHAR(64) NOT NULL,
  level       ENUM('info','warn','error') NOT NULL DEFAULT 'info',
  message     TEXT NOT NULL,
  payload     LONGTEXT NULL,
  CONSTRAINT chk_processing_logs_payload_json CHECK (payload IS NULL OR JSON_VALID(payload)),
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_processing_logs_invoice_created (invoice_id, created_at),
  CONSTRAINT fk_processing_logs_invoice
    FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

-- 8. Create invoice_approvals table
CREATE TABLE invoice_approvals (
  id            CHAR(36) NOT NULL DEFAULT (UUID()),
  invoice_id    CHAR(36) NOT NULL,
  action        ENUM('submit','approve','reject','revoke') NOT NULL,
  actor_user_id CHAR(36) NOT NULL,
  actor_role    ENUM('reviewer','approver','tenant_admin') NULL,
  comment       TEXT NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_invoice_approvals_invoice_created (invoice_id, created_at),
  CONSTRAINT fk_invoice_approvals_invoice
    FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_invoice_approvals_actor_user
    FOREIGN KEY (actor_user_id) REFERENCES portal_users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

-- 9. Create email_inboxes table
CREATE TABLE email_inboxes (
  id               CHAR(36) NOT NULL DEFAULT (UUID()),
  tenant_id        CHAR(36) NOT NULL,
  enabled          TINYINT(1) NOT NULL DEFAULT 0,
  folder           VARCHAR(255) NOT NULL DEFAULT 'INBOX',
  imap_host        VARCHAR(255) NOT NULL,
  imap_port        INT NOT NULL DEFAULT 993,
  imap_tls         TINYINT(1) NOT NULL DEFAULT 1,
  imap_user        VARCHAR(255) NOT NULL,
  imap_password_enc TEXT NOT NULL,
  last_uid         BIGINT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY ux_email_inboxes_tenant (tenant_id),
  CONSTRAINT fk_email_inboxes_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

-- 10. Create role_changes table
CREATE TABLE role_changes (
  id                 CHAR(36) NOT NULL DEFAULT (UUID()),
  tenant_id          CHAR(36) NOT NULL,
  target_user_id     CHAR(36) NOT NULL,
  changed_by_user_id CHAR(36) NOT NULL,
  old_role           ENUM('reviewer','approver','tenant_admin') NULL,
  new_role           ENUM('reviewer','approver','tenant_admin') NOT NULL,
  created_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
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

-- 11. Create sessions table for express-session
CREATE TABLE sessions (
  session_id VARCHAR(128) NOT NULL,
  expires    INT UNSIGNED NOT NULL,
  data       MEDIUMTEXT,
  PRIMARY KEY (session_id)
) ENGINE=InnoDB;

-- 12. Drop old tables (data has been migrated)
DROP TABLE IF EXISTS invoice_items_old;
DROP TABLE IF EXISTS invoices_old;
