const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getPool, query } = require('../db');
const { auth } = require('../middleware/auth');

function normalizeInvoice(invoiceRow, items = []) {
  if (!invoiceRow) return null;
  return {
    _id: invoiceRow.id,
    invoiceNumber: invoiceRow.invoice_number,
    clientName: invoiceRow.client_name,
    clientEmail: invoiceRow.client_email,
    clientAddress: invoiceRow.client_address,
    items: items.map((it) => ({
      description: it.description,
      quantity: Number(it.quantity),
      unitPrice: Number(it.unit_price),
      amount: Number(it.amount),
    })),
    subtotal: Number(invoiceRow.subtotal),
    tax: Number(invoiceRow.tax),
    total: Number(invoiceRow.total),
    status: invoiceRow.status,
    dueDate: invoiceRow.due_date,
    issueDate: invoiceRow.issue_date,
    notes: invoiceRow.notes,
    createdBy: invoiceRow.created_by,
    createdAt: invoiceRow.created_at,
    updatedAt: invoiceRow.updated_at,
  };
}

async function fetchInvoiceItems(invoiceIds) {
  if (!invoiceIds || invoiceIds.length === 0) return [];
  const placeholders = invoiceIds.map(() => '?').join(',');
  return await query(
    `SELECT invoice_id, description, quantity, unit_price, amount
     FROM invoice_items
     WHERE invoice_id IN (${placeholders})
     ORDER BY created_at ASC`,
    invoiceIds
  );
}

// Get all invoices for the authenticated user
router.get('/', auth, async (req, res) => {
  try {
    const invoices = await query(
      `SELECT id, invoice_number, client_name, client_email, client_address,
              subtotal, tax, total, status, due_date, issue_date, notes,
              created_by, tenant_id, created_at, updated_at
       FROM invoices
       WHERE created_by = ? AND tenant_id = ?
       ORDER BY created_at DESC`,
      [req.userId, req.tenantId]
    );

    const items = await fetchInvoiceItems(invoices.map((inv) => inv.id));
    const itemsByInvoiceId = items.reduce((acc, item) => {
      (acc[item.invoice_id] ||= []).push(item);
      return acc;
    }, {});

    res.json(invoices.map((inv) => normalizeInvoice(inv, itemsByInvoiceId[inv.id] || [])));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get a single invoice
router.get('/:id', auth, async (req, res) => {
  try {
    const invoices = await query(
      `SELECT id, invoice_number, client_name, client_email, client_address,
              subtotal, tax, total, status, due_date, issue_date, notes,
              created_by, tenant_id, created_at, updated_at
       FROM invoices
       WHERE id = ? AND created_by = ? AND tenant_id = ?
       LIMIT 1`,
      [req.params.id, req.userId, req.tenantId]
    );
    const invoice = invoices[0];
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const items = await query(
      'SELECT invoice_id, description, quantity, unit_price, amount FROM invoice_items WHERE invoice_id = ? ORDER BY created_at ASC',
      [invoice.id]
    );
    res.json(normalizeInvoice(invoice, items));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new invoice
router.post('/', auth, async (req, res) => {
  try {
    const {
      invoiceNumber,
      clientName,
      clientEmail,
      clientAddress,
      items,
      subtotal,
      tax,
      total,
      status,
      dueDate,
      issueDate,
      notes,
    } = req.body;

    if (!invoiceNumber || !clientName || !clientEmail || !dueDate) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Invoice must have at least one item' });
    }

    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const invoiceId = crypto.randomUUID();
      await conn.execute(
        `INSERT INTO invoices (
           id, tenant_id, invoice_number, client_name, client_email, client_address,
           subtotal, tax, total, status, due_date, issue_date, notes, created_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          invoiceId,
          req.tenantId,
          invoiceNumber,
          clientName,
          clientEmail,
          clientAddress || null,
          subtotal ?? 0,
          tax ?? 0,
          total ?? 0,
          status || 'draft',
          dueDate,
          issueDate || new Date(),
          notes || null,
          req.userId,
        ]
      );

      for (const item of items) {
        await conn.execute(
          `INSERT INTO invoice_items (
             id, invoice_id, description, quantity, unit_price, amount
           ) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            crypto.randomUUID(),
            invoiceId,
            item.description,
            item.quantity,
            item.unitPrice,
            item.amount,
          ]
        );
      }

      await conn.commit();

      const createdInvoices = await query(
        `SELECT id, invoice_number, client_name, client_email, client_address,
                subtotal, tax, total, status, due_date, issue_date, notes,
                created_by, tenant_id, created_at, updated_at
         FROM invoices WHERE id = ? AND tenant_id = ? LIMIT 1`,
        [invoiceId, req.tenantId]
      );
      const createdItems = await query(
        'SELECT invoice_id, description, quantity, unit_price, amount FROM invoice_items WHERE invoice_id = ? ORDER BY created_at ASC',
        [invoiceId]
      );

      res.status(201).json(normalizeInvoice(createdInvoices[0], createdItems));
    } catch (error) {
      try {
        await conn.rollback();
      } catch {
        // ignore rollback errors
      }
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
      'SELECT id FROM invoices WHERE id = ? AND created_by = ? AND tenant_id = ? LIMIT 1',
      [invoiceId, req.userId, req.tenantId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const updatable = [
        ['invoiceNumber', 'invoice_number'],
        ['clientName', 'client_name'],
        ['clientEmail', 'client_email'],
        ['clientAddress', 'client_address'],
        ['subtotal', 'subtotal'],
        ['tax', 'tax'],
        ['total', 'total'],
        ['status', 'status'],
        ['dueDate', 'due_date'],
        ['issueDate', 'issue_date'],
        ['notes', 'notes'],
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
        params.push(invoiceId, req.userId, req.tenantId);
        await conn.execute(
          `UPDATE invoices SET ${sets.join(', ')} WHERE id = ? AND created_by = ? AND tenant_id = ?`,
          params
        );
      }

      if (Object.prototype.hasOwnProperty.call(req.body, 'items')) {
        if (!Array.isArray(req.body.items) || req.body.items.length === 0) {
          throw new Error('Invoice must have at least one item');
        }
        await conn.execute('DELETE FROM invoice_items WHERE invoice_id = ?', [invoiceId]);
        for (const item of req.body.items) {
          await conn.execute(
            `INSERT INTO invoice_items (
               id, invoice_id, description, quantity, unit_price, amount
             ) VALUES (?, ?, ?, ?, ?, ?)`,
            [
              crypto.randomUUID(),
              invoiceId,
              item.description,
              item.quantity,
              item.unitPrice,
              item.amount,
            ]
          );
        }
      }

      await conn.commit();

      const invoices = await query(
        `SELECT id, invoice_number, client_name, client_email, client_address,
                subtotal, tax, total, status, due_date, issue_date, notes,
                created_by, tenant_id, created_at, updated_at
         FROM invoices WHERE id = ? AND created_by = ? AND tenant_id = ? LIMIT 1`,
        [invoiceId, req.userId, req.tenantId]
      );
      const items = await query(
        'SELECT invoice_id, description, quantity, unit_price, amount FROM invoice_items WHERE invoice_id = ? ORDER BY created_at ASC',
        [invoiceId]
      );

      res.json(normalizeInvoice(invoices[0], items));
    } catch (error) {
      try {
        await conn.rollback();
      } catch {
        // ignore rollback errors
      }
      throw error;
    } finally {
      conn.release();
    }
  } catch (error) {
    const status = error.message === 'Invoice must have at least one item' ? 400 : 500;
    res.status(status).json({ error: error.message });
  }
});

// Delete an invoice
router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM invoices WHERE id = ? AND created_by = ? AND tenant_id = ?',
      [req.params.id, req.userId, req.tenantId]
    );

    if (!result || result.affectedRows === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    res.json({ message: 'Invoice deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
