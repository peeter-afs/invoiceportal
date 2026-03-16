const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { ensureTenant, ensureTenantByCompanyName } = require('../services/tenantService');
const {
  upsertUser,
  getActiveMembership,
  assignTenantRole,
  hasTenantMembers,
  updateLastLogin,
} = require('../services/userService');
const { authenticate } = require('../services/futursoftAuthService');
const { createWithToken } = require('../services/futursoftApiClient');

/**
 * Resolve tenant key from request: body → header → URL path → env → null.
 * Returns null if none provided (will auto-resolve from Futursoft).
 */
function getTenantKeyFromReq(req) {
  const key = req.body?.tenantKey || req.header('X-Tenant-Key') || null;
  // Ignore "default" — forces auto-resolution from Futursoft
  if (!key || key === 'default') return null;
  return key;
}

// Login via Futursoft B2C ROPC
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Step 1: Authenticate against Futursoft B2C
    console.log(`[auth] Login attempt for user: ${username}`);
    let tokenData;
    try {
      tokenData = await authenticate(username, password);
      console.log(`[auth] B2C auth successful for ${username}`);
    } catch (authError) {
      console.error(`[auth] B2C auth failed for ${username}:`, authError.message);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Step 2: Resolve tenant
    let tenant;
    const tenantKey = getTenantKeyFromReq(req);
    console.log(`[auth] Tenant key from request: ${tenantKey || '(none, will auto-resolve)'}`);

    if (tenantKey) {
      // Tenant key provided (from URL or header) — use it directly
      tenant = await ensureTenant(tenantKey);
      console.log(`[auth] Using provided tenant key: ${tenantKey} → tenant "${tenant.name}" (${tenant.id})`);
    } else {
      // No tenant key — query Futursoft for company name to resolve tenant
      try {
        const fsClient = createWithToken(tokenData.access_token);
        console.log(`[auth] Querying Futursoft Workshop API for company name ("yrityksen nimi")...`);
        console.log(`[auth] Workshop API base URL: ${process.env.FS_WS_API_BASE_URL || '(NOT SET)'}`);
        const companyName = await fsClient.getSetting('yrityksen nimi');
        console.log(`[auth] Futursoft returned company name: "${companyName || '(empty)'}"`);
        if (companyName) {
          tenant = await ensureTenantByCompanyName(companyName);
          console.log(`[auth] Resolved tenant: "${tenant.name}" (key: ${tenant.tenant_key}, id: ${tenant.id})`);
        } else {
          // Fallback to default tenant if company name not available
          console.warn(`[auth] Company name empty, falling back to default tenant`);
          const fallbackKey = process.env.DEFAULT_TENANT_KEY || 'default';
          tenant = await ensureTenant(fallbackKey);
        }
      } catch (fsErr) {
        // If Futursoft settings query fails, fall back to default tenant
        console.error(`[auth] Failed to fetch company name from Futursoft:`, fsErr.message);
        if (fsErr.response) {
          console.error(`[auth] Futursoft API response: ${fsErr.response.status} ${JSON.stringify(fsErr.response.data).slice(0, 500)}`);
        }
        const fallbackKey = process.env.DEFAULT_TENANT_KEY || 'default';
        tenant = await ensureTenant(fallbackKey);
        console.warn(`[auth] Using fallback tenant: "${tenant.name}" (key: ${fallbackKey})`);
      }
    }

    // Step 3: Upsert portal user by fs_username
    const user = await upsertUser(username, null);

    // Step 4: Determine role — first user for tenant becomes tenant_admin
    let membership = await getActiveMembership(user.id, tenant.id);
    if (!membership) {
      const hasMembers = await hasTenantMembers(tenant.id);
      const role = hasMembers ? 'reviewer' : 'tenant_admin';
      await assignTenantRole(user.id, tenant.id, role);
      membership = { role };
    }

    await updateLastLogin(user.id);

    // Step 5: Create server-side session
    const expiresIn = tokenData.expires_in || 3600;
    const fsTokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    req.session.userId = user.id;
    req.session.tenantId = tenant.id;
    req.session.role = membership.role;
    req.session.fsUsername = username;
    req.session.fsAccessToken = tokenData.access_token;
    req.session.fsRefreshToken = tokenData.refresh_token;
    req.session.fsTokenExpiresAt = fsTokenExpiresAt;

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        username,
        role: membership.role,
        tenantId: tenant.id,
        tenantKey: tenant.tenant_key,
        tenantName: tenant.name,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out' });
  });
});

// Get current user from session
router.get('/me', auth, async (req, res) => {
  try {
    res.json({
      user: {
        id: req.user.id,
        username: req.user.fsUsername,
        displayName: req.user.displayName,
        role: req.user.role,
        tenantId: req.user.tenantId,
        tenantKey: req.user.tenantKey,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
