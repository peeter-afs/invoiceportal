/**
 * Validates extracted invoice data and returns warnings/errors.
 * Does not throw — returns a list of validation issues.
 */

const BASE_TOLERANCE = 0.02; // 2 cent tolerance per line for rounding

function approxEqual(a, b, tolerance) {
  if (a == null || b == null) return true; // can't validate nulls
  return Math.abs(Number(a) - Number(b)) <= (tolerance || BASE_TOLERANCE);
}

// Scale tolerance for multi-line sums: rounding can accumulate
function sumTolerance(lineCount) {
  return Math.max(BASE_TOLERANCE, lineCount * 0.01 + 0.02);
}

function validate(extracted) {
  const issues = [];

  // Required header fields
  if (!extracted.supplierName) {
    issues.push({ field: 'supplierName', severity: 'warn', message: 'Supplier name not found' });
  }
  if (!extracted.invoiceNumber) {
    issues.push({ field: 'invoiceNumber', severity: 'warn', message: 'Invoice number not found' });
  }
  if (!extracted.invoiceDate) {
    issues.push({ field: 'invoiceDate', severity: 'warn', message: 'Invoice date not found' });
  }
  if (!extracted.currency) {
    issues.push({ field: 'currency', severity: 'warn', message: 'Currency not found' });
  }
  if (!extracted.grossTotal && extracted.grossTotal !== 0) {
    issues.push({ field: 'grossTotal', severity: 'warn', message: 'Invoice total not found' });
  }

  const lines = extracted.lines || [];
  if (lines.length === 0) {
    issues.push({ field: 'lines', severity: 'error', message: 'No invoice lines extracted' });
  }

  // Validate line totals sum to header totals
  if (lines.length > 0) {
    let linesNetSum = 0;
    let linesVatSum = 0;
    let linesGrossSum = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const qty = Number(line.qty || 0);
      const unitPrice = Number(line.unitPrice || 0);
      const net = Number(line.net || 0);
      const vatRate = Number(line.vatRate || 0);
      const vatAmount = Number(line.vatAmount || 0);
      const gross = Number(line.gross || 0);

      // Check line-level consistency
      if (line.qty != null && line.unitPrice != null && line.net != null) {
        const expectedNet = qty * unitPrice;
        if (!approxEqual(expectedNet, net)) {
          issues.push({
            field: `lines[${i}].net`,
            severity: 'warn',
            message: `Line ${i + 1}: net ${net} does not match qty × unitPrice = ${expectedNet.toFixed(2)}`,
          });
        }
      }

      if (line.net != null && line.vatRate != null && line.vatAmount != null) {
        const expectedVat = net * (vatRate / 100);
        if (!approxEqual(expectedVat, vatAmount)) {
          issues.push({
            field: `lines[${i}].vatAmount`,
            severity: 'warn',
            message: `Line ${i + 1}: VAT amount ${vatAmount} does not match net × rate = ${expectedVat.toFixed(2)}`,
          });
        }
      }

      linesNetSum += net;
      linesVatSum += vatAmount;
      linesGrossSum += gross || (net + vatAmount);
    }

    const sTol = sumTolerance(lines.length);
    if (extracted.netTotal != null && !approxEqual(linesNetSum, extracted.netTotal, sTol)) {
      issues.push({
        field: 'netTotal',
        severity: 'warn',
        message: `Net total ${extracted.netTotal} does not match sum of lines ${linesNetSum.toFixed(2)} (diff: ${Math.abs(linesNetSum - Number(extracted.netTotal)).toFixed(2)})`,
      });
    }
    if (extracted.vatTotal != null && !approxEqual(linesVatSum, extracted.vatTotal, sTol)) {
      issues.push({
        field: 'vatTotal',
        severity: 'warn',
        message: `VAT total ${extracted.vatTotal} does not match sum of lines ${linesVatSum.toFixed(2)} (diff: ${Math.abs(linesVatSum - Number(extracted.vatTotal)).toFixed(2)})`,
      });
    }
    if (extracted.grossTotal != null && !approxEqual(linesGrossSum, extracted.grossTotal, sTol)) {
      issues.push({
        field: 'grossTotal',
        severity: 'warn',
        message: `Gross total ${extracted.grossTotal} does not match sum of lines ${linesGrossSum.toFixed(2)} (diff: ${Math.abs(linesGrossSum - Number(extracted.grossTotal)).toFixed(2)})`,
      });
    }

    // Check header self-consistency: netTotal + vatTotal should equal grossTotal
    if (extracted.netTotal != null && extracted.vatTotal != null && extracted.grossTotal != null) {
      const expectedGross = Number(extracted.netTotal) + Number(extracted.vatTotal);
      if (!approxEqual(expectedGross, extracted.grossTotal)) {
        issues.push({
          field: 'grossTotal',
          severity: 'warn',
          message: `Gross total ${extracted.grossTotal} does not match net + VAT = ${expectedGross.toFixed(2)}`,
        });
      }
    }
  }

  const hasErrors = issues.some((i) => i.severity === 'error');
  return { valid: !hasErrors, issues };
}

/**
 * Extract candidate total amounts from raw PDF text using regex.
 * Looks for patterns like "Kokku tasuda: 292,80" or "Total: 1 234.56 EUR".
 * Returns an array of { label, value } sorted by value descending (largest first).
 */
function extractTotalsFromText(pdfText) {
  if (!pdfText) return [];
  const results = [];

  // Patterns: label followed by a number (European or US format)
  // Matches: "Kokku tasuda 292,80", "TOTAL: 1 234.56", "Summa: 292.80 EUR", "Kokku 292,80 €"
  const patterns = [
    // Estonian
    /(?:kokku\s*tasuda|kokku\s*käibemaksuga|kokku\s*km-ga|arve\s*summa|tasuda|kokku\s*€?)\s*[:.]?\s*([\d\s]+[.,]\d{2})/gi,
    // English
    /(?:grand\s*total|total\s*due|total\s*amount|invoice\s*total|amount\s*due|balance\s*due|total)\s*[:.]?\s*([\d\s]+[.,]\d{2})/gi,
    // Finnish
    /(?:yhteensä|loppusumma|maksettava)\s*[:.]?\s*([\d\s]+[.,]\d{2})/gi,
    // German
    /(?:gesamtbetrag|rechnungsbetrag|summe|gesamt)\s*[:.]?\s*([\d\s]+[.,]\d{2})/gi,
  ];

  for (const re of patterns) {
    let m;
    while ((m = re.exec(pdfText)) !== null) {
      const raw = m[1].replace(/\s/g, '').replace(',', '.');
      const val = parseFloat(raw);
      if (!isNaN(val) && val > 0) {
        results.push({ label: m[0].trim(), value: val });
      }
    }
  }

  // Deduplicate by value (keep first occurrence)
  const seen = new Set();
  const unique = results.filter(r => {
    const key = r.value.toFixed(2);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.sort((a, b) => b.value - a.value);
}

/**
 * Verify the extracted grossTotal against totals found in raw PDF text.
 * Returns { verified, pdfTotal, message } or null if no totals found in text.
 */
function verifyTotalAgainstPdfText(extracted, pdfText) {
  const pdfTotals = extractTotalsFromText(pdfText);
  if (pdfTotals.length === 0) return null;

  const grossTotal = extracted.grossTotal != null ? Number(extracted.grossTotal) : null;
  if (grossTotal == null) return null;

  // The largest total in the PDF text is usually the gross total
  const bestMatch = pdfTotals.find(t => approxEqual(t.value, grossTotal, 0.05));
  if (bestMatch) {
    return { verified: true, pdfTotal: bestMatch.value, message: `Gross total ${grossTotal} matches PDF text "${bestMatch.label}"` };
  }

  // Check if any PDF total matches
  const closest = pdfTotals[0]; // largest
  return {
    verified: false,
    pdfTotal: closest.value,
    message: `Gross total ${grossTotal} does NOT match PDF text total ${closest.value} ("${closest.label}") — diff: ${Math.abs(grossTotal - closest.value).toFixed(2)}`,
  };
}

module.exports = { validate, verifyTotalAgainstPdfText };
