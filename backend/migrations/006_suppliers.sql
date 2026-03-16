-- Migration 006: Supplier Registry
-- Creates suppliers and supplier_aliases tables, adds supplier_id FK to invoices

CREATE TABLE IF NOT EXISTS suppliers (
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

CREATE TABLE IF NOT EXISTS supplier_aliases (
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

-- Add supplier_id FK to invoices
ALTER TABLE invoices ADD COLUMN supplier_id CHAR(36) NULL AFTER supplier_name;
ALTER TABLE invoices ADD KEY idx_invoices_supplier (supplier_id);
ALTER TABLE invoices ADD CONSTRAINT fk_invoices_supplier
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
