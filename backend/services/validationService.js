/**
 * Validates extracted invoice data and returns warnings/errors.
 * Does not throw — returns a list of validation issues.
 */

const TOLERANCE = 0.02; // 2 cent tolerance for rounding

function approxEqual(a, b) {
  if (a == null || b == null) return true; // can't validate nulls
  return Math.abs(Number(a) - Number(b)) <= TOLERANCE;
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

    if (extracted.netTotal != null && !approxEqual(linesNetSum, extracted.netTotal)) {
      issues.push({
        field: 'netTotal',
        severity: 'warn',
        message: `Net total ${extracted.netTotal} does not match sum of lines ${linesNetSum.toFixed(2)}`,
      });
    }
    if (extracted.vatTotal != null && !approxEqual(linesVatSum, extracted.vatTotal)) {
      issues.push({
        field: 'vatTotal',
        severity: 'warn',
        message: `VAT total ${extracted.vatTotal} does not match sum of lines ${linesVatSum.toFixed(2)}`,
      });
    }
    if (extracted.grossTotal != null && !approxEqual(linesGrossSum, extracted.grossTotal)) {
      issues.push({
        field: 'grossTotal',
        severity: 'warn',
        message: `Gross total ${extracted.grossTotal} does not match sum of lines ${linesGrossSum.toFixed(2)}`,
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

module.exports = { validate };
