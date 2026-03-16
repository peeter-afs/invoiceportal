const crypto = require('crypto');
const { query } = require('../db');

async function findUserByFsUsername(fsUsername) {
  const users = await query(
    'SELECT id, fs_username AS fsUsername, display_name AS displayName FROM portal_users WHERE fs_username = ? LIMIT 1',
    [fsUsername]
  );
  return users[0] || null;
}

async function createUser(fsUsername, displayName) {
  const userId = crypto.randomUUID();
  await query(
    'INSERT INTO portal_users (id, fs_username, display_name) VALUES (?, ?, ?)',
    [userId, fsUsername, displayName || null]
  );
  return { id: userId, fsUsername, displayName };
}

async function upsertUser(fsUsername, displayName) {
  let user = await findUserByFsUsername(fsUsername);
  if (!user) {
    user = await createUser(fsUsername, displayName);
  }
  return user;
}

async function getActiveMembership(userId, tenantId) {
  const memberships = await query(
    'SELECT role, status FROM user_tenants WHERE user_id = ? AND tenant_id = ? LIMIT 1',
    [userId, tenantId]
  );
  const membership = memberships[0];
  if (!membership || membership.status !== 'active') return null;
  return membership;
}

async function assignTenantRole(userId, tenantId, role) {
  await query(
    `INSERT INTO user_tenants (user_id, tenant_id, role, status)
     VALUES (?, ?, ?, 'active')
     ON DUPLICATE KEY UPDATE role = VALUES(role), status = 'active'`,
    [userId, tenantId, role]
  );
}

async function hasTenantMembers(tenantId) {
  const rows = await query(
    "SELECT 1 FROM user_tenants WHERE tenant_id = ? AND status = 'active' LIMIT 1",
    [tenantId]
  );
  return rows.length > 0;
}

async function updateLastLogin(userId) {
  await query('UPDATE portal_users SET last_login_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [userId]);
}

async function getUserWithTenantInfo(userId, tenantId) {
  const users = await query(
    'SELECT id, fs_username AS fsUsername, display_name AS displayName FROM portal_users WHERE id = ? LIMIT 1',
    [userId]
  );
  const user = users[0];
  if (!user) return null;

  const memberships = await query(
    'SELECT role, status FROM user_tenants WHERE user_id = ? AND tenant_id = ? LIMIT 1',
    [userId, tenantId]
  );
  const membership = memberships[0];
  if (!membership || membership.status !== 'active') return null;

  const tenants = await query(
    'SELECT id, tenant_key AS tenantKey, name FROM tenants WHERE id = ? LIMIT 1',
    [tenantId]
  );
  const tenant = tenants[0];
  if (!tenant) return null;

  return {
    id: user.id,
    fsUsername: user.fsUsername,
    displayName: user.displayName,
    role: membership.role,
    tenantId: tenant.id,
    tenantKey: tenant.tenantKey,
  };
}

module.exports = {
  findUserByFsUsername,
  createUser,
  upsertUser,
  getActiveMembership,
  assignTenantRole,
  hasTenantMembers,
  updateLastLogin,
  getUserWithTenantInfo,
};
