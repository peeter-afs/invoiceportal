-- Migration 009: Approver selection and workflow flags
-- Adds wf_auto_approve_on_order, wf_require_approval_before_order,
-- default_approver_id per tenant and per supplier, and assigned_approver_id per invoice.

ALTER TABLE tenant_settings
  ADD COLUMN wf_auto_approve_on_order TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN wf_require_approval_before_order TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN default_approver_id CHAR(36) NULL,
  ADD CONSTRAINT fk_tenant_settings_default_approver
    FOREIGN KEY (default_approver_id) REFERENCES portal_users(id) ON DELETE SET NULL;

ALTER TABLE suppliers
  ADD COLUMN default_approver_id CHAR(36) NULL,
  ADD CONSTRAINT fk_suppliers_default_approver
    FOREIGN KEY (default_approver_id) REFERENCES portal_users(id) ON DELETE SET NULL;

ALTER TABLE invoices
  ADD COLUMN assigned_approver_id CHAR(36) NULL,
  ADD CONSTRAINT fk_invoices_assigned_approver
    FOREIGN KEY (assigned_approver_id) REFERENCES portal_users(id) ON DELETE SET NULL;
