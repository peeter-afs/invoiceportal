-- Add configurable workflow step flags to tenant_settings
ALTER TABLE tenant_settings
  ADD COLUMN wf_order_proposal_enabled TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN wf_order_confirmation_enabled TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN wf_order_enabled TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN wf_receiving_enabled TINYINT(1) NOT NULL DEFAULT 0;
