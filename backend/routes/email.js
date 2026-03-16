const express = require('express');
const router = express.Router();
const { adminAuth } = require('../middleware/auth');
const {
  getInboxForTenant,
  upsertInbox,
  deleteInbox,
  testConnection,
  pollInbox,
} = require('../services/emailService');

// All routes require tenant admin
router.use(adminAuth);

// GET /api/email/inbox — get inbox config for current tenant (password masked)
router.get('/inbox', async (req, res) => {
  try {
    const inbox = await getInboxForTenant(req.tenantId);
    if (!inbox) {
      return res.json({ configured: false });
    }

    res.json({
      configured: true,
      id: inbox.id,
      enabled: !!inbox.enabled,
      folder: inbox.folder,
      imapHost: inbox.imap_host,
      imapPort: inbox.imap_port,
      imapTls: !!inbox.imap_tls,
      imapUser: inbox.imap_user,
      hasPassword: !!inbox.imap_password_enc,
      lastUid: inbox.last_uid,
      createdAt: inbox.created_at,
      updatedAt: inbox.updated_at,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/email/inbox — create or update inbox config
router.put('/inbox', async (req, res) => {
  try {
    const { enabled, folder, imapHost, imapPort, imapTls, imapUser, imapPassword } = req.body;

    if (!imapHost || !imapUser) {
      return res.status(400).json({ error: 'imapHost and imapUser are required' });
    }

    const id = await upsertInbox(req.tenantId, {
      enabled,
      folder,
      imapHost,
      imapPort,
      imapTls,
      imapUser,
      imapPassword, // null if not changing password
    });

    res.json({ id, message: 'Inbox configuration saved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/email/inbox — remove inbox config
router.delete('/inbox', async (req, res) => {
  try {
    await deleteInbox(req.tenantId);
    res.json({ message: 'Inbox configuration removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/email/inbox/test — test IMAP connection
router.post('/inbox/test', async (req, res) => {
  try {
    const { imapHost, imapPort, imapTls, imapUser, imapPassword } = req.body;

    if (!imapHost || !imapUser || !imapPassword) {
      return res.status(400).json({ error: 'imapHost, imapUser, and imapPassword are required' });
    }

    const result = await testConnection({
      imapHost,
      imapPort,
      imapTls,
      imapUser,
      imapPassword,
    });

    if (result.success) {
      res.json({ success: true, folders: result.folders });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/email/inbox/poll — manually trigger a poll
router.post('/inbox/poll', async (req, res) => {
  try {
    const inbox = await getInboxForTenant(req.tenantId);
    if (!inbox) {
      return res.status(404).json({ error: 'No inbox configured' });
    }

    const result = await pollInbox(inbox);

    if (result.error) {
      return res.status(500).json({ error: result.error, results: result.results || [] });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
