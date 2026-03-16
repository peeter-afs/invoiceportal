-- Baseline migration: marks the existing schema as applied.
-- The actual tables (tenants, tenant_settings, portal_users, user_tenants,
-- portal_user_credentials, invoices, invoice_items) are assumed to already exist.
-- This file exists solely so the migration runner has a baseline version.
SELECT 1;
