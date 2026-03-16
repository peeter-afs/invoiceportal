const crypto = require('crypto');
const { query } = require('../db');

async function ensureTenant(tenantKey, name) {
  const tenants = await query(
    'SELECT id, tenant_key, name FROM tenants WHERE tenant_key = ? LIMIT 1',
    [tenantKey]
  );
  if (tenants[0]) {
    await query('INSERT IGNORE INTO tenant_settings (tenant_id) VALUES (?)', [tenants[0].id]);
    return tenants[0];
  }

  const displayName = name || tenantKey;
  const tenantId = crypto.randomUUID();
  await query('INSERT INTO tenants (id, tenant_key, name) VALUES (?, ?, ?)', [tenantId, tenantKey, displayName]);
  await query('INSERT INTO tenant_settings (tenant_id) VALUES (?)', [tenantId]);
  return { id: tenantId, tenant_key: tenantKey, name: displayName };
}

/**
 * Resolve tenant by Futursoft company name ("yrityksen nimi").
 * Looks up by name first; if not found, creates with a slugified tenant_key.
 */
async function ensureTenantByCompanyName(companyName) {
  const byName = await query(
    'SELECT id, tenant_key, name FROM tenants WHERE name = ? LIMIT 1',
    [companyName]
  );
  if (byName[0]) {
    await query('INSERT IGNORE INTO tenant_settings (tenant_id) VALUES (?)', [byName[0].id]);
    return byName[0];
  }

  const tenantKey = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return ensureTenant(tenantKey, companyName);
}

async function getTenantByKey(tenantKey) {
  const tenants = await query(
    'SELECT id, tenant_key, name FROM tenants WHERE tenant_key = ? LIMIT 1',
    [tenantKey]
  );
  return tenants[0] || null;
}

async function getTenantSettings(tenantId) {
  const rows = await query(
    'SELECT * FROM tenant_settings WHERE tenant_id = ? LIMIT 1',
    [tenantId]
  );
  return rows[0] || null;
}

module.exports = { ensureTenant, ensureTenantByCompanyName, getTenantByKey, getTenantSettings };
