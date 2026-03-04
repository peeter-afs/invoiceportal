const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { query } = require('../db');
const { auth } = require('../middleware/auth');

function getTenantKeyFromReq(req) {
  return (
    req.body?.tenantKey ||
    req.header('X-Tenant-Key') ||
    process.env.DEFAULT_TENANT_KEY ||
    'default'
  );
}

async function ensureTenant(tenantKey) {
  const tenants = await query('SELECT id, tenant_key, name FROM tenants WHERE tenant_key = ? LIMIT 1', [tenantKey]);
  if (tenants[0]) {
    await query('INSERT IGNORE INTO tenant_settings (tenant_id) VALUES (?)', [tenants[0].id]);
    return tenants[0];
  }

  const tenantId = crypto.randomUUID();
  await query('INSERT INTO tenants (id, tenant_key, name) VALUES (?, ?, ?)', [tenantId, tenantKey, tenantKey]);
  await query('INSERT INTO tenant_settings (tenant_id) VALUES (?)', [tenantId]);
  return { id: tenantId, tenant_key: tenantKey, name: tenantKey };
}

async function getTenantByKey(tenantKey) {
  const tenants = await query('SELECT id, tenant_key, name FROM tenants WHERE tenant_key = ? LIMIT 1', [tenantKey]);
  return tenants[0] || null;
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

// Register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    const tenantKey = getTenantKeyFromReq(req);
    const tenant = await ensureTenant(tenantKey);

    // Map existing frontend fields to portal schema:
    // - email -> fs_username (login identifier)
    // - username -> display_name (optional)
    const fsUsername = email;
    const displayName = username || null;

    const existingUser = await query(
      'SELECT id FROM portal_users WHERE fs_username = ? LIMIT 1',
      [fsUsername]
    );
    if (existingUser.length > 0) return res.status(400).json({ error: 'User already exists' });

    const userId = crypto.randomUUID();
    await query(
      'INSERT INTO portal_users (id, fs_username, display_name) VALUES (?, ?, ?)',
      [userId, fsUsername, displayName]
    );

    const passwordHash = await bcrypt.hash(password, 10);
    await query(
      'INSERT INTO portal_user_credentials (user_id, password_hash) VALUES (?, ?)',
      [userId, passwordHash]
    );

    await query(
      "INSERT INTO user_tenants (user_id, tenant_id, role, status) VALUES (?, ?, 'tenant_admin', 'active')",
      [userId, tenant.id]
    );

    // Generate token
    const membership = await getActiveMembership(userId, tenant.id);
    const token = jwt.sign(
      { userId, tenantId: tenant.id, role: membership?.role || 'reviewer' },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: userId,
        username: fsUsername,
        email: fsUsername,
        role: membership?.role || 'reviewer',
        tenantId: tenant.id,
        tenantKey: tenant.tenant_key,
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const tenantKey = getTenantKeyFromReq(req);
    const tenant = await getTenantByKey(tenantKey);
    if (!tenant) return res.status(403).json({ error: 'Unknown tenant' });

    // Find user
    const portalUsers = await query(
      'SELECT id, fs_username AS fsUsername, display_name AS displayName FROM portal_users WHERE fs_username = ? LIMIT 1',
      [email]
    );
    const user = portalUsers[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const creds = await query(
      'SELECT password_hash AS passwordHash FROM portal_user_credentials WHERE user_id = ? LIMIT 1',
      [user.id]
    );
    const passwordHash = creds[0]?.passwordHash;
    if (!passwordHash) return res.status(401).json({ error: 'Invalid credentials' });

    // Check password
    const isPasswordValid = await bcrypt.compare(password, passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const membership = await getActiveMembership(user.id, tenant.id);
    if (!membership) return res.status(403).json({ error: 'No active access for tenant' });

    await query('UPDATE portal_users SET last_login_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [user.id]);

    // Generate token
    const token = jwt.sign(
      { userId: user.id, tenantId: tenant.id, role: membership.role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.fsUsername,
        email: user.fsUsername,
        role: membership.role,
        tenantId: tenant.id,
        tenantKey: tenant.tenant_key,
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get current user
router.get('/me', auth, async (req, res) => {
  try {
    res.json({
      user: {
        id: req.user.id,
        username: req.user.fsUsername,
        email: req.user.fsUsername,
        role: req.user.role,
        tenantId: req.user.tenantId,
        tenantKey: req.user.tenantKey,
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
