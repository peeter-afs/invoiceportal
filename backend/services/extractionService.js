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

  // Recalculate header totals from lines if they don't match
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

    // If netTotal is still null or mismatched, derive from lines
    if (extracted.netTotal == null || !approxEqual(linesNetSum, extracted.netTotal)) {
      if (extracted.netTotal != null) {
        corrections.push(`netTotal ${extracted.netTotal} → ${linesNetSum.toFixed(2)} (recalculated from lines)`);
      }
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

  // Insert invoice lines
  if (Array.isArray(extracted.lines) && extracted.lines.length > 0) {
    await query('DELETE FROM invoice_lines WHERE invoice_id = ?', [invoiceId]);
    for (const line of extracted.lines) {
      await query(
        `INSERT INTO invoice_lines (id, invoice_id, row_no, product_code, description,
           qty, unit, unit_price, net, vat_rate, vat_amount, gross, raw)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          invoiceId,
          line.rowNo,
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
        await addLog(invoiceId, 'extraction_openai', 'info', 'Starting OpenAI extraction (structured output)', null);
        extracted = await openaiExtractor.extract(textForOpenAI, filename);
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
