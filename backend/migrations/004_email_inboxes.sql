-- Migration 004: Ensure email_inboxes table exists
-- (May already exist from migration 002 target schema)

CREATE TABLE IF NOT EXISTS email_inboxes (
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
