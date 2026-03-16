const { query } = require('../db');
const { createFromSession } = require('./futursoftApiClient');

/**
 * Fetch a PO from Futursoft and return it with matched invoice lines.
 */
async function fetchPurchaseOrder(invoiceId, session) {
  const invoices = await query(
    'SELECT id, tenant_id, purchase_order_nr, supplier_name FROM invoices WHERE id = ? LIMIT 1',
    [invoiceId]
  );
  const invoice = invoices[0];
  if (!invoice) throw Object.assign(new Error('Invoice not found'), { status: 404 });
  if (!invoice.purchase_order_nr) {
    throw Object.assign(new Error('Invoice has no purchase order number'), { status: 400 });
  }

  const client = await createFromSession(session);
  const po = await client.getPurchaseOrder(invoice.purchase_order_nr);

  // Attach invoice line match info to PO rows
  const lines = await query(
    `SELECT id, row_no, product_code, description, qty, match_data
     FROM invoice_lines WHERE invoice_id = ? ORDER BY row_no`,
    [invoiceId]
  );

  const matchedLines = lines.map((l) => {
    const match = l.match_data ? JSON.parse(l.match_data) : null;
    return { ...l, match, qty: l.qty != null ? Number(l.qty) : null };
  });

  return { purchaseOrder: po, invoiceLines: matchedLines };
}

/**
 * Create a new PO in Futursoft from invoice data.
 */
async function createPurchaseOrderFromInvoice(invoiceId, session) {
  const invoices = await query(
    'SELECT id, tenant_id, supplier_name FROM invoices WHERE id = ? LIMIT 1',
    [invoiceId]
  );
  const invoice = invoices[0];
  if (!invoice) throw Object.assign(new Error('Invoice not found'), { status: 404 });

  const lines = await query(
    `SELECT id, row_no, product_code, description, qty, unit_price, vat_rate
     FROM invoice_lines WHERE invoice_id = ? ORDER BY row_no`,
    [invoiceId]
  );

  if (lines.length === 0) {
    throw Object.assign(new Error('Invoice has no lines'), { status: 400 });
  }

  const payload = {
    supplierName: invoice.supplier_name,
    rows: lines.map((l) => ({
      productCode: l.product_code || null,
      productName: l.description || null,
      quantity: l.qty != null ? Number(l.qty) : 0,
      purchasePrice: l.unit_price != null ? Number(l.unit_price) : 0,
      vatRate: l.vat_rate != null ? Number(l.vat_rate) : 0,
    })),
  };

  const client = await createFromSession(session);
  const created = await client.createPurchaseOrder(payload);

  // Store the PO number on the invoice
  if (created.purchaseOrderNr) {
    await query(
      'UPDATE invoices SET purchase_order_nr = ? WHERE id = ?',
      [created.purchaseOrderNr, invoiceId]
    );
  }

  return created;
}

module.exports = { fetchPurchaseOrder, createPurchaseOrderFromInvoice };
