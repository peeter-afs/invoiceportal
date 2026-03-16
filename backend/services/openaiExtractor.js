const OpenAI = require('openai');

let client;
function getClient() {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
    client = new OpenAI({ apiKey });
  }
  return client;
}

// ── Strict JSON Schema for OpenAI Structured Outputs ──
// This forces the model to return exactly these fields with correct types.
// `strict: true` guarantees schema conformance — no extra fields, no wrong types.
const INVOICE_SCHEMA = {
  name: 'invoice_extraction',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      supplierName: { type: ['string', 'null'] },
      supplierAddress: { type: ['string', 'null'] },
      supplierRegNumber: { type: ['string', 'null'] },
      supplierVatNumber: { type: ['string', 'null'] },
      supplierBankAccount: { type: ['string', 'null'] },
      invoiceNumber: { type: ['string', 'null'] },
      invoiceDate: { type: ['string', 'null'], description: 'YYYY-MM-DD format' },
      dueDate: { type: ['string', 'null'], description: 'YYYY-MM-DD format' },
      currency: { type: ['string', 'null'], description: 'ISO 4217 code, e.g. EUR' },
      purchaseOrderNr: { type: ['string', 'null'] },
      referenceNumber: { type: ['string', 'null'] },
      penaltyRate: { type: ['string', 'null'] },
      paymentTerms: { type: ['string', 'null'] },
      deliveryDate: { type: ['string', 'null'], description: 'YYYY-MM-DD format' },
      deliveryMethod: { type: ['string', 'null'] },
      deliveryNoteNr: { type: ['string', 'null'] },
      buyerReference: { type: ['string', 'null'] },
      sellerReference: { type: ['string', 'null'] },
      lines: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            rowNo: { type: 'number' },
            productCode: { type: ['string', 'null'] },
            description: { type: ['string', 'null'] },
            qty: { type: ['number', 'null'] },
            unit: { type: ['string', 'null'] },
            unitPrice: { type: ['number', 'null'] },
            net: { type: ['number', 'null'] },
            vatRate: { type: ['number', 'null'] },
            vatAmount: { type: ['number', 'null'] },
            gross: { type: ['number', 'null'] },
          },
          required: ['rowNo', 'productCode', 'description', 'qty', 'unit', 'unitPrice', 'net', 'vatRate', 'vatAmount', 'gross'],
          additionalProperties: false,
        },
      },
      netTotal: { type: ['number', 'null'] },
      vatTotal: { type: ['number', 'null'] },
      grossTotal: { type: ['number', 'null'] },
      confidence: { type: 'number', description: '0 to 1' },
    },
    required: [
      'supplierName', 'supplierAddress', 'supplierRegNumber', 'supplierVatNumber',
      'supplierBankAccount', 'invoiceNumber', 'invoiceDate', 'dueDate', 'currency',
      'purchaseOrderNr', 'referenceNumber', 'penaltyRate', 'paymentTerms',
      'deliveryDate', 'deliveryMethod', 'deliveryNoteNr', 'buyerReference',
      'sellerReference', 'lines', 'netTotal', 'vatTotal', 'grossTotal', 'confidence',
    ],
    additionalProperties: false,
  },
};

// ── Extraction Prompt ──
const EXTRACTION_PROMPT = `You are an invoice data extraction system. Extract all fields from the invoice image/document.

IMPORTANT: You are given the actual PDF/image of the invoice. Use the VISUAL layout to correctly identify table columns and their values. Do NOT guess column values from text alone — look at the actual column positions.

LANGUAGE SUPPORT — invoices may be in Estonian, Finnish, English, German, or other languages.

ESTONIAN FIELD MAPPINGS:
  Müüja / Hankija → supplierName
  Reg nr / Registrikood → supplierRegNumber
  KMKR nr → supplierVatNumber
  Pangakonto / IBAN → supplierBankAccount
  Arve nr → invoiceNumber
  Kuupäev / Arve kuupäev → invoiceDate
  Tähtaeg / Maksetähtaeg → dueDate
  Makseviis / Makseaeg → paymentTerms
  Viivis %p. → penaltyRate
  Viitenumber → referenceNumber
  Tarnepäev → deliveryDate
  Tarneviis → deliveryMethod
  Meie viide → buyerReference
  Teie viide → sellerReference
  Saatelehe nr → deliveryNoteNr
  Tootekood / Kood → productCode
  Tootenimi / Nimetus → description
  Hind km-ta → unitPrice (price WITHOUT VAT per unit)
  Tk / Kogus / Kgk → qty (QUANTITY — this is ALWAYS a count/amount)
  Ühik → unit
  Kokku (in line) → net (line total without VAT)
  Kokku käibemaksuta → netTotal
  Km / KM → vatTotal (VAT amount)
  Km % → vatRate
  Kokku / Kokku tasuda → grossTotal
  Tellimuse nr → purchaseOrderNr

FINNISH FIELD MAPPINGS:
  Myyjä / Toimittaja → supplierName
  Laskun numero → invoiceNumber
  Laskun päivä → invoiceDate
  Eräpäivä → dueDate
  Viite → referenceNumber
  Tuotekoodi → productCode
  Tuotenimi → description
  Yksikköhinta → unitPrice
  Määrä → qty
  Yhteensä ilman ALV → netTotal
  ALV → vatTotal
  Yhteensä → grossTotal

CRITICAL NUMBER FORMAT RULES:
- European invoices use COMMA as decimal separator: "120,00" means 120.00, NOT 12000
- "240,00 €" = 240.00 in JSON
- "52,80 €" = 52.80 in JSON
- "1 234,56" = 1234.56 (space is thousands separator, comma is decimal)
- ALWAYS return numbers with DOT decimal in JSON (never comma)
- Strip currency symbols (€, $) — return pure numbers

TABLE READING — CRITICAL:
- Read each column value by its VISUAL POSITION under the column header. Do NOT merge adjacent values.
- The LAST numeric column on each line row (often labeled "total", "kokku", "summa") is the line total → use it for "net".
- "net" for a line = the line total column value from the document. This is the MOST RELIABLE value.
- For "qty", read ONLY the value directly under the quantity column header. Common quantities are 1, 2, 3, etc.
- For "unitPrice", read ONLY the value directly under the unit price / net price column header.
- If the invoice has a "pos." or position column, those are supplier position numbers, NOT row sequential numbers.
- Multi-order invoices may have "order no." header rows separating groups — these are NOT product lines, skip them.

MATH CROSS-CHECKS — verify before returning:
- Each line: qty × unitPrice should approximately equal net. If not, trust "net" (the line total column) and recalculate qty or unitPrice.
- CRITICAL: Sum of all line "net" values MUST equal netTotal. If it doesn't, your line reading is wrong — re-read from the image.
- netTotal + vatTotal should equal grossTotal
- vatAmount for a line = net × (vatRate / 100)

DATE FORMAT:
- Estonian/Finnish/German dates are DD.MM.YYYY → convert to YYYY-MM-DD
- "04.04.2025" → "2025-04-04"

OTHER RULES:
- confidence = 1.0 if all key fields extracted and math checks pass
- If currency not stated but € symbol present, use "EUR"
- "Arve tasumisel kasutage viitenumbrit" = "Use reference number when paying"
- vatRate as percentage number (e.g. 22 for 22%)
- If a field is not present, return null`;

/**
 * Primary extraction: call OpenAI with PDF image + text for structured output.
 * @param {string} invoiceText - extracted PDF text
 * @param {string} filename - original filename for context
 * @param {object} [options] - optional: { previousErrors, previousResponse, pdfBuffer }
 */
async function extract(invoiceText, filename, options = {}) {
  const openai = getClient();
  const model = process.env.OPENAI_MODEL || 'gpt-4o';

  const messages = [
    { role: 'system', content: EXTRACTION_PROMPT },
  ];

  // Build the user message content parts
  const userContentParts = [];

  // Add PDF as base64 image if available (vision mode — GPT-4o can see the actual layout)
  if (options.pdfBuffer) {
    const base64Pdf = options.pdfBuffer.toString('base64');
    userContentParts.push({
      type: 'file',
      file: {
        filename: filename || 'invoice.pdf',
        file_data: `data:application/pdf;base64,${base64Pdf}`,
      },
    });
  }

  // Also include extracted text as supplementary context
  userContentParts.push({
    type: 'text',
    text: `Invoice filename: ${filename}\n\n--- EXTRACTED TEXT (supplementary, may have column alignment issues) ---\n${invoiceText}`,
  });

  // On retry, include the previous errors so the model can self-correct
  if (options.previousErrors && options.previousErrors.length > 0) {
    messages.push({ role: 'user', content: userContentParts });
    messages.push({
      role: 'assistant',
      content: options.previousResponse || '(previous extraction had errors)',
    });
    messages.push({
      role: 'user',
      content: `Your previous extraction had these errors:\n${options.previousErrors.map(e => `- ${e}`).join('\n')}\n\nPlease re-extract the invoice carefully from the PDF image. Pay special attention to:\n- Read each table column VISUALLY — do not merge adjacent column values\n- The line total column is the most reliable source for "net"\n- Verify: sum of all line net values = netTotal\n- European number format: comma (,) is decimal separator, NOT thousands`,
    });
  } else {
    messages.push({ role: 'user', content: userContentParts });
  }

  const completion = await openai.chat.completions.create({
    model,
    messages,
    temperature: 0,
    response_format: {
      type: 'json_schema',
      json_schema: INVOICE_SCHEMA,
    },
  });

  const rawJson = completion.choices[0].message.content;
  const parsed = JSON.parse(rawJson);

  return {
    ...parsed,
    extractedBy: 'openai',
    model,
    rawResponse: rawJson,
  };
}

module.exports = { extract };
