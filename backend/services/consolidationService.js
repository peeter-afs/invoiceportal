const { query } = require('../db');
const { createFromSession } = require('./futursoftApiClient');

/**
 * Detect multi-PO matches: when invoice lines match rows from different POs.
 * Returns consolidation state grouped by PO number.
 */
async function getConsolidationState(invoiceId, session) {
  const invoices = await query(
    'SELECT id, tenant_id, purchase_order_nr, supplier_name FROM invoices WHERE id = ? LIMIT 1',
    [invoiceId]
  );
  const invoice = invoices[0];
  if (!invoice) throw Object.assign(new Error('Invoice not found'), { status: 404 });

  const lines = await query(
    `SELECT id, row_no, product_code, description, qty, unit_price, net, match_data
     FROM invoice_lines WHERE invoice_id = ? ORDER BY row_no`,
    [invoiceId]
  );

  // Also fetch open POs for same supplier from Futursoft
  let openPOs = [];
  if (invoice.supplier_name) {
    try {
      const client = await createFromSession(session);
      const result = await client.getOpenPurchaseOrdersForSupplier(invoice.supplier_name);
      openPOs = Array.isArray(result) ? result : [];
    } catch {
      // ignore
    }
  }

  // Group lines by their matched PO number
  const groups = {};
  const unmatched = [];

  for (const line of lines) {
    const match = line.match_data ? JSON.parse(line.match_data) : null;
    const lineData = {
      lineId: line.id,
      rowNo: line.row_no,
      productCode: line.product_code,
      description: line.description,
      qty: line.qty != null ? Number(line.qty) : null,
      unitPrice: line.unit_price != null ? Number(line.unit_price) : null,
      net: line.net != null ? Number(line.net) : null,
      match,
    };

    if (match && match.poNr) {
      if (!groups[match.poNr]) groups[match.poNr] = [];
      groups[match.poNr].push(lineData);
    } else {
      unmatched.push(lineData);
    }
  }

  const isMultiPO = Object.keys(groups).length > 1;
  const currentPO = invoice.purchase_order_nr || Object.keys(groups)[0] || null;

  return {
    invoiceId,
    currentPO,
    isMultiPO,
    groups,
    unmatched,
    openPOs: openPOs.map((po) => ({
      purchaseOrderNr: po.purchaseOrderNr,
      supplierName: po.supplierName || po.supplierNr,
      rowCount: (po.rows || []).length,
    })),
  };
}

/**
 * Apply consolidation actions.
 * Each action can be:
 *   { lineId, action: 'accept' }                        — keep current match
 *   { lineId, action: 'reassign', targetPO, targetRow } — match to a different PO row
 *   { lineId, action: 'add_new', targetPO }             — add as new row to target PO
 *   { lineId, action: 'move', targetPO }                — move from old PO to target PO
 *   { lineId, action: 'manual' }                        — mark for manual handling
 */
async function applyConsolidationActions(invoiceId, actions, session) {
  const results = [];

  for (const action of actions) {
    const lineRows = await query(
      'SELECT id, match_data FROM invoice_lines WHERE id = ? AND invoice_id = ? LIMIT 1',
      [action.lineId, invoiceId]
    );
    const line = lineRows[0];
    if (!line) {
      results.push({ lineId: action.lineId, success: false, error: 'Line not found' });
      continue;
    }

    const currentMatch = line.match_data ? JSON.parse(line.match_data) : {};

    switch (action.action) {
      case 'accept':
        // No change needed
        results.push({ lineId: action.lineId, success: true, action: 'accept' });
        break;

      case 'reassign': {
        const newMatch = {
          ...currentMatch,
          poNr: action.targetPO,
          poRowNr: action.targetRow || null,
          matchMethod: 'manual_reassign',
          confidence: 1.0,
        };
        await query('UPDATE invoice_lines SET match_data = ? WHERE id = ?', [
          JSON.stringify(newMatch), action.lineId,
        ]);
        results.push({ lineId: action.lineId, success: true, action: 'reassign' });
        break;
      }

      case 'add_new': {
        const newMatch = {
          ...currentMatch,
          poNr: action.targetPO,
          poRowNr: null,
          matchMethod: 'add_new_row',
          confidence: 1.0,
        };
        await query('UPDATE invoice_lines SET match_data = ? WHERE id = ?', [
          JSON.stringify(newMatch), action.lineId,
        ]);
        results.push({ lineId: action.lineId, success: true, action: 'add_new' });
        break;
      }

      case 'move': {
        // Move from old PO to target PO. In a real scenario this would call Futursoft
        // to cancel qty on old row and create on new. For now, update match data.
        const newMatch = {
          ...currentMatch,
          originalPoNr: currentMatch.poNr,
          poNr: action.targetPO,
          poRowNr: action.targetRow || null,
          matchMethod: 'moved_to_current',
          confidence: 1.0,
        };
        await query('UPDATE invoice_lines SET match_data = ? WHERE id = ?', [
          JSON.stringify(newMatch), action.lineId,
        ]);
        results.push({ lineId: action.lineId, success: true, action: 'move' });
        break;
      }

      case 'manual': {
        const newMatch = {
          ...currentMatch,
          matchMethod: 'manual_handling',
          confidence: 0,
        };
        await query('UPDATE invoice_lines SET match_data = ? WHERE id = ?', [
          JSON.stringify(newMatch), action.lineId,
        ]);
        results.push({ lineId: action.lineId, success: true, action: 'manual' });
        break;
      }

      default:
        results.push({ lineId: action.lineId, success: false, error: `Unknown action: ${action.action}` });
    }
  }

  return { results };
}

module.exports = { getConsolidationState, applyConsolidationActions };
