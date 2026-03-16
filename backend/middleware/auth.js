const { getUserWithTenantInfo } = require('../services/userService');

const auth = async (req, res, next) => {
  try {
    if (!req.session?.userId || !req.session?.tenantId) {
      console.warn(`[auth] 401 on ${req.method} ${req.path} — session: userId=${req.session?.userId || 'none'}, tenantId=${req.session?.tenantId || 'none'}, cookie=${req.headers.cookie ? 'present' : 'MISSING'}`);
      return res.status(401).json({ error: 'Authentication required' });
    }

    const user = await getUserWithTenantInfo(req.session.userId, req.session.tenantId);
    if (!user) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    req.user = user;
    req.userId = user.id;
    req.tenantId = user.tenantId;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Authentication failed' });
  }
};

const adminAuth = async (req, res, next) => {
  try {
    if (!req.session?.userId || !req.session?.tenantId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const user = await getUserWithTenantInfo(req.session.userId, req.session.tenantId);
    if (!user) {
      return res.status(401).json({ error: 'User not found or inactive' });
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

const requireRole = (...roles) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};

module.exports = { auth, adminAuth, requireRole };
