const { query } = require('../db');
const { createFromSession } = require('./futursoftApiClient');

/**
 * Build a receiving preview: matched lines with editable quantities and shelf codes.
 */
async function getReceivingPreview(invoiceId) {
  const invoices = await query(
    'SELECT id, tenant_id, purchase_order_nr, currency FROM invoices WHERE id = ? LIMIT 1',
    [invoiceId]
  );
  const invoice = invoices[0];
  if (!invoice) throw Object.assign(new Error('Invoice not found'), { status: 404 });
  if (!invoice.purchase_order_nr) {
    throw Object.assign(new Error('Invoice has no purchase order number'), { status: 400 });
  }

  const lines = await query(
    `SELECT id, row_no, product_code, description, qty, unit_price, vat_rate, match_data
     FROM invoice_lines WHERE invoice_id = ? ORDER BY row_no`,
    [invoiceId]
  );

  return {
    purchaseOrderNr: invoice.purchase_order_nr,
    currency: invoice.currency || 'EUR',
    lines: lines.map((l) => {
      const match = l.match_data ? JSON.parse(l.match_data) : {};
      return {
        lineId: l.id,
        rowNo: l.row_no,
        productCode: l.product_code || match.matchedProductCode || null,
        description: l.description,
        invoiceQty: l.qty != null ? Number(l.qty) : 0,
        receivingQty: l.qty != null ? Number(l.qty) : 0, // default to invoice qty
        purchasePrice: l.unit_price != null ? Number(l.unit_price) : 0,
        vatRate: l.vat_rate != null ? Number(l.vat_rate) : 0,
        canceledQuantity: 0,
        shelfCode: '',
        poRowNr: match.poRowNr || l.row_no,
      };
    }),
  };
}

/**
 * Post receiving lines to Futursoft.
 * receivingLines is an array from the frontend (user may have edited quantities and shelf codes).
 */
async function postReceiving(invoiceId, receivingLines, session) {
  const invoices = await query(
    'SELECT id, tenant_id, purchase_order_nr, currency FROM invoices WHERE id = ? LIMIT 1',
    [invoiceId]
  );
  const invoice = invoices[0];
  if (!invoice) throw Object.assign(new Error('Invoice not found'), { status: 404 });
  if (!invoice.purchase_order_nr) {
    throw Object.assign(new Error('Invoice has no purchase order number'), { status: 400 });
  }

  const client = await createFromSession(session);
  const results = [];

  for (const line of receivingLines) {
    if (!line.receivingQty || Number(line.receivingQty) <= 0) continue;

    const payload = {
      purchaseOrderNr: invoice.purchase_order_nr,
      rowNr: line.poRowNr || line.rowNo,
      productCode: line.productCode || null,
      supplierNr: line.supplierNr || null,
      userId: session.userId,
      receivedAt: new Date().toISOString(),
      purchasePrice: Number(line.purchasePrice || 0),
      quantity: Number(line.receivingQty),
      vatRate: Number(line.vatRate || 0),
      currencyCode: invoice.currency || 'EUR',
      exchangeRate: Number(line.exchangeRate || 1),
      expenses: Number(line.expenses || 0),
      canceledQuantity: Number(line.canceledQuantity || 0),
      shelfCode: line.shelfCode || '',
    };

    try {
      const result = await client.postReceiving(payload);
      results.push({ rowNo: line.rowNo, success: true, result });
    } catch (err) {
      results.push({ rowNo: line.rowNo, success: false, error: err.message });
    }
  }

  // If all succeeded, update invoice status
  const allSucceeded = results.length > 0 && results.every((r) => r.success);
  if (allSucceeded) {
    await query(
      "UPDATE invoices SET status = 'exported', exported_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
      [invoiceId]
    );
  }

  return { results, allSucceeded };
}

module.exports = { getReceivingPreview, postReceiving };
