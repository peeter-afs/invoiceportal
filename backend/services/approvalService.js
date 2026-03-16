const crypto = require('crypto');
const { query } = require('../db');
const { resolveSupplier } = require('./supplierService');

// Valid transitions
const TRANSITIONS = {
  submit:  { from: ['needs_review', 'ready', 'rejected'], to: 'pending_approval' },
  approve: { from: ['pending_approval'], to: 'approved' },
  reject:  { from: ['pending_approval'], to: 'rejected' },
};

async function getInvoice(invoiceId, tenantId) {
  const rows = await query(
    'SELECT id, status, approval_status, tenant_id FROM invoices WHERE id = ? AND tenant_id = ? LIMIT 1',
    [invoiceId, tenantId]
  );
  return rows[0] || null;
}

async function recordApprovalAction(invoiceId, action, userId, role, comment) {
  await query(
    `INSERT INTO invoice_approvals (id, invoice_id, action, actor_user_id, actor_role, comment)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [crypto.randomUUID(), invoiceId, action, userId, role, comment || null]
  );
}

async function submitForApproval(invoiceId, tenantId, userId, role) {
  const invoice = await getInvoice(invoiceId, tenantId);
  if (!invoice) throw Object.assign(new Error('Invoice not found'), { status: 404 });

  const transition = TRANSITIONS.submit;
  if (!transition.from.includes(invoice.status)) {
    throw Object.assign(
      new Error(`Cannot submit invoice with status '${invoice.status}' for approval`),
      { status: 400 }
    );
  }

  await query(
    `UPDATE invoices SET status = 'pending_approval', approval_status = 'pending' WHERE id = ? AND tenant_id = ?`,
    [invoiceId, tenantId]
  );
  await recordApprovalAction(invoiceId, 'submit', userId, role, null);
}

async function approve(invoiceId, tenantId, userId, role, comment) {
  const invoice = await getInvoice(invoiceId, tenantId);
  if (!invoice) throw Object.assign(new Error('Invoice not found'), { status: 404 });

  if (invoice.status !== 'pending_approval') {
    throw Object.assign(
      new Error(`Cannot approve invoice with status '${invoice.status}'`),
      { status: 400 }
    );
  }

  await query(
    `UPDATE invoices SET
       status = 'approved',
       approval_status = 'approved',
       approved_by = ?,
       approved_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND tenant_id = ?`,
    [userId, invoiceId, tenantId]
  );
  await recordApprovalAction(invoiceId, 'approve', userId, role, comment);

  // Finalise supplier link: resolve or create from invoice's extracted data
  try {
    const rows = await query(
      `SELECT supplier_id, supplier_name, supplier_vat_number, supplier_reg_number,
              supplier_address, supplier_bank_account
       FROM invoices WHERE id = ? LIMIT 1`,
      [invoiceId]
    );
    const inv = rows[0];
    console.log(`[approval] Supplier resolution for invoice ${invoiceId}: supplier_id=${inv?.supplier_id || 'null'}, supplier_name=${inv?.supplier_name || 'null'}`);
    if (inv && !inv.supplier_id && inv.supplier_name) {
      const supplier = await resolveSupplier(tenantId, {
        supplierName: inv.supplier_name,
        supplierVatNumber: inv.supplier_vat_number,
        supplierRegNumber: inv.supplier_reg_number,
        supplierAddress: inv.supplier_address,
        supplierBankAccount: inv.supplier_bank_account,
      });
      if (supplier) {
        await query('UPDATE invoices SET supplier_id = ? WHERE id = ?', [supplier.id, invoiceId]);
      }
    }
  } catch (err) {
    console.error(`[approval] Supplier resolution failed for invoice ${invoiceId}:`, err.message);
  }
}

async function reject(invoiceId, tenantId, userId, role, comment) {
  const invoice = await getInvoice(invoiceId, tenantId);
  if (!invoice) throw Object.assign(new Error('Invoice not found'), { status: 404 });

  if (invoice.status !== 'pending_approval') {
    throw Object.assign(
      new Error(`Cannot reject invoice with status '${invoice.status}'`),
      { status: 400 }
    );
  }

  await query(
    `UPDATE invoices SET
       status = 'rejected',
       approval_status = 'rejected',
       rejected_by = ?,
       rejected_at = CURRENT_TIMESTAMP(3),
       rejection_reason = ?
     WHERE id = ? AND tenant_id = ?`,
    [userId, comment || null, invoiceId, tenantId]
  );
  await recordApprovalAction(invoiceId, 'reject', userId, role, comment);
}

async function getApprovalHistory(invoiceId) {
  return query(
    `SELECT ia.id, ia.action, ia.actor_role, ia.comment, ia.created_at,
            pu.fs_username AS actorUsername, pu.display_name AS actorDisplayName
     FROM invoice_approvals ia
     JOIN portal_users pu ON pu.id = ia.actor_user_id
     WHERE ia.invoice_id = ?
     ORDER BY ia.created_at ASC`,
    [invoiceId]
  );
}

module.exports = { submitForApproval, approve, reject, getApprovalHistory };
