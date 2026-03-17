const OpenAI = require('openai');
const { PDFDocument } = require('pdf-lib');

let client;
function getClient() {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
    client = new OpenAI({ apiKey });
  }
  return client;
}

// Max pages to send as visual input (page 1 + last page if different)
const MAX_VISUAL_PAGES = 3;

/**
 * Extract key pages from PDF for visual input to GPT-4o.
 * For small PDFs (≤ MAX_VISUAL_PAGES): send full PDF.
 * For larger PDFs: extract page 1 (header/columns) + last page (totals) into a smaller PDF.
 */
async function extractKeyPages(pdfBuffer) {
  try {
    const srcDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const totalPages = srcDoc.getPageCount();

    if (totalPages <= MAX_VISUAL_PAGES) {
      // Small PDF — send as-is
      return { buffer: pdfBuffer, totalPages, sentPages: totalPages };
    }

    // Large PDF — extract page 1 + last page
    const newDoc = await PDFDocument.create();
    const pagesToCopy = [0]; // always page 1
    if (totalPages > 1) {
      pagesToCopy.push(totalPages - 1); // last page (totals)
    }

    const copiedPages = await newDoc.copyPages(srcDoc, pagesToCopy);
    for (const page of copiedPages) {
      newDoc.addPage(page);
    }

    const newBuffer = Buffer.from(await newDoc.save());
    return { buffer: newBuffer, totalPages, sentPages: pagesToCopy.length };
  } catch (err) {
    // If page extraction fails, send full PDF as fallback
    return { buffer: pdfBuffer, totalPages: null, sentPages: null, error: err.message };
  }
}

// ── Strict JSON Schema for OpenAI Structured Outputs ──
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
const EXTRACTION_PROMPT = `You are an invoice data extraction system. Extract all fields from the invoice.

You are given:
1. The PDF image of the invoice (page 1 for column layout + last page for totals). Use these to VISUALLY identify table columns and read values by their column position.
2. The full extracted text from ALL pages (may have column alignment issues — use the PDF image to resolve ambiguities).

IMPORTANT: For table data, ALWAYS prefer reading from the PDF image over the extracted text. The text extraction often merges adjacent column values incorrectly.

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
- "1 234,56" = 1234.56 (space is thousands separator, comma is decimal)
- ALWAYS return numbers with DOT decimal in JSON (never comma)
- Strip currency symbols (€, $) — return pure numbers

TABLE READING — CRITICAL:
- Look at the PDF image to identify the exact column layout (headers and positions).
- Read each column value by its VISUAL POSITION under the column header. Do NOT merge adjacent values.
- The LAST numeric column on each line (often "total", "kokku", "summa") is the line total → use it for "net".
- "net" for a line = the line total column value. This is the MOST RELIABLE value.
- For "qty", read ONLY the value directly under the quantity column. Quantities can be multi-digit (1, 2, 10, 25, 100, etc.).
- COMMON ERROR: The last digit(s) of "qty" get merged with the first digit(s) of "unitPrice".
  Example: qty=25, price=8,47 gets misread as qty=2, price=58,47. ALWAYS verify: qty × unitPrice ≈ net (line total).
  If it doesn't match, re-read qty and unitPrice carefully from the PDF image.
- For "unitPrice", read ONLY the value directly under the unit price column. unitPrice is the price PER SINGLE UNIT, NOT the line total.
  COMMON ERROR: Reading the line total (net) into the unitPrice field. unitPrice should NEVER equal net unless qty=1. If unitPrice = net and qty > 1, you read the wrong column.
- If the invoice has a "pos." or position number column, those are supplier internal numbers, NOT row counts.
- Multi-order invoices may have "order no." separator rows — these are NOT product lines, skip them.

MATH CROSS-CHECKS — verify before returning:
- Each line: qty × unitPrice should approximately equal net. If not, trust "net" (the line total column) and back-calculate qty = net / unitPrice.
- CRITICAL: Sum of all line "net" values MUST equal netTotal. If it doesn't, re-read lines from the PDF image.
- netTotal + vatTotal should equal grossTotal
- vatAmount for a line = net × (vatRate / 100)

DATE FORMAT:
- Estonian/Finnish/German dates are DD.MM.YYYY → convert to YYYY-MM-DD

OTHER RULES:
- confidence = 1.0 if all key fields extracted and math checks pass
- If currency not stated but € symbol present, use "EUR"
- vatRate as percentage number (e.g. 22 for 22%)
- If a field is not present, return null`;

/**
 * Primary extraction: call OpenAI with PDF visual input + text for structured output.
 * Sends only key pages (page 1 + last page) as PDF to save cost/time on large documents.
 * Full text from all pages is included as supplementary context.
 *
 * @param {string} invoiceText - extracted PDF text (all pages)
 * @param {string} filename - original filename for context
 * @param {object} [options] - optional: { previousErrors, previousResponse, pdfBuffer }
 */
async function extract(invoiceText, filename, options = {}) {
  const openai = getClient();
  const model = options.model || process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const messages = [
    { role: 'system', content: EXTRACTION_PROMPT },
  ];

  // Build the user message content parts
  const userContentParts = [];

  // Add PDF visual input (key pages only for cost efficiency)
  if (options.pdfBuffer) {
    const { buffer: visualPdf, totalPages, sentPages } = await extractKeyPages(options.pdfBuffer);
    const base64Pdf = visualPdf.toString('base64');
    userContentParts.push({
      type: 'file',
      file: {
        filename: filename || 'invoice.pdf',
        file_data: `data:application/pdf;base64,${base64Pdf}`,
      },
    });

    // Tell the model about the page selection
    if (totalPages && totalPages > MAX_VISUAL_PAGES) {
      userContentParts.push({
        type: 'text',
        text: `NOTE: This invoice has ${totalPages} pages. The PDF above shows only page 1 (header + column layout) and page ${totalPages} (totals). The FULL text from all ${totalPages} pages is provided below — use it for line items on middle pages, but use the PDF image to understand the column layout.`,
      });
    }
  }

  // Include full extracted text from all pages
  userContentParts.push({
    type: 'text',
    text: `Invoice filename: ${filename}\n\n--- FULL EXTRACTED TEXT (all pages) ---\n${invoiceText}`,
  });

  // Inject supplier-specific extraction context (instructions + sample results)
  if (options.supplierContext) {
    const ctx = options.supplierContext;
    let contextText = '';
    if (ctx.instructions) {
      contextText += `\n\n--- SUPPLIER-SPECIFIC INSTRUCTIONS ---\nThe following are custom instructions for this supplier's invoices. Follow them carefully:\n${ctx.instructions}`;
    }
    if (ctx.samples && ctx.samples.length > 0) {
      contextText += '\n\n--- REFERENCE EXTRACTION (correct example from previous invoice by this supplier) ---\n';
      contextText += 'Use this as a guide for the expected output format, field values, and line structure:\n';
      // Include up to 2 samples, but trim lines to keep token usage reasonable
      for (let si = 0; si < Math.min(ctx.samples.length, 2); si++) {
        const sample = { ...ctx.samples[si] };
        // Keep only first 5 lines as reference to save tokens
        if (sample.lines && sample.lines.length > 5) {
          sample.lines = sample.lines.slice(0, 5);
          sample._note = `Showing first 5 of ${ctx.samples[si].lines.length} lines`;
        }
        contextText += `\nExample ${si + 1}:\n${JSON.stringify(sample, null, 2)}`;
      }
    }
    if (contextText) {
      userContentParts.push({ type: 'text', text: contextText });
    }
  }

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

/**
 * Analyze a successfully-extracted invoice PDF and generate extraction instructions
 * for future invoices from the same supplier. Called when a supplier has no instructions yet.
 *
 * @param {Buffer} pdfBuffer - the invoice PDF
 * @param {string} filename - original filename
 * @param {object} extractedData - the successfully extracted invoice data (used as reference)
 * @returns {string} generated extraction instructions text
 */
async function generateExtractionInstructions(pdfBuffer, filename, extractedData) {
  const openai = getClient();
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const userContentParts = [];

  // Send page 1 as visual input (layout reference)
  if (pdfBuffer) {
    const { buffer: visualPdf } = await extractKeyPages(pdfBuffer);
    const base64Pdf = visualPdf.toString('base64');
    userContentParts.push({
      type: 'file',
      file: {
        filename: filename || 'invoice.pdf',
        file_data: `data:application/pdf;base64,${base64Pdf}`,
      },
    });
  }

  // Include the successful extraction result as reference
  const trimmedData = { ...extractedData };
  delete trimmedData.rawResponse;
  delete trimmedData.extractedBy;
  delete trimmedData.model;
  if (trimmedData.lines && trimmedData.lines.length > 3) {
    trimmedData.lines = trimmedData.lines.slice(0, 3);
    trimmedData._note = 'Showing first 3 lines only';
  }

  userContentParts.push({
    type: 'text',
    text: `Analyze this invoice PDF layout and generate extraction instructions for future invoices from the same supplier.

Here is the correct extraction result for this invoice (reference):
${JSON.stringify(trimmedData, null, 2)}

Based on the PDF visual layout, describe:
1. The table column layout — list each column header (in the original language) and what field it maps to (e.g., "Kgk" → qty, "Hind km-ta" → unitPrice)
2. The column order from left to right
3. Any quirks or special formatting (e.g., position numbers in first column that are NOT row counts, order separator rows, merged cells)
4. Number format used (comma decimal, space thousands separator, etc.)
5. Where totals are located (bottom of table, separate section, etc.)
6. Any fields that might be easily confused or misread

Write the instructions as concise, actionable notes that will be injected into an AI extraction prompt. Use short bullet points. Keep it under 500 characters. Do NOT include generic advice — only supplier-specific observations from this invoice layout.`,
  });

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: 'You are an invoice analysis assistant. Generate concise extraction instructions based on the invoice PDF layout. Output ONLY the instructions text, no preamble.' },
      { role: 'user', content: userContentParts },
    ],
    temperature: 0,
    max_tokens: 300,
  });

  return (completion.choices[0].message.content || '').trim();
}

module.exports = { extract, generateExtractionInstructions };
