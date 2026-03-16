const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { query } = require('../db');
const { auth, adminAuth } = require('../middleware/auth');

// Get all users for tenant (admin only)
router.get('/', adminAuth, async (req, res) => {
  try {
    const users = await query(
      `SELECT pu.id AS _id,
              pu.fs_username AS username,
              pu.display_name AS displayName,
              ut.role AS role,
              ut.status AS status,
              pu.last_login_at AS lastLoginAt,
              pu.created_at AS createdAt
       FROM user_tenants ut
       JOIN portal_users pu ON pu.id = ut.user_id
       WHERE ut.tenant_id = ?
       ORDER BY pu.created_at DESC`,
      [req.tenantId]
    );
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Change a user's role (admin only)
router.put('/:userId/role', adminAuth, async (req, res) => {
  try {
    const { role } = req.body;
    const targetUserId = req.params.userId;
    const validRoles = ['reviewer', 'approver', 'tenant_admin'];

    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
    }

    // Check the target user is a member of this tenant
    const membership = await query(
      'SELECT role FROM user_tenants WHERE user_id = ? AND tenant_id = ? LIMIT 1',
      [targetUserId, req.tenantId]
    );
    if (membership.length === 0) {
      return res.status(404).json({ error: 'User not found in this tenant' });
    }

    const oldRole = membership[0].role;

    await query(
      'UPDATE user_tenants SET role = ? WHERE user_id = ? AND tenant_id = ?',
      [role, targetUserId, req.tenantId]
    );

    // Record role change in audit log
    await query(
      `INSERT INTO role_changes (id, tenant_id, target_user_id, changed_by_user_id, old_role, new_role)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), req.tenantId, targetUserId, req.userId, oldRole, role]
    );

    res.json({ message: 'Role updated successfully', oldRole, newRole: role });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Enable or disable a user (admin only)
router.put('/:userId/status', adminAuth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'disabled'].includes(status)) {
      return res.status(400).json({ error: "Status must be 'active' or 'disabled'" });
    }
    // Prevent admin from disabling themselves
    if (req.params.userId === req.userId) {
      return res.status(400).json({ error: 'Cannot change your own status' });
    }
    await query(
      'UPDATE user_tenants SET status = ? WHERE user_id = ? AND tenant_id = ?',
      [status, req.params.userId, req.tenantId]
    );
    res.json({ message: `User ${status}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update own profile
router.put('/profile', auth, async (req, res) => {
  try {
    const { displayName } = req.body;
    if (!displayName) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    await query('UPDATE portal_users SET display_name = ? WHERE id = ?', [displayName, req.userId]);

    const updated = await query(
      `SELECT pu.id AS _id,
              pu.fs_username AS username,
              pu.display_name AS displayName,
              ut.role AS role,
              pu.created_at AS createdAt
       FROM portal_users pu
       JOIN user_tenants ut ON ut.user_id = pu.id AND ut.tenant_id = ?
       WHERE pu.id = ?
       LIMIT 1`,
      [req.tenantId, req.userId]
    );

    res.json(updated[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
