const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { adminAuth } = require('../middleware/auth');

const ALLOWED_FIELDS = [
  'approval_enabled',
  'auto_submit_for_approval',
  'auto_export_on_approval',
  'wf_order_proposal_enabled',
  'wf_order_confirmation_enabled',
  'wf_order_enabled',
  'wf_receiving_enabled',
];

// GET /api/settings — return tenant settings
router.get('/', adminAuth, async (req, res) => {
  try {
    const rows = await query(
      'SELECT * FROM tenant_settings WHERE tenant_id = ? LIMIT 1',
      [req.tenantId]
    );
    if (rows.length === 0) {
      return res.json({});
    }
    const s = rows[0];
    res.json({
      approvalEnabled: !!s.approval_enabled,
      autoSubmitForApproval: !!s.auto_submit_for_approval,
      autoExportOnApproval: !!s.auto_export_on_approval,
      wfOrderProposalEnabled: !!s.wf_order_proposal_enabled,
      wfOrderConfirmationEnabled: !!s.wf_order_confirmation_enabled,
      wfOrderEnabled: !!s.wf_order_enabled,
      wfReceivingEnabled: !!s.wf_receiving_enabled,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/settings — update tenant settings
router.put('/', adminAuth, async (req, res) => {
  try {
    const updates = [];
    const values = [];

    const fieldMap = {
      approvalEnabled: 'approval_enabled',
      autoSubmitForApproval: 'auto_submit_for_approval',
      autoExportOnApproval: 'auto_export_on_approval',
      wfOrderProposalEnabled: 'wf_order_proposal_enabled',
      wfOrderConfirmationEnabled: 'wf_order_confirmation_enabled',
      wfOrderEnabled: 'wf_order_enabled',
      wfReceivingEnabled: 'wf_receiving_enabled',
    };

    for (const [camel, snake] of Object.entries(fieldMap)) {
      if (req.body[camel] !== undefined) {
        updates.push(`${snake} = ?`);
        values.push(req.body[camel] ? 1 : 0);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    values.push(req.tenantId);
    await query(
      `UPDATE tenant_settings SET ${updates.join(', ')} WHERE tenant_id = ?`,
      values
    );

    // Return updated settings
    const rows = await query(
      'SELECT * FROM tenant_settings WHERE tenant_id = ? LIMIT 1',
      [req.tenantId]
    );
    const s = rows[0] || {};
    res.json({
      approvalEnabled: !!s.approval_enabled,
      autoSubmitForApproval: !!s.auto_submit_for_approval,
      autoExportOnApproval: !!s.auto_export_on_approval,
      wfOrderProposalEnabled: !!s.wf_order_proposal_enabled,
      wfOrderConfirmationEnabled: !!s.wf_order_confirmation_enabled,
      wfOrderEnabled: !!s.wf_order_enabled,
      wfReceivingEnabled: !!s.wf_receiving_enabled,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
