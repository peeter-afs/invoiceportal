const express = require('express');
const router = express.Router();
const { auth, adminAuth } = require('../middleware/auth');
const {
  getSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  addAlias,
  removeAlias,
} = require('../services/supplierService');

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

// PUT /api/suppliers/:id — update supplier (admin)
router.put('/:id', adminAuth, async (req, res) => {
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

function normalizeSupplier(row) {
  return {
    id: row.id,
    name: row.name,
    vatNumber: row.vat_number,
    regNumber: row.reg_number,
    address: row.address,
    bankAccount: row.bank_account,
    futursoftSupplierNr: row.futursoft_supplier_nr,
    aliasCount: row.alias_count != null ? Number(row.alias_count) : undefined,
    aliases: row.aliases || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = router;
