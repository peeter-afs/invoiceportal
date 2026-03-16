const crypto = require('crypto');
const pdfParse = require('pdf-parse');
const { query } = require('../db');
const openaiExtractor = require('./openaiExtractor');
const costpocketExtractor = require('./costpocketExtractor');
const { validate } = require('./validationService');

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
        // Check if net is off by a factor of 10 or 100 (European decimal confusion)
        for (const factor of [10, 100]) {
          if (approxEqual(expected, net / factor)) {
            corrections.push(`Line ${i + 1}: net ${net} → ${net / factor} (was ${factor}× too high, expected qty ${qty} × unitPrice ${unitPrice} = ${expected})`);
            line.net = Number((net / factor).toFixed(2));
            break;
          }
          if (approxEqual(expected * factor, net)) {
            // unitPrice might be wrong
            if (approxEqual(qty * (unitPrice / factor), net)) {
              corrections.push(`Line ${i + 1}: unitPrice ${unitPrice} → ${unitPrice / factor} (was ${factor}× too high)`);
              line.unitPrice = Number((unitPrice / factor).toFixed(2));
              break;
            }
          }
        }
        // If net still doesn't match and qty + unitPrice look reasonable, recalculate net
        const recalcNet = qty * (line.unitPrice != null ? Number(line.unitPrice) : unitPrice);
        if (!approxEqual(recalcNet, Number(line.net))) {
          // Trust qty and unitPrice, fix net
          corrections.push(`Line ${i + 1}: recalculated net from qty × unitPrice: ${Number(line.net)} → ${recalcNet.toFixed(2)}`);
          line.net = Number(recalcNet.toFixed(2));
        }
      }
    }

    // Calculate missing qty from net and unitPrice: qty = net / unitPrice
    if (line.qty == null && line.net != null && line.unitPrice != null && Number(line.unitPrice) !== 0) {
      const calcQty = Number(line.net) / Number(line.unitPrice);
      // Only auto-fill if it's a clean number (integer or up to 3 decimals)
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

  // Cross-check: compare sum of line nets against invoice netTotal.
  // Common OCR/extraction error: OpenAI concatenates adjacent columns.
  // E.g. qty "1" + price first digit "3" → qty=13, then net=13×3.57=46.41
  // but real values are qty=1, net=3.57. The invoice header total is the ground truth.
  if (lines.length > 0 && extracted.netTotal != null) {
    const linesSum = lines.reduce((s, l) => s + Number(l.net || 0), 0);
    const headerNet = Number(extracted.netTotal);

    if (!approxEqual(linesSum, headerNet) && headerNet > 0 && linesSum > headerNet * 1.2) {
      // Lines total is too high vs header — try fixing column-concatenation errors.
      // For each line with qty>1 starting with "1", test if setting qty=1 and net=unitPrice
      // brings the total closer to headerNet.
      const candidateFixes = [];
      let correctedSum = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const qty = line.qty != null ? Number(line.qty) : null;
        const unitPrice = line.unitPrice != null ? Number(line.unitPrice) : null;
        const net = line.net != null ? Number(line.net) : null;

        if (qty != null && qty > 1 && unitPrice != null && net != null) {
          // Detect concat pattern: qty starts with "1" and remaining digits match
          // the first digits of the unit price.
          // E.g. qty=13, unitPrice=3.57 → "13"[1:]="3", price starts with "3" → concat
          // E.g. qty=15, unitPrice=5.23 → "15"[1:]="5", price starts with "5" → concat
          const qtyStr = String(Math.round(qty));
          const priceIntStr = String(unitPrice).replace('.', '').replace(/^0+/, '');

          if (qtyStr.startsWith('1') && qtyStr.length > 1 &&
              priceIntStr.startsWith(qtyStr.substring(1))) {
            // Likely concat error — candidate for fix
            candidateFixes.push(i);
            correctedSum += unitPrice; // net would be unitPrice if qty=1
          } else {
            correctedSum += net;
          }
        } else {
          correctedSum += net || 0;
        }
      }

      // Apply fixes only if the corrected sum is much closer to headerNet
      if (candidateFixes.length > 0 &&
          Math.abs(correctedSum - headerNet) < Math.abs(linesSum - headerNet) * 0.5) {
        for (const idx of candidateFixes) {
          const line = lines[idx];
          const oldQty = line.qty;
          const oldNet = line.net;
          line.qty = 1;
          line.net = Number(Number(line.unitPrice).toFixed(2));
          corrections.push(
            `Line ${idx + 1}: qty ${oldQty} → 1, net ${oldNet} → ${line.net} (column concat fix; line total in PDF = unitPrice when qty=1)`
          );
        }
        const fixedSum = lines.reduce((s, l) => s + Number(l.net || 0), 0);
        corrections.push(`Line sum fixed: ${linesSum.toFixed(2)} → ${fixedSum.toFixed(2)} (header netTotal = ${headerNet})`);
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
async function processInvoice(invoiceId, pdfBuffer, filename) {
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

    // Step 2: Primary extraction with OpenAI
    let extracted = null;
    let usedFallback = false;

    if (process.env.OPENAI_API_KEY) {
      try {
        await addLog(invoiceId, 'extraction_openai', 'info', 'Starting OpenAI extraction (vision + structured output)', null);
        extracted = await openaiExtractor.extract(textForOpenAI, filename, { pdfBuffer });
        await addLog(invoiceId, 'extraction_openai', 'info', `OpenAI extraction complete, confidence: ${extracted.confidence}`, {
          confidence: extracted.confidence,
          model: extracted.model,
        });

        // Step 2b: Math auto-correction
        const corrections = correctExtractedMath(extracted);
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

        // Step 2d: Retry once if there are math errors the correction couldn't fix
        if (mathErrors.length > 0) {
          await addLog(invoiceId, 'extraction_retry', 'info',
            `Retrying OpenAI extraction due to ${mathErrors.length} math error(s)`,
            { errors: mathErrors.map(e => e.message) }
          );

          try {
            const retryResult = await openaiExtractor.extract(textForOpenAI, filename, {
              pdfBuffer,
              previousErrors: mathErrors.map(e => e.message),
              previousResponse: extracted.rawResponse,
            });

            // Apply math correction to retry result too
            const retryCorrections = correctExtractedMath(retryResult);
            const retryValidation = validate(retryResult);

            // Use retry result if it has fewer issues
            if (retryValidation.issues.length < firstValidation.issues.length) {
              extracted = retryResult;
              await addLog(invoiceId, 'extraction_retry', 'info',
                `Retry improved: ${firstValidation.issues.length} → ${retryValidation.issues.length} issue(s)`,
                { corrections: retryCorrections }
              );
            } else {
              await addLog(invoiceId, 'extraction_retry', 'info',
                'Retry did not improve results, keeping original', null
              );
            }
          } catch (retryErr) {
            await addLog(invoiceId, 'extraction_retry', 'warn',
              `Retry failed: ${retryErr.message}`, null
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

    // Step 5: Save extracted data to DB
    await saveExtractedData(invoiceId, extracted);
    await addLog(invoiceId, 'normalization', 'info', `Saved: ${(extracted.lines || []).length} lines`, {
      extractedBy: extracted.extractedBy,
    });

    // Step 6: Determine final status
    const hasIssues = !validation.valid || (extracted.confidence || 1) < 0.75 || usedFallback;
    const newStatus = hasIssues ? 'needs_review' : 'ready';
    await updateInvoiceStatus(invoiceId, newStatus);
    await addLog(invoiceId, 'processing_complete', 'info', `Processing complete → ${newStatus}`, null);

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
