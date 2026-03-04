const jwt = require('jsonwebtoken');
const { query } = require('../db');

async function getUserFromToken(token) {
  const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
  if (!decoded?.tenantId) return null;

  const users = await query(
    'SELECT id, fs_username AS fsUsername, display_name AS displayName FROM portal_users WHERE id = ? LIMIT 1',
    [decoded.userId]
  );
  const user = users[0];
  if (!user) return null;

  const memberships = await query(
    'SELECT role, status FROM user_tenants WHERE user_id = ? AND tenant_id = ? LIMIT 1',
    [decoded.userId, decoded.tenantId]
  );
  const membership = memberships[0];
  if (!membership || membership.status !== 'active') return null;

  const tenants = await query(
    'SELECT id, tenant_key AS tenantKey, name FROM tenants WHERE id = ? LIMIT 1',
    [decoded.tenantId]
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

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = user;
    req.userId = user.id;
    req.tenantId = user.tenantId;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid authentication token' });
  }
};

const adminAuth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const user = await getUserFromToken(token);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    if (user.role !== 'tenant_admin') {
      return res.status(403).json({ error: 'Tenant admin access required' });
    }

    req.user = user;
    req.userId = user.id;
    req.tenantId = user.tenantId;
    next();
  } catch (error) {
    res.status(403).json({ error: 'Access denied' });
  }
};

module.exports = { auth, adminAuth };
