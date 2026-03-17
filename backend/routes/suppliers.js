const express = require('express');
const router = express.Router();
const { auth, adminAuth } = require('../middleware/auth');
const crypto = require('crypto');
const {
  getSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  addAlias,
  removeAlias,
} = require('../services/supplierService');
const { query } = require('../db');
const { saveFile, readFile, deleteFile } = require('../services/fileService');

// GET /api/suppliers — list all suppliers for current tenant
router.get('/', auth, async (req, res) => {
  try {
    const suppliers = await getSuppliers(req.tenantId);
    res.json(suppliers.map(normalizeSupplier));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/suppliers/:id — get supplier with aliases
router.get('/:id', auth, async (req, res) => {
  try {
    const supplier = await getSupplierById(req.tenantId, req.params.id);
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
    res.json(normalizeSupplier(supplier));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/suppliers — create supplier (admin)
router.post('/', adminAuth, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Supplier name is required' });
    const supplier = await createSupplier(req.tenantId, req.body);
    res.status(201).json(normalizeSupplier(supplier));
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'A supplier with this name already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/suppliers/:id — update supplier (any authenticated user)
router.put('/:id', auth, async (req, res) => {
  try {
    const supplier = await updateSupplier(req.tenantId, req.params.id, req.body);
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
    res.json(normalizeSupplier(supplier));
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'A supplier with this name already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/suppliers/:id — delete supplier (admin)
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    const deleted = await deleteSupplier(req.tenantId, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Supplier not found' });
    res.json({ message: 'Supplier deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/suppliers/:id/aliases — add alias (admin)
router.post('/:id/aliases', adminAuth, async (req, res) => {
  try {
    const { alias } = req.body;
    if (!alias) return res.status(400).json({ error: 'Alias is required' });
    const result = await addAlias(req.params.id, alias);
    res.status(201).json(result);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'This alias already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/suppliers/:id/aliases/:aliasId — remove alias (admin)
router.delete('/:id/aliases/:aliasId', adminAuth, async (req, res) => {
  try {
    const deleted = await removeAlias(req.params.aliasId);
    if (!deleted) return res.status(404).json({ error: 'Alias not found' });
    res.json({ message: 'Alias removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/suppliers/:id/samples — list extraction samples
router.get('/:id/samples', auth, async (req, res) => {
  try {
    const samples = await query(
      `SELECT es.id, es.invoice_id, es.notes, es.created_at,
              i.invoice_number, i.supplier_name
       FROM extraction_samples es
       LEFT JOIN invoices i ON i.id = es.invoice_id
       WHERE es.supplier_id = ?
       ORDER BY es.created_at DESC`,
      [req.params.id]
    );
    res.json(samples.map((s) => ({
      id: s.id,
      invoiceId: s.invoice_id,
      invoiceNumber: s.invoice_number || null,
      supplierName: s.supplier_name || null,
      notes: s.notes,
      createdAt: s.created_at,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/suppliers/:id/samples — create sample from invoice
router.post('/:id/samples', auth, async (req, res) => {
  try {
    const { invoiceId, notes } = req.body;
    if (!invoiceId) return res.status(400).json({ error: 'invoiceId is required' });

    // Get invoice data + lines
    const invoices = await query(
      `SELECT i.*, s.futursoft_supplier_nr AS supplier_futursoft_nr
       FROM invoices i LEFT JOIN suppliers s ON s.id = i.supplier_id
       WHERE i.id = ? AND i.tenant_id = ?`,
      [invoiceId, req.tenantId]
    );
    if (invoices.length === 0) return res.status(404).json({ error: 'Invoice not found' });

    const inv = invoices[0];
    const lines = await query(
      'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY row_no ASC',
      [invoiceId]
    );

    // Build extracted JSON (same format as OpenAI output)
    const extractedJson = JSON.stringify({
      supplierName: inv.supplier_name,
      supplierAddress: inv.supplier_address,
      supplierRegNumber: inv.supplier_reg_number,
      supplierVatNumber: inv.supplier_vat_number,
      supplierBankAccount: inv.supplier_bank_account,
      invoiceNumber: inv.invoice_number,
      invoiceDate: inv.invoice_date,
      dueDate: inv.due_date,
      currency: inv.currency,
      netTotal: inv.net_total != null ? Number(inv.net_total) : null,
      vatTotal: inv.vat_total != null ? Number(inv.vat_total) : null,
      grossTotal: inv.gross_total != null ? Number(inv.gross_total) : null,
      lines: lines.map((l) => ({
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
      })),
    });

    // Copy PDF file to sample storage
    const fileRec = await query(
      'SELECT storage_key FROM invoice_files WHERE invoice_id = ? LIMIT 1',
      [invoiceId]
    );
    let sampleStorageKey = '';
    if (fileRec.length > 0) {
      const pdfBuffer = await readFile(fileRec[0].storage_key);
      const sampleId = crypto.randomUUID();
      sampleStorageKey = `samples/${req.params.id}/${sampleId}.pdf`;
      await saveFile(pdfBuffer, sampleStorageKey);

      await query(
        `INSERT INTO extraction_samples (id, supplier_id, invoice_id, storage_key, extracted_json, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [sampleId, req.params.id, invoiceId, sampleStorageKey, extractedJson, notes || null]
      );

      res.status(201).json({ id: sampleId, invoiceId, notes: notes || null });
    } else {
      return res.status(400).json({ error: 'Invoice has no PDF file' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/suppliers/:id/samples/:sampleId — remove sample
router.delete('/:id/samples/:sampleId', auth, async (req, res) => {
  try {
    const samples = await query(
      'SELECT storage_key FROM extraction_samples WHERE id = ? AND supplier_id = ?',
      [req.params.sampleId, req.params.id]
    );
    if (samples.length === 0) return res.status(404).json({ error: 'Sample not found' });

    // Delete file
    try { await deleteFile(samples[0].storage_key); } catch { /* ignore */ }

    await query('DELETE FROM extraction_samples WHERE id = ?', [req.params.sampleId]);
    res.json({ message: 'Sample removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function normalizeSupplier(row) {
  return {
    id: row.id,
    name: row.name,
    vatNumber: row.vat_number,
    regNumber: row.reg_number,
    address: row.address,
    bankAccount: row.bank_account,
    futursoftSupplierNr: row.futursoft_supplier_nr,
    extractionInstructions: row.extraction_instructions || '',
    aliasCount: row.alias_count != null ? Number(row.alias_count) : undefined,
    aliases: row.aliases || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = router;
