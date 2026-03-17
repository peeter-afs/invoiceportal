const crypto = require('crypto');
const { query } = require('../db');

/**
 * Find a matching supplier without creating one.
 * Used during extraction to link existing suppliers only.
 */
async function findSupplier(tenantId, extractedData) {
  const { supplierName, supplierVatNumber, supplierRegNumber } = extractedData;

  if (!supplierName && !supplierVatNumber && !supplierRegNumber) return null;

  if (supplierVatNumber) {
    const byVat = await query(
      'SELECT id, name, futursoft_supplier_nr FROM suppliers WHERE tenant_id = ? AND vat_number = ? LIMIT 1',
      [tenantId, supplierVatNumber]
    );
    if (byVat[0]) return byVat[0];
  }

  if (supplierRegNumber) {
    const byReg = await query(
      'SELECT id, name, futursoft_supplier_nr FROM suppliers WHERE tenant_id = ? AND reg_number = ? LIMIT 1',
      [tenantId, supplierRegNumber]
    );
    if (byReg[0]) return byReg[0];
  }

  if (supplierName) {
    const byName = await query(
      'SELECT id, name, futursoft_supplier_nr FROM suppliers WHERE tenant_id = ? AND LOWER(name) = LOWER(?) LIMIT 1',
      [tenantId, supplierName]
    );
    if (byName[0]) return byName[0];

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

  return null;
}

/**
 * Resolve a supplier from invoice data — match existing or create a new record.
 * Called when an invoice is approved to finalise the supplier link.
 */
async function resolveSupplier(tenantId, extractedData) {
  const { supplierName, supplierVatNumber, supplierRegNumber, supplierAddress, supplierBankAccount } = extractedData;

  // Try to find an existing supplier first
  const found = await findSupplier(tenantId, extractedData);
  if (found) {
    console.log(`[supplier] resolveSupplier: matched existing "${found.name}" (id=${found.id}) for tenant ${tenantId}`);
    return found;
  }

  // No match — auto-create only if we have a name
  if (!supplierName) {
    console.warn(`[supplier] resolveSupplier: no supplierName provided, skipping auto-create for tenant ${tenantId}`);
    return null;
  }

  const supplierId = crypto.randomUUID();
  console.log(`[supplier] resolveSupplier: creating new supplier "${supplierName}" (id=${supplierId}) for tenant ${tenantId}`);
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
    ['extractionInstructions', 'extraction_instructions'],
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

/**
 * Strip common legal suffixes and extra whitespace from a supplier name.
 */
function cleanSupplierName(name) {
  if (!name) return '';
  return name
    .replace(/\b(O[ÜU]|AS|LLC|Ltd\.?|Oy|Ab|GmbH|Inc\.?|S\.?A\.?|SIA|UAB|S\.?R\.?L\.?)\b\.?/gi, '')
    .replace(/[,.\-]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Lookup and store the Futursoft supplier number by searching the Sales API.
 * Performs up to 3 progressive name searches:
 *   1. Full cleaned name
 *   2. First two words of the cleaned name
 *   3. First word of the cleaned name
 * Skips the API call if the supplier already has a futursoft_supplier_nr.
 *
 * @param {string} invoiceId
 * @param {object} session  Express session with fsAccessToken (needed for FS API)
 */
async function lookupFutursoftSupplierNr(invoiceId, session) {
  // Get supplier linked to this invoice
  const rows = await query(
    'SELECT supplier_id FROM invoices WHERE id = ? LIMIT 1',
    [invoiceId]
  );
  if (!rows[0]?.supplier_id) return;

  const supplierId = rows[0].supplier_id;
  const suppliers = await query(
    'SELECT id, name, futursoft_supplier_nr, tenant_id FROM suppliers WHERE id = ? LIMIT 1',
    [supplierId]
  );
  if (!suppliers[0]) return;

  const supplier = suppliers[0];

  // Already has a Futursoft supplier number — nothing to do
  if (supplier.futursoft_supplier_nr) return;

  // Need FS API client
  const { createFromSession } = require('./futursoftApiClient');
  let client;
  try {
    client = await createFromSession(session);
  } catch (err) {
    console.warn(`[supplier] FS client init failed for invoice ${invoiceId}: ${err.message}`);
    return;
  }

  const cleaned = cleanSupplierName(supplier.name);
  const words = cleaned.split(/\s+/).filter(Boolean);

  // Build search candidates: full name, first 2 words, first word
  const candidates = [cleaned];
  if (words.length > 2) candidates.push(words.slice(0, 2).join(' '));
  if (words.length > 1) candidates.push(words[0]);

  for (const searchTerm of candidates) {
    if (!searchTerm) continue;
    let nr;
    try {
      nr = await client.searchSupplierByName(searchTerm);
    } catch (searchErr) {
      console.error(`[supplier] FS search failed for "${searchTerm}" (invoice ${invoiceId}): ${searchErr.message}`);
      continue;
    }
    if (nr && nr !== 0 && nr !== '0') {
      await query(
        'UPDATE suppliers SET futursoft_supplier_nr = ? WHERE id = ?',
        [String(nr), supplierId]
      );
      console.log(`[supplier] Resolved FS supplier nr ${nr} for "${supplier.name}" (search: "${searchTerm}")`);
      return;
    }
  }

  console.log(`[supplier] No FS supplier nr found for "${supplier.name}" after ${candidates.length} searches`);
}

/**
 * Quick supplier match from raw PDF text — scan for known supplier names/aliases.
 * Used BEFORE calling OpenAI to inject supplier-specific context into the prompt.
 * Returns { id, name, futursoft_supplier_nr } or null.
 */
async function quickMatchSupplierFromText(tenantId, pdfText) {
  if (!pdfText || pdfText.length < 10) return null;
  const textLower = pdfText.toLowerCase();

  // Get all supplier names and aliases for this tenant
  const suppliers = await query(
    `SELECT s.id, s.name, s.futursoft_supplier_nr
     FROM suppliers s WHERE s.tenant_id = ?`,
    [tenantId]
  );
  const aliases = await query(
    `SELECT sa.alias, s.id, s.name, s.futursoft_supplier_nr
     FROM supplier_aliases sa
     JOIN suppliers s ON s.id = sa.supplier_id
     WHERE s.tenant_id = ?`,
    [tenantId]
  );

  // Check supplier names (longest first to avoid partial matches)
  const allNames = [
    ...suppliers.map((s) => ({ name: s.name, id: s.id, futursoft_supplier_nr: s.futursoft_supplier_nr })),
    ...aliases.map((a) => ({ name: a.alias, id: a.id, futursoft_supplier_nr: a.futursoft_supplier_nr })),
  ].sort((a, b) => b.name.length - a.name.length);

  for (const entry of allNames) {
    if (entry.name && entry.name.length >= 3 && textLower.includes(entry.name.toLowerCase())) {
      return { id: entry.id, name: entry.name, futursoft_supplier_nr: entry.futursoft_supplier_nr };
    }
  }

  return null;
}

/**
 * Get extraction context for a supplier — instructions + sample JSONs.
 * Used to inject supplier-specific context into the OpenAI extraction prompt.
 */
async function getExtractionContext(supplierId) {
  const suppliers = await query(
    'SELECT extraction_instructions FROM suppliers WHERE id = ? LIMIT 1',
    [supplierId]
  );
  const instructions = suppliers[0]?.extraction_instructions || null;

  const samples = await query(
    'SELECT extracted_json FROM extraction_samples WHERE supplier_id = ? ORDER BY created_at DESC LIMIT 2',
    [supplierId]
  );

  if (!instructions && samples.length === 0) return null;

  return {
    instructions,
    samples: samples.map((s) => {
      try { return JSON.parse(s.extracted_json); } catch { return null; }
    }).filter(Boolean),
  };
}

module.exports = {
  findSupplier,
  resolveSupplier,
  getSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  addAlias,
  removeAlias,
  lookupFutursoftSupplierNr,
  quickMatchSupplierFromText,
  getExtractionContext,
};
