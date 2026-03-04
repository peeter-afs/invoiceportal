-- Invoice Portal Schema (MariaDB)

-- Core tenant tables (provided)
CREATE TABLE IF NOT EXISTS tenants (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  tenant_key VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY ux_tenants_tenant_key (tenant_key)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id CHAR(36) NOT NULL,
  approval_enabled TINYINT(1) NOT NULL DEFAULT 1,
  auto_submit_for_approval TINYINT(1) NOT NULL DEFAULT 1,
  auto_export_on_approval TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS portal_users (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  fs_username VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NULL,
  last_login_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY ux_portal_users_fs_username (fs_username)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_tenants (
  user_id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  role ENUM('reviewer','approver','tenant_admin') NOT NULL,
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, tenant_id),
  FOREIGN KEY (user_id) REFERENCES portal_users(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Tables used by the current backend API (email/password auth + invoices)
-- The app maps `email` (frontend) -> `portal_users.fs_username` (database).
CREATE TABLE IF NOT EXISTS portal_user_credentials (
  user_id CHAR(36) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  FOREIGN KEY (user_id) REFERENCES portal_users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS invoices (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  tenant_id CHAR(36) NOT NULL,
  invoice_number VARCHAR(64) NOT NULL,
  client_name VARCHAR(255) NOT NULL,
  client_email VARCHAR(255) NOT NULL,
  client_address TEXT NULL,
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax DECIMAL(12,2) NOT NULL DEFAULT 0,
  total DECIMAL(12,2) NOT NULL DEFAULT 0,
  status ENUM('draft','sent','paid','overdue','cancelled') NOT NULL DEFAULT 'draft',
  due_date DATE NOT NULL,
  issue_date DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  notes TEXT NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY ux_invoices_invoice_number (invoice_number),
  KEY ix_invoices_tenant_id (tenant_id),
  KEY ix_invoices_created_by (created_by),
  KEY ix_invoices_status (status),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES portal_users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS invoice_items (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  invoice_id CHAR(36) NOT NULL,
  description VARCHAR(1000) NOT NULL,
  quantity DECIMAL(12,2) NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_invoice_items_invoice_id (invoice_id),
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
) ENGINE=InnoDB;
