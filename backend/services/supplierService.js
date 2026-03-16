const crypto = require('crypto');
const { query } = require('../db');

/**
 * Resolve a supplier from extracted invoice data.
 * Matches by: VAT number → reg number → name/alias (case-insensitive).
 * Auto-creates if no match found.
 */
async function resolveSupplier(tenantId, extractedData) {
  const { supplierName, supplierVatNumber, supplierRegNumber, supplierAddress, supplierBankAccount } = extractedData;

  if (!supplierName && !supplierVatNumber && !supplierRegNumber) {
    return null; // nothing to match on
  }

  // 1. Match by VAT number (exact)
  if (supplierVatNumber) {
    const byVat = await query(
      'SELECT id, name, futursoft_supplier_nr FROM suppliers WHERE tenant_id = ? AND vat_number = ? LIMIT 1',
      [tenantId, supplierVatNumber]
    );
    if (byVat[0]) return byVat[0];
  }

  // 2. Match by reg number (exact)
  if (supplierRegNumber) {
    const byReg = await query(
      'SELECT id, name, futursoft_supplier_nr FROM suppliers WHERE tenant_id = ? AND reg_number = ? LIMIT 1',
      [tenantId, supplierRegNumber]
    );
    if (byReg[0]) return byReg[0];
  }

  // 3. Match by name (case-insensitive)
  if (supplierName) {
    const byName = await query(
      'SELECT id, name, futursoft_supplier_nr FROM suppliers WHERE tenant_id = ? AND LOWER(name) = LOWER(?) LIMIT 1',
      [tenantId, supplierName]
    );
    if (byName[0]) return byName[0];

    // 3b. Match by alias
    const byAlias = await query(
      `SELECT s.id, s.name, s.futursoft_supplier_nr
       FROM suppliers s
       JOIN supplier_aliases sa ON sa.supplier_id = s.id
       WHERE s.tenant_id = ? AND LOWER(sa.alias) = LOWER(?)
       LIMIT 1`,
      [tenantId, supplierName]
    );
    if (byAlias[0]) return byAlias[0];
  }

  // 4. No match — auto-create
  if (!supplierName) return null;

  const supplierId = crypto.randomUUID();
  await query(
    `INSERT INTO suppliers (id, tenant_id, name, vat_number, reg_number, address, bank_account)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [supplierId, tenantId, supplierName, supplierVatNumber || null, supplierRegNumber || null, supplierAddress || null, supplierBankAccount || null]
  );

  return { id: supplierId, name: supplierName, futursoft_supplier_nr: null };
}

/**
 * Get all suppliers for a tenant.
 */
async function getSuppliers(tenantId) {
  return query(
    `SELECT s.*, (SELECT COUNT(*) FROM supplier_aliases sa WHERE sa.supplier_id = s.id) AS alias_count
     FROM suppliers s
     WHERE s.tenant_id = ?
     ORDER BY s.name ASC`,
    [tenantId]
  );
}

/**
 * Get a single supplier by ID with aliases.
 */
async function getSupplierById(tenantId, supplierId) {
  const suppliers = await query(
    'SELECT * FROM suppliers WHERE id = ? AND tenant_id = ? LIMIT 1',
    [supplierId, tenantId]
  );
  if (!suppliers[0]) return null;

  const aliases = await query(
    'SELECT id, alias, created_at FROM supplier_aliases WHERE supplier_id = ? ORDER BY alias ASC',
    [supplierId]
  );

  return { ...suppliers[0], aliases };
}

/**
 * Create a new supplier manually.
 */
async function createSupplier(tenantId, data) {
  const supplierId = crypto.randomUUID();
  await query(
    `INSERT INTO suppliers (id, tenant_id, name, vat_number, reg_number, address, bank_account, futursoft_supplier_nr)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      supplierId, tenantId, data.name,
      data.vatNumber || null, data.regNumber || null,
      data.address || null, data.bankAccount || null,
      data.futursoftSupplierNr || null,
    ]
  );
  return getSupplierById(tenantId, supplierId);
}

/**
 * Update a supplier.
 */
async function updateSupplier(tenantId, supplierId, data) {
  const fields = [];
  const params = [];

  const updatable = [
    ['name', 'name'],
    ['vatNumber', 'vat_number'],
    ['regNumber', 'reg_number'],
    ['address', 'address'],
    ['bankAccount', 'bank_account'],
    ['futursoftSupplierNr', 'futursoft_supplier_nr'],
  ];

  for (const [bodyKey, col] of updatable) {
    if (Object.prototype.hasOwnProperty.call(data, bodyKey)) {
      fields.push(`${col} = ?`);
      params.push(data[bodyKey] || null);
    }
  }

  if (fields.length === 0) return getSupplierById(tenantId, supplierId);

  params.push(supplierId, tenantId);
  await query(
    `UPDATE suppliers SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`,
    params
  );

  return getSupplierById(tenantId, supplierId);
}

/**
 * Delete a supplier.
 */
async function deleteSupplier(tenantId, supplierId) {
  const result = await query(
    'DELETE FROM suppliers WHERE id = ? AND tenant_id = ?',
    [supplierId, tenantId]
  );
  return result.affectedRows > 0;
}

/**
 * Add an alias to a supplier.
 */
async function addAlias(supplierId, alias) {
  const aliasId = crypto.randomUUID();
  await query(
    'INSERT INTO supplier_aliases (id, supplier_id, alias) VALUES (?, ?, ?)',
    [aliasId, supplierId, alias]
  );
  return { id: aliasId, supplier_id: supplierId, alias };
}

/**
 * Remove an alias.
 */
async function removeAlias(aliasId) {
  const result = await query('DELETE FROM supplier_aliases WHERE id = ?', [aliasId]);
  return result.affectedRows > 0;
}

module.exports = {
  resolveSupplier,
  getSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  addAlias,
  removeAlias,
};
