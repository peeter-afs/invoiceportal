const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { auth, adminAuth } = require('../middleware/auth');

// Get all users (admin only)
router.get('/', adminAuth, async (req, res) => {
  try {
    const users = await query(
      `SELECT pu.id AS _id,
              pu.fs_username AS username,
              pu.fs_username AS email,
              ut.role AS role,
              ut.status AS status,
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

// Update user profile
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
              pu.fs_username AS email,
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
