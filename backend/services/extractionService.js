const crypto = require('crypto');
const pdfParse = require('pdf-parse');
const { query } = require('../db');
const openaiExtractor = require('./openaiExtractor');
const costpocketExtractor = require('./costpocketExtractor');
const { validate, verifyTotalAgainstPdfText } = require('./validationService');
const { findSupplier, lookupFutursoftSupplierNr, quickMatchSupplierFromText, getExtractionContext } = require('./supplierService');

const MIN_CONFIDENCE = 0.6; // below this, try CostPocket fallback
const TOLERANCE = 0.02; // 2 cent tolerance for rounding

async function addLog(invoiceId, step, level, message, payload) {
  try {
    await query(
      `INSERT INTO processing_logs (id, invoice_id, step, level, message, payload)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        invoiceId,
        step,
        level,
        message,
        payload != null ? JSON.stringify(payload) : null,
      ]
    );
  } catch {
    // non-fatal
  }
}

async function updateInvoiceStatus(invoiceId, status, errorMessage) {
  if (errorMessage != null) {
    await query(
      'UPDATE invoices SET status = ?, error_message = ? WHERE id = ?',
      [status, errorMessage, invoiceId]
    );
  } else {
    await query('UPDATE invoices SET status = ? WHERE id = ?', [status, invoiceId]);
  }
}

// ── Math Auto-Correction ──
// Detects and fixes common extraction errors (factor-of-10 mistakes, missing calculations)

function approxEqual(a, b) {
  if (a == null || b == null) return true;
  return Math.abs(Number(a) - Number(b)) <= TOLERANCE;
}

/**
 * Try to un-concatenate leading digits of unitPrice back onto qty.
 * Common OCR error: qty "25" + price "8.47" → qty=2, price=58.47 (the "5" migrated).
 * Returns array of candidate { qty, unitPrice } pairs.
 */
function tryUnconcatPrice(qty, unitPrice) {
  const candidates = [];
  const intPart = Math.floor(Math.abs(unitPrice));
  const fracPart = Math.round((Math.abs(unitPrice) - intPart) * 10000) / 10000;
  const intStr = String(intPart);

  for (let d = 1; d <= Math.min(2, intStr.length - 1); d++) {
    const movedDigits = intStr.substring(0, d);
    const remainingInt = intStr.substring(d);
    if (remainingInt === '') continue;
    const newQty = Number(String(Math.round(qty)) + movedDigits);
    const newUnitPrice = Math.round((Number(remainingInt) + fracPart) * 10000) / 10000;
    if (newUnitPrice > 0) {
      candidates.push({ qty: newQty, unitPrice: newUnitPrice });
    }
  }
  return candidates;
}

/**
 * Verify and correct extracted line values against raw PDF text.
 * PDF text is ground truth — if we find the product code in the text,
 * we can extract nearby numbers and verify qty/unitPrice/net.
 */
function verifyLinesFromPdfText(extracted, pdfText) {
  if (!pdfText || !extracted.lines || extracted.lines.length === 0) return [];
  const corrections = [];

  // Split PDF text into lines and normalize
  const textLines = pdfText.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);

  for (let i = 0; i < extracted.lines.length; i++) {
    const line = extracted.lines[i];
    const net = line.net != null ? Number(line.net) : null;
    const qty = line.qty != null ? Number(line.qty) : null;
    const unitPrice = line.unitPrice != null ? Number(line.unitPrice) : null;
    if (net == null || net === 0) continue;

    // Find this line in PDF text by product code or description
    const searchTerms = [];
    if (line.productCode && line.productCode.length >= 3) searchTerms.push(line.productCode);
    if (line.description && line.description.length >= 5) {
      // Use first significant word of description (safest for regex)
      const words = line.description.split(/\s+/).filter(w => w.length >= 3);
      if (words.length > 0) searchTerms.push(words[0]);
    }

    let matchedTextLine = null;
    for (const term of searchTerms) {
      try {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, 'i');
        for (const tl of textLines) {
          if (regex.test(tl)) {
            matchedTextLine = tl;
            break;
          }
        }
      } catch { /* skip bad regex */ }
      if (matchedTextLine) break;
    }

    if (!matchedTextLine) continue;

    // Extract all numbers from the matched text line
    // Handles European format: "25" "8,47" "211,75" and also "8.47" "211.75"
    const numberMatches = [];
    const numRegex = /(\d[\d\s]*(?:[.,]\d+)?)/g;
    let m;
    while ((m = numRegex.exec(matchedTextLine)) !== null) {
      const raw = m[1].replace(/\s/g, ''); // remove space thousands separators
      const normalized = raw.replace(',', '.'); // European decimal comma → dot
      const val = parseFloat(normalized);
      if (!isNaN(val) && val > 0) {
        numberMatches.push(val);
      }
    }

    if (numberMatches.length < 2) continue;

    // Check if our extracted qty and unitPrice are present in PDF text numbers
    const qtyInText = qty != null && numberMatches.some(n => approxEqual(n, qty));
    const priceInText = unitPrice != null && numberMatches.some(n => approxEqual(n, unitPrice));

    // If both are found in the text, values are likely correct
    if (qtyInText && priceInText) continue;

    // Try to find the correct qty/unitPrice pair from PDF text numbers
    // Look for two numbers where a × b ≈ net
    let bestFix = null;

    for (let a = 0; a < numberMatches.length; a++) {
      for (let b = a + 1; b < numberMatches.length; b++) {
        const n1 = numberMatches[a];
        const n2 = numberMatches[b];

        // Skip if either number IS the net (we want qty and unitPrice, not net itself)
        if (approxEqual(n1, net) || approxEqual(n2, net)) continue;

        // Try both orderings: (n1=qty, n2=price) and (n2=qty, n1=price)
        if (approxEqual(n1 * n2, net)) {
          // Prefer integer as qty
          if (Number.isInteger(n1)) {
            bestFix = { qty: n1, unitPrice: n2 };
          } else if (Number.isInteger(n2)) {
            bestFix = { qty: n2, unitPrice: n1 };
          } else {
            // Both have decimals — pick the smaller as unitPrice
            bestFix = n1 > n2 ? { qty: n1, unitPrice: n2 } : { qty: n2, unitPrice: n1 };
          }
          break;
        }
      }
      if (bestFix) break;
    }

    if (bestFix && (!approxEqual(bestFix.qty, qty) || !approxEqual(bestFix.unitPrice, unitPrice))) {
      corrections.push(
        `Line ${i + 1}: PDF text fix: qty ${qty} → ${bestFix.qty}, unitPrice ${unitPrice} → ${bestFix.unitPrice} (${bestFix.qty} × ${bestFix.unitPrice} ≈ net ${net})`
      );
      line.qty = bestFix.qty;
      line.unitPrice = bestFix.unitPrice;
    }
  }

  return corrections;
}

function correctExtractedMath(extracted) {
  const corrections = [];
  const lines = extracted.lines || [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const qty = line.qty != null ? Number(line.qty) : null;
    const unitPrice = line.unitPrice != null ? Number(line.unitPrice) : null;
    const net = line.net != null ? Number(line.net) : null;

    if (qty != null && unitPrice != null && net != null) {
      const expected = qty * unitPrice;
      if (!approxEqual(expected, net)) {
        let fixed = false;

        // 0) Check if unitPrice was read from the net column (unitPrice ≈ net)
        //    E.g. qty=3, unitPrice=30.66, net=30.66 → should be qty=2, unitPrice=15.33, net=30.66
        //    or qty=2, unitPrice=30.66, net=30.66 → unitPrice should be net/qty = 15.33
        if (approxEqual(unitPrice, net) && qty > 0) {
          const correctUnitPrice = Math.round((net / qty) * 10000) / 10000;
          if (correctUnitPrice > 0 && !approxEqual(correctUnitPrice, unitPrice)) {
            corrections.push(`Line ${i + 1}: unitPrice was same as net (column confusion): unitPrice ${unitPrice} → ${correctUnitPrice} (net ${net} / qty ${qty})`);
            line.unitPrice = correctUnitPrice;
            fixed = true;
          }
        }

        // 1) Try column un-concatenation: move digits from unitPrice back to qty
        //    E.g. qty=2, unitPrice=58.47, net=211.75 → qty=25, unitPrice=8.47 (25×8.47=211.75)
        if (!fixed && qty > 0) {
          const uncatCandidates = tryUnconcatPrice(qty, unitPrice);
          for (const c of uncatCandidates) {
            if (approxEqual(c.qty * c.unitPrice, net)) {
              corrections.push(`Line ${i + 1}: column uncat fix: qty ${qty} → ${c.qty}, unitPrice ${unitPrice} → ${c.unitPrice} (${c.qty} × ${c.unitPrice} ≈ net ${net})`);
              line.qty = c.qty;
              line.unitPrice = c.unitPrice;
              fixed = true;
              break;
            }
          }
        }

        if (!fixed) {
          // 2) Check if net is off by a factor of 10 or 100 (European decimal confusion)
          for (const factor of [10, 100]) {
            if (approxEqual(expected, net / factor)) {
              corrections.push(`Line ${i + 1}: net ${net} → ${net / factor} (was ${factor}× too high, expected qty ${qty} × unitPrice ${unitPrice} = ${expected})`);
              line.net = Number((net / factor).toFixed(2));
              fixed = true;
              break;
            }
            if (approxEqual(expected * factor, net)) {
              if (approxEqual(qty * (unitPrice / factor), net)) {
                corrections.push(`Line ${i + 1}: unitPrice ${unitPrice} → ${unitPrice / factor} (was ${factor}× too high)`);
                line.unitPrice = Number((unitPrice / factor).toFixed(2));
                fixed = true;
                break;
              }
            }
          }
        }

        if (!fixed) {
          // 3) Last resort: recalculate net from qty × unitPrice
          const recalcNet = qty * (line.unitPrice != null ? Number(line.unitPrice) : unitPrice);
          if (!approxEqual(recalcNet, Number(line.net))) {
            corrections.push(`Line ${i + 1}: recalculated net from qty × unitPrice: ${Number(line.net)} → ${recalcNet.toFixed(2)}`);
            line.net = Number(recalcNet.toFixed(2));
          }
        }
      }
    }

    // Calculate missing qty from net and unitPrice: qty = net / unitPrice
    if (line.qty == null && line.net != null && line.unitPrice != null && Number(line.unitPrice) !== 0) {
      const calcQty = Number(line.net) / Number(line.unitPrice);
      const rounded = Math.round(calcQty * 1000) / 1000;
      if (approxEqual(rounded * Number(line.unitPrice), Number(line.net))) {
        line.qty = rounded;
        corrections.push(`Line ${i + 1}: calculated qty = ${line.qty} (net ${line.net} / unitPrice ${line.unitPrice})`);
      }
    }

    // Calculate missing vatAmount from net and vatRate
    if (line.net != null && line.vatRate != null && line.vatAmount == null) {
      const calcVat = Number(line.net) * (Number(line.vatRate) / 100);
      line.vatAmount = Number(calcVat.toFixed(2));
      corrections.push(`Line ${i + 1}: calculated vatAmount = ${line.vatAmount}`);
    }

    // Calculate missing gross from net + vatAmount
    if (line.net != null && line.vatAmount != null && line.gross == null) {
      line.gross = Number((Number(line.net) + Number(line.vatAmount)).toFixed(2));
      corrections.push(`Line ${i + 1}: calculated gross = ${line.gross}`);
    }
  }

  // Cross-check: compare sum of line nets against invoice netTotal (ground truth).
  // Catches column-concat errors that are internally consistent (qty × unitPrice = net)
  // but produce wrong totals. E.g. qty=2, price=58.47, net=116.94 but should be qty=25, price=8.47, net=211.75.
  if (lines.length > 0 && extracted.netTotal != null) {
    const linesSum = lines.reduce((s, l) => s + Number(l.net || 0), 0);
    const headerNet = Number(extracted.netTotal);

    if (!approxEqual(linesSum, headerNet) && headerNet > 0) {
      // Try fixing column-concatenation errors using un-concat approach.
      // For each line, generate candidate fixes and find the combination closest to headerNet.
      const lineFixes = []; // { idx, oldQty, oldPrice, oldNet, newQty, newPrice, newNet }

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const qty = line.qty != null ? Number(line.qty) : null;
        const unitPrice = line.unitPrice != null ? Number(line.unitPrice) : null;

        if (qty == null || unitPrice == null || qty <= 0) continue;

        // Skip lines that are already internally consistent — don't break correct lines
        const net = line.net != null ? Number(line.net) : null;
        if (net != null && approxEqual(qty * unitPrice, net)) continue;

        const uncatCandidates = tryUnconcatPrice(qty, unitPrice);
        for (const c of uncatCandidates) {
          const newNet = Math.round(c.qty * c.unitPrice * 100) / 100;
          const oldNet = Number(line.net || 0);
          const delta = newNet - oldNet;
          // Check if this fix brings total closer to headerNet
          if (Math.abs(linesSum + delta - headerNet) < Math.abs(linesSum - headerNet)) {
            lineFixes.push({ idx: i, oldQty: qty, oldPrice: unitPrice, oldNet, newQty: c.qty, newPrice: c.unitPrice, newNet, delta });
          }
        }
      }

      // Apply fixes greedily (each one that brings sum closer to headerNet)
      if (lineFixes.length > 0) {
        // Sort by how much each fix improves the total
        lineFixes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
        let currentSum = linesSum;
        const applied = new Set();

        for (const fix of lineFixes) {
          if (applied.has(fix.idx)) continue;
          const newSum = currentSum + fix.delta;
          if (Math.abs(newSum - headerNet) < Math.abs(currentSum - headerNet)) {
            const line = lines[fix.idx];
            line.qty = fix.newQty;
            line.unitPrice = fix.newPrice;
            line.net = fix.newNet;
            corrections.push(
              `Line ${fix.idx + 1}: column uncat fix (total cross-check): qty ${fix.oldQty} → ${fix.newQty}, unitPrice ${fix.oldPrice} → ${fix.newPrice}, net ${fix.oldNet} → ${fix.newNet}`
            );
            currentSum = newSum;
            applied.add(fix.idx);
          }
        }

        if (applied.size > 0) {
          corrections.push(`Line sum fixed: ${linesSum.toFixed(2)} → ${currentSum.toFixed(2)} (header netTotal = ${headerNet})`);
        }
      }
    }
  }

  // Recalculate header totals from lines if they don't match.
  // IMPORTANT: trust the header netTotal from the invoice over line sums,
  // unless netTotal is null or the lines sum is very close (rounding).
  if (lines.length > 0) {
    const linesNetSum = lines.reduce((s, l) => s + Number(l.net || 0), 0);
    const linesVatSum = lines.reduce((s, l) => s + Number(l.vatAmount || 0), 0);

    if (extracted.netTotal != null && !approxEqual(linesNetSum, extracted.netTotal)) {
      // Check if netTotal is off by factor of 10/100
      for (const factor of [10, 100]) {
        if (approxEqual(linesNetSum, Number(extracted.netTotal) / factor)) {
          corrections.push(`netTotal ${extracted.netTotal} → ${Number(extracted.netTotal) / factor} (was ${factor}× too high, lines sum = ${linesNetSum.toFixed(2)})`);
          extracted.netTotal = Number((Number(extracted.netTotal) / factor).toFixed(2));
          break;
        }
      }
    }

    // Only override netTotal with line sums if netTotal is null, or if lines sum is
    // LOWER than netTotal (meaning netTotal was inflated, not the lines).
    // If lines sum is higher, the header total is more trustworthy (printed on invoice).
    if (extracted.netTotal == null) {
      extracted.netTotal = Number(linesNetSum.toFixed(2));
      corrections.push(`netTotal derived from lines: ${extracted.netTotal}`);
    } else if (!approxEqual(linesNetSum, extracted.netTotal) && linesNetSum < Number(extracted.netTotal)) {
      corrections.push(`netTotal ${extracted.netTotal} → ${linesNetSum.toFixed(2)} (lines sum is lower, likely more accurate)`);
      extracted.netTotal = Number(linesNetSum.toFixed(2));
    }

    if (extracted.vatTotal == null && linesVatSum > 0) {
      extracted.vatTotal = Number(linesVatSum.toFixed(2));
      corrections.push(`vatTotal calculated from lines: ${extracted.vatTotal}`);
    }

    // Verify grossTotal = netTotal + vatTotal
    if (extracted.netTotal != null && extracted.vatTotal != null) {
      const expectedGross = Number(extracted.netTotal) + Number(extracted.vatTotal);
      if (extracted.grossTotal == null || !approxEqual(expectedGross, extracted.grossTotal)) {
        if (extracted.grossTotal != null) {
          corrections.push(`grossTotal ${extracted.grossTotal} → ${expectedGross.toFixed(2)} (netTotal + vatTotal)`);
        }
        extracted.grossTotal = Number(expectedGross.toFixed(2));
      }
    }
  }

  return corrections;
}

async function saveExtractedData(invoiceId, extracted) {
  // Update invoice header
  await query(
    `UPDATE invoices SET
       supplier_name = COALESCE(?, supplier_name),
       supplier_address = COALESCE(?, supplier_address),
       supplier_vat_number = COALESCE(?, supplier_vat_number),
       supplier_reg_number = COALESCE(?, supplier_reg_number),
       supplier_bank_account = COALESCE(?, supplier_bank_account),
       invoice_number = COALESCE(?, invoice_number),
       invoice_date = COALESCE(?, invoice_date),
       due_date = COALESCE(?, due_date),
       currency = COALESCE(?, currency),
       net_total = COALESCE(?, net_total),
       vat_total = COALESCE(?, vat_total),
       gross_total = COALESCE(?, gross_total),
       purchase_order_nr = COALESCE(?, purchase_order_nr),
       reference_number = COALESCE(?, reference_number),
       penalty_rate = COALESCE(?, penalty_rate),
       payment_terms = COALESCE(?, payment_terms),
       delivery_date = COALESCE(?, delivery_date),
       delivery_method = COALESCE(?, delivery_method),
       delivery_note_nr = COALESCE(?, delivery_note_nr),
       buyer_reference = COALESCE(?, buyer_reference),
       seller_reference = COALESCE(?, seller_reference)
     WHERE id = ?`,
    [
      extracted.supplierName || null,
      extracted.supplierAddress || null,
      extracted.supplierVatNumber || null,
      extracted.supplierRegNumber || null,
      extracted.supplierBankAccount || null,
      extracted.invoiceNumber || null,
      extracted.invoiceDate || null,
      extracted.dueDate || null,
      extracted.currency || null,
      extracted.netTotal != null ? extracted.netTotal : null,
      extracted.vatTotal != null ? extracted.vatTotal : null,
      extracted.grossTotal != null ? extracted.grossTotal : null,
      extracted.purchaseOrderNr || null,
      extracted.referenceNumber || null,
      extracted.penaltyRate || null,
      extracted.paymentTerms || null,
      extracted.deliveryDate || null,
      extracted.deliveryMethod || null,
      extracted.deliveryNoteNr || null,
      extracted.buyerReference || null,
      extracted.sellerReference || null,
      invoiceId,
    ]
  );

  // Insert invoice lines (re-number sequentially to avoid duplicate rowNo from extraction)
  if (Array.isArray(extracted.lines) && extracted.lines.length > 0) {
    await query('DELETE FROM invoice_lines WHERE invoice_id = ?', [invoiceId]);
    for (let i = 0; i < extracted.lines.length; i++) {
      const line = extracted.lines[i];
      await query(
        `INSERT INTO invoice_lines (id, invoice_id, row_no, product_code, description,
           qty, unit, unit_price, net, vat_rate, vat_amount, gross, raw)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          invoiceId,
          i + 1,
          line.productCode || null,
          line.description || null,
          line.qty != null ? line.qty : null,
          line.unit || null,
          line.unitPrice != null ? line.unitPrice : null,
          line.net != null ? line.net : null,
          line.vatRate != null ? line.vatRate : null,
          line.vatAmount != null ? line.vatAmount : null,
          line.gross != null ? line.gross : null,
          '{}',
        ]
      );
    }
  }
}

/**
 * Main extraction pipeline. Called after file upload.
 * Runs asynchronously — does not block the HTTP response.
 */
async function processInvoice(invoiceId, pdfBuffer, filename, session) {
  const extractionStart = Date.now();
  try {
    await updateInvoiceStatus(invoiceId, 'processing');
    await addLog(invoiceId, 'processing_start', 'info', 'Started processing', { filename });

    // Step 1: Extract text from PDF
    let pdfText = '';
    let hasTextLayer = false;
    try {
      const parsed = await pdfParse(pdfBuffer);
      pdfText = (parsed.text || '').trim();
      hasTextLayer = pdfText.length > 50; // at least 50 chars of real text
      await addLog(invoiceId, 'pdf_parse', 'info', `PDF parsed: ${parsed.numpages} pages, text layer: ${hasTextLayer}`, {
        pages: parsed.numpages,
        textLength: pdfText.length,
      });
    } catch (err) {
      await addLog(invoiceId, 'pdf_parse', 'warn', `PDF text extraction failed: ${err.message}`, null);
    }

    const textForOpenAI = hasTextLayer
      ? pdfText
      : `[This invoice is a scanned image. Filename: ${filename}]`;

    // Step 1b: Early supplier matching from PDF text — for supplier-specific extraction context
    let supplierContext = null;
    let earlyMatchedSupplier = null;
    try {
      const invoiceRow = await query('SELECT tenant_id FROM invoices WHERE id = ? LIMIT 1', [invoiceId]);
      if (invoiceRow[0] && pdfText) {
        earlyMatchedSupplier = await quickMatchSupplierFromText(invoiceRow[0].tenant_id, pdfText);
        if (earlyMatchedSupplier) {
          supplierContext = await getExtractionContext(earlyMatchedSupplier.id);
          if (supplierContext) {
            await addLog(invoiceId, 'supplier_context', 'info',
              `Matched supplier "${earlyMatchedSupplier.name}" from PDF text — injecting extraction context (instructions: ${supplierContext.instructions ? 'yes' : 'no'}, samples: ${supplierContext.samples.length})`,
              { supplierId: earlyMatchedSupplier.id }
            );
          } else {
            await addLog(invoiceId, 'supplier_context', 'info',
              `Matched supplier "${earlyMatchedSupplier.name}" from PDF text — no extraction context configured`, null
            );
          }
        }
      }
    } catch (ctxErr) {
      await addLog(invoiceId, 'supplier_context', 'warn', `Early supplier match failed: ${ctxErr.message}`, null);
    }

    // Step 2: Primary extraction with OpenAI
    // First try uses OPENAI_MODEL (default: gpt-4o-mini, cheaper/faster).
    // Retry on math errors uses OPENAI_RETRY_MODEL (default: gpt-4o, more capable).
    let extracted = null;
    let usedFallback = false;
    let usedRetry = false;
    let finalModel = null;
    let totalMathCorrections = 0;
    const primaryModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const retryModel = process.env.OPENAI_RETRY_MODEL || 'gpt-4o';

    if (process.env.OPENAI_API_KEY) {
      try {
        await addLog(invoiceId, 'extraction_openai', 'info', `Starting OpenAI extraction with ${primaryModel} (vision + structured output)`, null);
        extracted = await openaiExtractor.extract(textForOpenAI, filename, { pdfBuffer, model: primaryModel, supplierContext });
        await addLog(invoiceId, 'extraction_openai', 'info', `OpenAI extraction complete (${extracted.model}), confidence: ${extracted.confidence}`, {
          confidence: extracted.confidence,
          model: extracted.model,
        });

        finalModel = primaryModel;

        // Step 2b: PDF text verification — fix qty/unitPrice from ground truth text
        if (pdfText) {
          const textFixes = verifyLinesFromPdfText(extracted, pdfText);
          if (textFixes.length > 0) {
            totalMathCorrections += textFixes.length;
            await addLog(invoiceId, 'pdf_text_verify', 'warn',
              `Applied ${textFixes.length} PDF text verification fix(es)`,
              { fixes: textFixes }
            );
          }
        }

        // Step 2c: Math auto-correction
        const corrections = correctExtractedMath(extracted);
        totalMathCorrections += corrections.length;
        if (corrections.length > 0) {
          await addLog(invoiceId, 'math_correction', 'warn',
            `Applied ${corrections.length} math correction(s)`,
            { corrections }
          );
        }

        // Step 2c: Validate after correction
        const firstValidation = validate(extracted);
        const mathErrors = firstValidation.issues.filter(i =>
          i.field && (i.field.includes('net') || i.field.includes('vat') || i.field.includes('gross') || i.field.includes('Total'))
        );

        // Step 2d: Retry with more capable model if there are math errors
        if (mathErrors.length > 0) {
          usedRetry = true;
          await addLog(invoiceId, 'extraction_retry', 'info',
            `Retrying with ${retryModel} due to ${mathErrors.length} math error(s)`,
            { errors: mathErrors.map(e => e.message) }
          );

          try {
            const retryResult = await openaiExtractor.extract(textForOpenAI, filename, {
              pdfBuffer,
              model: retryModel,
              previousErrors: mathErrors.map(e => e.message),
              previousResponse: extracted.rawResponse,
              supplierContext,
            });

            // Apply PDF text verification + math correction to retry result too
            if (pdfText) verifyLinesFromPdfText(retryResult, pdfText);
            const retryCorrections = correctExtractedMath(retryResult);
            const retryValidation = validate(retryResult);

            // Use retry result if it has fewer issues
            if (retryValidation.issues.length < firstValidation.issues.length) {
              extracted = retryResult;
              finalModel = retryModel;
              totalMathCorrections = retryCorrections.length;
              await addLog(invoiceId, 'extraction_retry', 'info',
                `Retry with ${retryModel} improved: ${firstValidation.issues.length} → ${retryValidation.issues.length} issue(s)`,
                { corrections: retryCorrections }
              );
            } else {
              await addLog(invoiceId, 'extraction_retry', 'info',
                `Retry with ${retryModel} did not improve results, keeping ${primaryModel} result`, null
              );
            }
          } catch (retryErr) {
            await addLog(invoiceId, 'extraction_retry', 'warn',
              `Retry with ${retryModel} failed: ${retryErr.message}`, null
            );
          }
        }
      } catch (err) {
        await addLog(invoiceId, 'extraction_openai', 'error', `OpenAI extraction failed: ${err.message}`, null);
      }
    } else {
      await addLog(invoiceId, 'extraction_openai', 'warn', 'OpenAI not configured (OPENAI_API_KEY missing), skipping', null);
    }

    // Step 3: CostPocket fallback if OpenAI failed or low confidence
    if (!extracted || extracted.confidence < MIN_CONFIDENCE) {
      const reason = !extracted ? 'OpenAI extraction failed' : `confidence ${extracted.confidence} below threshold`;
      await addLog(invoiceId, 'extraction_costpocket', 'info', `Falling back to CostPocket: ${reason}`, null);

      if (process.env.COSTPOCKET_API_URL && process.env.COSTPOCKET_API_KEY) {
        try {
          const costpocketResult = await costpocketExtractor.extract(pdfBuffer, filename);
          await addLog(invoiceId, 'extraction_costpocket', 'info', 'CostPocket extraction complete', null);
          extracted = costpocketResult;
          usedFallback = true;
        } catch (err) {
          await addLog(invoiceId, 'extraction_costpocket', 'error', `CostPocket extraction failed: ${err.message}`, null);
        }
      } else {
        await addLog(invoiceId, 'extraction_costpocket', 'warn', 'CostPocket not configured, skipping', null);
      }
    }

    if (!extracted) {
      await updateInvoiceStatus(invoiceId, 'failed', 'All extraction methods failed');
      await addLog(invoiceId, 'extraction', 'error', 'All extraction methods failed', null);
      return;
    }

    // Step 4: Final validation
    const validation = validate(extracted);
    if (validation.issues.length > 0) {
      await addLog(invoiceId, 'validation', validation.valid ? 'warn' : 'error',
        `Validation: ${validation.issues.length} issue(s)`,
        { issues: validation.issues }
      );
    } else {
      await addLog(invoiceId, 'validation', 'info', 'Validation passed', null);
    }

    // Step 4b: Verify gross total against raw PDF text (ground truth check)
    let pdfTotalMismatch = false;
    if (pdfText) {
      const pdfVerification = verifyTotalAgainstPdfText(extracted, pdfText);
      if (pdfVerification) {
        if (pdfVerification.verified) {
          await addLog(invoiceId, 'pdf_total_check', 'info', pdfVerification.message, null);
        } else {
          pdfTotalMismatch = true;
          await addLog(invoiceId, 'pdf_total_check', 'warn', pdfVerification.message, {
            extractedGrossTotal: extracted.grossTotal,
            pdfTextTotal: pdfVerification.pdfTotal,
          });
        }
      }
    }

    // Step 5: Save extracted data to DB
    await saveExtractedData(invoiceId, extracted);
    await addLog(invoiceId, 'normalization', 'info', `Saved: ${(extracted.lines || []).length} lines`, {
      extractedBy: extracted.extractedBy,
    });

    // Save extraction statistics
    const modelUsed = finalModel || extracted.model || (usedFallback ? 'costpocket' : null);
    await query(
      'UPDATE invoices SET extraction_model = ?, extraction_retried = ?, math_corrections = ?, extraction_duration_ms = ? WHERE id = ?',
      [modelUsed, usedRetry ? 1 : 0, totalMathCorrections, Date.now() - extractionStart, invoiceId]
    );

    // Step 5b: Link to existing supplier if found (no auto-create during extraction)
    let linkedSupplier = earlyMatchedSupplier || null;
    try {
      const invoiceRow = await query('SELECT tenant_id FROM invoices WHERE id = ? LIMIT 1', [invoiceId]);
      if (invoiceRow[0]) {
        const supplier = await findSupplier(invoiceRow[0].tenant_id, extracted);
        if (supplier) {
          linkedSupplier = supplier;
          await query('UPDATE invoices SET supplier_id = ? WHERE id = ?', [supplier.id, invoiceId]);
          await addLog(invoiceId, 'supplier_link', 'info',
            `Linked to existing supplier: ${supplier.name}`,
            { supplierId: supplier.id, supplierName: supplier.name }
          );
        } else {
          await addLog(invoiceId, 'supplier_link', 'info',
            'No existing supplier matched — will be resolved on approval', null
          );
        }
      }
    } catch (supplierErr) {
      await addLog(invoiceId, 'supplier_link', 'warn', `Supplier lookup failed: ${supplierErr.message}`, null);
    }

    // Step 5c: Auto-generate extraction instructions if supplier has none
    // Fire-and-forget — runs in background, does not block the pipeline
    try {
      const linkedSupplierId = linkedSupplier?.id;
      if (linkedSupplierId && !supplierContext?.instructions && pdfBuffer && process.env.OPENAI_API_KEY) {
        // Check if supplier still has no instructions (may have been set manually)
        const supRow = await query('SELECT extraction_instructions FROM suppliers WHERE id = ? LIMIT 1', [linkedSupplierId]);
        if (supRow[0] && !supRow[0].extraction_instructions) {
          addLog(invoiceId, 'auto_instructions', 'info', `Generating extraction instructions for supplier "${linkedSupplier.name}"`, null);
          openaiExtractor.generateExtractionInstructions(pdfBuffer, filename, extracted)
            .then(async (instructions) => {
              if (instructions && instructions.length > 10) {
                await query('UPDATE suppliers SET extraction_instructions = ? WHERE id = ? AND (extraction_instructions IS NULL OR extraction_instructions = "")', [instructions, linkedSupplierId]);
                await addLog(invoiceId, 'auto_instructions', 'info', `Auto-generated extraction instructions (${instructions.length} chars)`, { instructions });
              }
            })
            .catch(async (err) => {
              await addLog(invoiceId, 'auto_instructions', 'warn', `Failed to auto-generate instructions: ${err.message}`, null).catch(() => {});
            });
        }
      }
    } catch (autoInstrErr) {
      // Non-fatal
    }

    // Step 5d: Lookup Futursoft supplier number (if session available)
    if (session?.fsAccessToken) {
      try {
        await lookupFutursoftSupplierNr(invoiceId, session);
      } catch (fsErr) {
        await addLog(invoiceId, 'supplier_fs_lookup', 'warn', `FS supplier nr lookup failed: ${fsErr.message}`, null);
      }
    }

    // Step 6: Determine final status
    // Force needs_review if: validation errors, low confidence, fallback used,
    // any math-related warnings, or PDF total doesn't match extracted total
    const hasMathWarnings = validation.issues.some(i =>
      i.field && (i.field.includes('net') || i.field.includes('vat') || i.field.includes('gross') || i.field.includes('Total'))
    );
    const hasIssues = !validation.valid || (extracted.confidence || 1) < 0.75 || usedFallback || hasMathWarnings || pdfTotalMismatch;
    const newStatus = hasIssues ? 'needs_review' : 'ready';
    await updateInvoiceStatus(invoiceId, newStatus);
    const reasons = [];
    if (!validation.valid) reasons.push('validation errors');
    if ((extracted.confidence || 1) < 0.75) reasons.push(`low confidence (${extracted.confidence})`);
    if (usedFallback) reasons.push('used fallback extractor');
    if (hasMathWarnings) reasons.push('math mismatches in totals');
    if (pdfTotalMismatch) reasons.push('gross total differs from PDF text');
    await addLog(invoiceId, 'processing_complete', 'info',
      `Processing complete → ${newStatus}${reasons.length > 0 ? ' (' + reasons.join(', ') + ')' : ''}`,
      null
    );

  } catch (err) {
    try {
      await updateInvoiceStatus(invoiceId, 'failed', err.message);
      await addLog(invoiceId, 'processing_error', 'error', `Unexpected error: ${err.message}`, null);
    } catch {
      // ignore
    }
  }
}

module.exports = { processInvoice };
