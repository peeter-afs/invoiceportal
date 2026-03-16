const crypto = require('crypto');
const { query } = require('../db');
const { createFromSession } = require('./futursoftApiClient');

/**
 * String similarity using trigram overlap (simple, no npm dependency).
 * Returns 0..1.
 */
function trigrams(s) {
  const t = new Set();
  const str = `  ${(s || '').toLowerCase()}  `;
  for (let i = 0; i < str.length - 2; i++) t.add(str.substring(i, i + 3));
  return t;
}

function stringSimilarity(a, b) {
  if (!a || !b) return 0;
  const ta = trigrams(a);
  const tb = trigrams(b);
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  const union = ta.size + tb.size - overlap;
  return union === 0 ? 0 : overlap / union;
}

function numericBoost(invoiceLine, poRow) {
  let boost = 0;
  const invQty = Number(invoiceLine.qty || 0);
  const poQty = Number(poRow.qty || poRow.confirmedQty || 0);
  if (invQty > 0 && poQty > 0 && Math.abs(invQty - poQty) / Math.max(invQty, poQty) < 0.05) {
    boost += 0.025;
  }
  const invPrice = Number(invoiceLine.unit_price || 0);
  const poPrice = Number(poRow.buyingPrice || 0);
  if (invPrice > 0 && poPrice > 0 && Math.abs(invPrice - poPrice) / Math.max(invPrice, poPrice) < 0.05) {
    boost += 0.025;
  }
  return boost;
}

/**
 * Match a single invoice line against a list of PO rows and/or product catalog entries.
 * Returns the best match with confidence and method.
 */
function matchLineAgainstCandidates(invoiceLine, poRows, products) {
  let bestMatch = null;
  let bestConfidence = 0;
  let bestMethod = null;
  let bestCandidate = null;

  const allCandidates = [
    ...poRows.map((r) => ({ ...r, _source: 'po_row' })),
    ...products.map((p) => ({ ...p, _source: 'product' })),
  ];

  const invCode = (invoiceLine.product_code || '').trim().toLowerCase();
  const invDesc = (invoiceLine.description || '').trim();

  for (const candidate of allCandidates) {
    const candCode = (candidate.productCode || '').toLowerCase();
    const candOrderingCode = (candidate.orderingCode || '').toLowerCase();
    const candEan = (candidate.ean || '').trim();
    const candName = candidate.productName || '';

    let confidence = 0;
    let method = null;

    // 1. Exact product code
    if (invCode && candCode && invCode === candCode) {
      confidence = 1.0;
      method = 'exact_product_code';
    }
    // 2. Supplier ordering code
    else if (invCode && candOrderingCode && invCode === candOrderingCode) {
      confidence = 0.95;
      method = 'ordering_code';
    }
    // 3. EAN match
    else if (invCode && candEan && invCode === candEan) {
      confidence = 0.95;
      method = 'ean';
    }
    // 4. Description fuzzy match
    else if (invDesc && candName) {
      const sim = stringSimilarity(invDesc, candName);
      if (sim > 0.3) {
        confidence = 0.5 + sim * 0.4; // maps 0.3..1.0 similarity → 0.62..0.90
        method = 'description_match';
      }
    }

    // 5. Numeric validation boost
    if (confidence > 0 && candidate._source === 'po_row') {
      confidence = Math.min(1.0, confidence + numericBoost(invoiceLine, candidate));
    }

    if (confidence > bestConfidence) {
      bestConfidence = confidence;
      bestMethod = method;
      bestCandidate = candidate;
      bestMatch = {
        matchedProductCode: candidate.productCode || null,
        matchedProductName: candidate.productName || null,
        confidence: Math.round(confidence * 100) / 100,
        matchMethod: method,
        source: candidate._source,
        poNr: candidate.purchaseOrderNr || null,
        poRowNr: candidate.rowNr || null,
      };
    }
  }

  return bestMatch;
}

/**
 * Run matching for all lines of an invoice.
 * Fetches PO data from Futursoft if a PO number is present,
 * plus searches product catalog for unmatched lines.
 */
async function matchInvoice(invoiceId, session) {
  const invoices = await query(
    'SELECT id, tenant_id, purchase_order_nr, supplier_name FROM invoices WHERE id = ? LIMIT 1',
    [invoiceId]
  );
  const invoice = invoices[0];
  if (!invoice) throw Object.assign(new Error('Invoice not found'), { status: 404 });

  const lines = await query(
    `SELECT id, row_no, product_code, description, qty, unit, unit_price, net, vat_rate
     FROM invoice_lines WHERE invoice_id = ? ORDER BY row_no`,
    [invoiceId]
  );

  if (lines.length === 0) return { matched: 0, total: 0, results: [] };

  const fsClient = await createFromSession(session);

  // Fetch PO rows if PO number is available
  let poRows = [];
  if (invoice.purchase_order_nr) {
    try {
      const po = await fsClient.getPurchaseOrder(invoice.purchase_order_nr);
      poRows = (po.rows || []).map((r) => ({
        ...r,
        purchaseOrderNr: po.purchaseOrderNr || invoice.purchase_order_nr,
      }));
    } catch {
      // PO fetch failed, continue with product search only
    }
  }

  const results = [];
  let matchedCount = 0;

  for (const line of lines) {
    // Search product catalog for this line
    let products = [];
    const searchTerm = line.product_code || (line.description || '').substring(0, 50);
    if (searchTerm) {
      try {
        const result = await fsClient.searchProducts(searchTerm);
        products = Array.isArray(result) ? result : [];
      } catch {
        // product search failed, continue
      }
    }

    const match = matchLineAgainstCandidates(line, poRows, products);

    const matchData = match || { confidence: 0, matchMethod: null, matchedProductCode: null };

    // Save match data to invoice_lines
    await query(
      'UPDATE invoice_lines SET match_data = ? WHERE id = ?',
      [JSON.stringify(matchData), line.id]
    );

    if (match && match.confidence >= 0.75) matchedCount++;

    results.push({
      lineId: line.id,
      rowNo: line.row_no,
      productCode: line.product_code,
      description: line.description,
      match: matchData,
    });
  }

  return {
    matched: matchedCount,
    total: lines.length,
    results,
  };
}

/**
 * Get current match results for all lines of an invoice.
 */
async function getMatchResults(invoiceId) {
  const lines = await query(
    `SELECT id, row_no, product_code, description, qty, unit, unit_price, net,
            vat_rate, vat_amount, gross, match_data
     FROM invoice_lines WHERE invoice_id = ? ORDER BY row_no`,
    [invoiceId]
  );

  return lines.map((l) => ({
    lineId: l.id,
    rowNo: l.row_no,
    productCode: l.product_code,
    description: l.description,
    qty: l.qty != null ? Number(l.qty) : null,
    unitPrice: l.unit_price != null ? Number(l.unit_price) : null,
    net: l.net != null ? Number(l.net) : null,
    match: l.match_data ? JSON.parse(l.match_data) : null,
  }));
}

/**
 * User overrides a match for a specific line.
 */
async function overrideMatch(lineId, matchData) {
  const override = {
    ...matchData,
    matchMethod: 'manual_override',
    confidence: 1.0,
  };
  await query(
    'UPDATE invoice_lines SET match_data = ? WHERE id = ?',
    [JSON.stringify(override), lineId]
  );
  return override;
}

module.exports = { matchInvoice, getMatchResults, overrideMatch, stringSimilarity };
