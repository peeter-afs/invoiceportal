const axios = require('axios');

/**
 * CostPocket OCR fallback extractor.
 * Sends the PDF buffer to CostPocket's API and returns a normalized result.
 *
 * Configure via env:
 *   COSTPOCKET_API_URL   - CostPocket API endpoint
 *   COSTPOCKET_API_KEY   - API key
 */
async function extract(pdfBuffer, filename) {
  const apiUrl = process.env.COSTPOCKET_API_URL;
  const apiKey = process.env.COSTPOCKET_API_KEY;

  if (!apiUrl || !apiKey) {
    throw new Error('CostPocket is not configured (COSTPOCKET_API_URL / COSTPOCKET_API_KEY missing)');
  }

  const FormData = require('form-data');
  const form = new FormData();
  form.append('file', pdfBuffer, { filename, contentType: 'application/pdf' });

  const response = await axios.post(apiUrl, form, {
    headers: {
      ...form.getHeaders(),
      Authorization: `Bearer ${apiKey}`,
    },
    timeout: 30000,
  });

  const data = response.data;

  // Normalize CostPocket response to our standard extraction format
  // CostPocket returns item lines; we map to invoice_lines structure.
  const lines = (data.items || []).map((item, idx) => ({
    rowNo: idx + 1,
    productCode: item.code || null,
    description: item.name || item.description || null,
    qty: item.quantity != null ? Number(item.quantity) : null,
    unit: item.unit || null,
    unitPrice: item.price != null ? Number(item.price) : null,
    net: item.total != null ? Number(item.total) : null,
    vatRate: item.taxRate != null ? Number(item.taxRate) : null,
    vatAmount: item.taxAmount != null ? Number(item.taxAmount) : null,
    gross: item.totalWithTax != null ? Number(item.totalWithTax) : null,
  }));

  return {
    supplierName: data.sellerName || data.vendor || null,
    supplierAddress: data.sellerAddress || null,
    supplierVatNumber: data.sellerVatNumber || null,
    invoiceNumber: data.documentNumber || data.invoiceNumber || null,
    invoiceDate: data.date || null,
    dueDate: data.dueDate || null,
    currency: data.currency || null,
    purchaseOrderNr: data.purchaseOrderNumber || null,
    lines,
    netTotal: data.netTotal != null ? Number(data.netTotal) : null,
    vatTotal: data.vatTotal != null ? Number(data.vatTotal) : null,
    grossTotal: data.total != null ? Number(data.total) : null,
    confidence: 0.8,
    extractedBy: 'costpocket',
    rawResponse: JSON.stringify(data),
  };
}

module.exports = { extract };
