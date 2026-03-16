const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getPool, query } = require('../db');
const { auth, requireRole } = require('../middleware/auth');
const { readFile, fileExists, getPresignedUrl } = require('../services/fileService');
const {
  submitForApproval,
  approve,
  reject,
  getApprovalHistory,
} = require('../services/approvalService');
const { matchInvoice, getMatchResults, overrideMatch } = require('../services/matchingService');
const { fetchPurchaseOrder, createPurchaseOrderFromInvoice } = require('../services/purchaseOrderService');
const { getReceivingPreview, postReceiving } = require('../services/receivingService');
const { getConsolidationState, applyConsolidationActions } = require('../services/consolidationService');
const { getTenantSettings } = require('../services/tenantService');

function normalizeInvoice(row, lines = []) {
  if (!row) return null;
  return {
    _id: row.id,
    status: row.status,
    sourceType: row.source_type,
    supplierName: row.supplier_name,
    supplierAddress: row.supplier_address,
    supplierRegNumber: row.supplier_reg_number,
    supplierVatNumber: row.supplier_vat_number,
    supplierBankAccount: row.supplier_bank_account,
    supplierId: row.supplier_id || null,
    futursoftSupplierNr: row.supplier_futursoft_nr || null,
    invoiceNumber: row.invoice_number,
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    currency: row.currency,
    netTotal: row.net_total != null ? Number(row.net_total) : null,
    vatTotal: row.vat_total != null ? Number(row.vat_total) : null,
    grossTotal: row.gross_total != null ? Number(row.gross_total) : null,
    purchaseOrderNr: row.purchase_order_nr,
    referenceNumber: row.reference_number,
    penaltyRate: row.penalty_rate,
    paymentTerms: row.payment_terms,
    deliveryDate: row.delivery_date,
    deliveryMethod: row.delivery_method,
    deliveryNoteNr: row.delivery_note_nr,
    buyerReference: row.buyer_reference,
    sellerReference: row.seller_reference,
    requiresApproval: row.requires_approval,
    approvalStatus: row.approval_status,
    originalFilename: row.original_filename,
    errorMessage: row.error_message,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lines: lines.map((l) => ({
      id: l.id,
      rowNo: l.row_no,
      productCode: l.product_code,
      description: l.description,
      qty: l.qty != null ? Number(l.qty) : null,
      unit: l.unit,
      unitPrice: l.unit_price != null ? Number(l.unit_price) : null,
      net: l.net != null ? Number(l.net) : null,
      vatRate: l.vat_rate != null ? Number(l.vat_rate) : null,
      vatAmount: l.vat_amount != null ? Number(l.vat_amount) : null,
      gross: l.gross != null ? Number(l.gross) : null,
      matchData: l.match_data ? JSON.parse(l.match_data) : null,
    })),
  };
}

const INVOICE_COLUMNS = `i.id, i.tenant_id, i.status, i.source_type, i.supplier_name, i.supplier_address,
  i.supplier_id, i.supplier_reg_number, i.supplier_vat_number, i.supplier_bank_account,
  i.invoice_number, i.invoice_date, i.due_date, i.currency, i.net_total, i.vat_total, i.gross_total,
  i.purchase_order_nr, i.reference_number, i.penalty_rate, i.payment_terms,
  i.delivery_date, i.delivery_method, i.delivery_note_nr, i.buyer_reference, i.seller_reference,
  i.requires_approval, i.approval_status, i.original_filename,
  i.error_message, i.created_by, i.created_at, i.updated_at,
  s.futursoft_supplier_nr AS supplier_futursoft_nr`;

async function fetchInvoiceLines(invoiceIds) {
  if (!invoiceIds || invoiceIds.length === 0) return [];
  const placeholders = invoiceIds.map(() => '?').join(',');
  return await query(
    `SELECT id, invoice_id, row_no, product_code, description, qty, unit,
            unit_price, net, vat_rate, vat_amount, gross, match_data
     FROM invoice_lines
     WHERE invoice_id IN (${placeholders})
     ORDER BY row_no ASC`,
    invoiceIds
  );
}

// Get all invoices for the tenant
router.get('/', auth, async (req, res) => {
  try {
    const invoices = await query(
      `SELECT ${INVOICE_COLUMNS}
       FROM invoices i
       LEFT JOIN suppliers s ON s.id = i.supplier_id
       WHERE i.tenant_id = ?
       ORDER BY i.created_at DESC`,
      [req.tenantId]
    );

    const lines = await fetchInvoiceLines(invoices.map((inv) => inv.id));
    const linesByInvoice = lines.reduce((acc, line) => {
      (acc[line.invoice_id] ||= []).push(line);
      return acc;
    }, {});

    res.json(invoices.map((inv) => normalizeInvoice(inv, linesByInvoice[inv.id] || [])));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get a single invoice
router.get('/:id', auth, async (req, res) => {
  try {
    const invoices = await query(
      `SELECT ${INVOICE_COLUMNS}
       FROM invoices i
       LEFT JOIN suppliers s ON s.id = i.supplier_id
       WHERE i.id = ? AND i.tenant_id = ?
       LIMIT 1`,
      [req.params.id, req.tenantId]
    );
    const invoice = invoices[0];
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const [lines, settings] = await Promise.all([
      query(
        `SELECT id, invoice_id, row_no, product_code, description, qty, unit,
                unit_price, net, vat_rate, vat_amount, gross, match_data
         FROM invoice_lines WHERE invoice_id = ? ORDER BY row_no ASC`,
        [invoice.id]
      ),
      getTenantSettings(req.tenantId),
    ]);
    const result = normalizeInvoice(invoice, lines);
    result.workflowConfig = {
      orderProposal: !!(settings && settings.wf_order_proposal_enabled),
      orderConfirmation: !!(settings && settings.wf_order_confirmation_enabled),
      order: !!(settings && settings.wf_order_enabled),
      receiving: !!(settings && settings.wf_receiving_enabled),
    };
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new invoice (manual entry)
router.post('/', auth, async (req, res) => {
  try {
    const {
      supplierName,
      invoiceNumber,
      invoiceDate,
      dueDate,
      currency,
      lines,
      purchaseOrderNr,
    } = req.body;

    if (!supplierName || !invoiceNumber) {
      return res.status(400).json({ error: 'Supplier name and invoice number are required' });
    }

    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const invoiceId = crypto.randomUUID();

      // Calculate totals from lines
      let netTotal = 0;
      let vatTotal = 0;
      let grossTotal = 0;
      if (Array.isArray(lines)) {
        for (const line of lines) {
          netTotal += Number(line.net || 0);
          vatTotal += Number(line.vatAmount || 0);
          grossTotal += Number(line.gross || line.net || 0);
        }
      }

      await conn.execute(
        `INSERT INTO invoices (
           id, tenant_id, status, source_type, supplier_name, invoice_number,
           invoice_date, due_date, currency, net_total, vat_total, gross_total,
           purchase_order_nr, created_by
         ) VALUES (?, ?, 'needs_review', 'upload', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          invoiceId, req.tenantId, supplierName, invoiceNumber,
          invoiceDate || null, dueDate || null, currency || 'EUR',
          netTotal, vatTotal, grossTotal,
          purchaseOrderNr || null, req.userId,
        ]
      );

      if (Array.isArray(lines)) {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          await conn.execute(
            `INSERT INTO invoice_lines (
               id, invoice_id, row_no, product_code, description, qty, unit,
               unit_price, net, vat_rate, vat_amount, gross
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              crypto.randomUUID(), invoiceId, i + 1,
              line.productCode || null, line.description || null,
              line.qty || null, line.unit || null, line.unitPrice || null,
              line.net || null, line.vatRate || null, line.vatAmount || null,
              line.gross || null,
            ]
          );
        }
      }

      await conn.commit();

      const created = await query(
        `SELECT ${INVOICE_COLUMNS} FROM invoices i LEFT JOIN suppliers s ON s.id = i.supplier_id WHERE i.id = ? LIMIT 1`,
        [invoiceId]
      );
      const createdLines = await query(
        `SELECT id, invoice_id, row_no, product_code, description, qty, unit,
                unit_price, net, vat_rate, vat_amount, gross, match_data
         FROM invoice_lines WHERE invoice_id = ? ORDER BY row_no ASC`,
        [invoiceId]
      );

      res.status(201).json(normalizeInvoice(created[0], createdLines));
    } catch (error) {
      try { await conn.rollback(); } catch { /* ignore */ }
      throw error;
    } finally {
      conn.release();
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update an invoice
router.put('/:id', auth, async (req, res) => {
  try {
    const invoiceId = req.params.id;

    const existing = await query(
      'SELECT id FROM invoices WHERE id = ? AND tenant_id = ? LIMIT 1',
      [invoiceId, req.tenantId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const updatable = [
        ['supplierId', 'supplier_id'],
        ['supplierName', 'supplier_name'],
        ['supplierAddress', 'supplier_address'],
        ['supplierRegNumber', 'supplier_reg_number'],
        ['supplierBankAccount', 'supplier_bank_account'],
        ['invoiceNumber', 'invoice_number'],
        ['invoiceDate', 'invoice_date'],
        ['dueDate', 'due_date'],
        ['currency', 'currency'],
        ['netTotal', 'net_total'],
        ['vatTotal', 'vat_total'],
        ['grossTotal', 'gross_total'],
        ['status', 'status'],
        ['purchaseOrderNr', 'purchase_order_nr'],
        ['referenceNumber', 'reference_number'],
        ['penaltyRate', 'penalty_rate'],
        ['paymentTerms', 'payment_terms'],
        ['deliveryDate', 'delivery_date'],
        ['deliveryMethod', 'delivery_method'],
        ['deliveryNoteNr', 'delivery_note_nr'],
        ['buyerReference', 'buyer_reference'],
        ['sellerReference', 'seller_reference'],
      ];

      const sets = [];
      const params = [];
      for (const [bodyKey, col] of updatable) {
        if (Object.prototype.hasOwnProperty.call(req.body, bodyKey)) {
          sets.push(`${col} = ?`);
          params.push(req.body[bodyKey]);
        }
      }

      if (sets.length > 0) {
        params.push(invoiceId, req.tenantId);
        await conn.execute(
          `UPDATE invoices SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`,
          params
        );
      }

      if (Object.prototype.hasOwnProperty.call(req.body, 'lines')) {
        await conn.execute('DELETE FROM invoice_lines WHERE invoice_id = ?', [invoiceId]);
        if (Array.isArray(req.body.lines)) {
          for (let i = 0; i < req.body.lines.length; i++) {
            const line = req.body.lines[i];
            await conn.execute(
              `INSERT INTO invoice_lines (
                 id, invoice_id, row_no, product_code, description, qty, unit,
                 unit_price, net, vat_rate, vat_amount, gross
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                crypto.randomUUID(), invoiceId, i + 1,
                line.productCode || null, line.description || null,
                line.qty || null, line.unit || null, line.unitPrice || null,
                line.net || null, line.vatRate || null, line.vatAmount || null,
                line.gross || null,
              ]
            );
          }
        }
      }

      await conn.commit();

      const updated = await query(
        `SELECT ${INVOICE_COLUMNS} FROM invoices i LEFT JOIN suppliers s ON s.id = i.supplier_id WHERE i.id = ? LIMIT 1`,
        [invoiceId]
      );
      const updatedLines = await query(
        `SELECT id, invoice_id, row_no, product_code, description, qty, unit,
                unit_price, net, vat_rate, vat_amount, gross, match_data
         FROM invoice_lines WHERE invoice_id = ? ORDER BY row_no ASC`,
        [invoiceId]
      );

      res.json(normalizeInvoice(updated[0], updatedLines));
    } catch (error) {
      try { await conn.rollback(); } catch { /* ignore */ }
      throw error;
    } finally {
      conn.release();
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete an invoice
router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM invoices WHERE id = ? AND tenant_id = ?',
      [req.params.id, req.tenantId]
    );

    if (!result || result.affectedRows === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    res.json({ message: 'Invoice deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get processing logs for an invoice
router.get('/:id/logs', auth, async (req, res) => {
  try {
    const logs = await query(
      `SELECT id, step, level, message, payload, created_at
       FROM processing_logs
       WHERE invoice_id = ?
       ORDER BY created_at ASC`,
      [req.params.id]
    );
    res.json(logs.map((l) => ({
      ...l,
      payload: l.payload ? JSON.parse(l.payload) : null,
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get the PDF file for an invoice
router.get('/:id/file', auth, async (req, res) => {
  try {
    const files = await query(
      'SELECT storage_key, filename, mime FROM invoice_files WHERE invoice_id = ? LIMIT 1',
      [req.params.id]
    );
    if (files.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }
    const file = files[0];
    if (!await fileExists(file.storage_key)) {
      return res.status(404).json({ error: 'File not found on disk' });
    }
    // In S3/R2 mode: redirect to a short-lived presigned URL (no bandwidth through server)
    const presignedUrl = await getPresignedUrl(file.storage_key);
    if (presignedUrl) {
      return res.redirect(302, presignedUrl);
    }
    // Local mode: stream the file directly
    const buffer = await readFile(file.storage_key);
    res.setHeader('Content-Type', file.mime || 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${file.filename}"`);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Submit invoice for approval (reviewer or admin)
router.post('/:id/submit', auth, requireRole('reviewer', 'tenant_admin'), async (req, res) => {
  try {
    await submitForApproval(req.params.id, req.tenantId, req.userId, req.user.role);
    res.json({ message: 'Invoice submitted for approval' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Approve invoice (approver or admin)
router.post('/:id/approve', auth, requireRole('approver', 'tenant_admin'), async (req, res) => {
  try {
    await approve(req.params.id, req.tenantId, req.userId, req.user.role, req.body.comment);
    res.json({ message: 'Invoice approved' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Reject invoice (approver or admin)
router.post('/:id/reject', auth, requireRole('approver', 'tenant_admin'), async (req, res) => {
  try {
    if (!req.body.comment) {
      return res.status(400).json({ error: 'Rejection reason is required' });
    }
    await reject(req.params.id, req.tenantId, req.userId, req.user.role, req.body.comment);
    res.json({ message: 'Invoice rejected' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Get approval history
router.get('/:id/approvals', auth, async (req, res) => {
  try {
    const history = await getApprovalHistory(req.params.id);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Matching ──

// Trigger matching for an invoice
router.post('/:id/match', auth, async (req, res) => {
  try {
    const results = await matchInvoice(req.params.id, req.session);
    res.json(results);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Get match results
router.get('/:id/matches', auth, async (req, res) => {
  try {
    const results = await getMatchResults(req.params.id);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Override match for a line
router.put('/:id/lines/:lineId/match', auth, async (req, res) => {
  try {
    const result = await overrideMatch(req.params.lineId, req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Purchase Orders ──

// Get PO details for an invoice
router.get('/:id/purchase-order', auth, async (req, res) => {
  try {
    const data = await fetchPurchaseOrder(req.params.id, req.session);
    res.json(data);
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

// Create a PO from invoice data
router.post('/:id/purchase-order', auth, async (req, res) => {
  try {
    const po = await createPurchaseOrderFromInvoice(req.params.id, req.session);
    res.status(201).json(po);
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

// ── Receiving ──

// Get receiving preview
router.get('/:id/receiving-preview', auth, async (req, res) => {
  try {
    const preview = await getReceivingPreview(req.params.id);
    res.json(preview);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Post receiving
router.post('/:id/receiving', auth, async (req, res) => {
  try {
    const { lines } = req.body;
    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'Receiving lines are required' });
    }
    const result = await postReceiving(req.params.id, lines, req.session);
    res.json(result);
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

// ── Consolidation ──

// Get consolidation state
router.get('/:id/consolidation', auth, async (req, res) => {
  try {
    const state = await getConsolidationState(req.params.id, req.session);
    res.json(state);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Apply consolidation actions
router.post('/:id/consolidation/actions', auth, async (req, res) => {
  try {
    const { actions } = req.body;
    if (!Array.isArray(actions) || actions.length === 0) {
      return res.status(400).json({ error: 'Actions array is required' });
    }
    const result = await applyConsolidationActions(req.params.id, actions, req.session);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
