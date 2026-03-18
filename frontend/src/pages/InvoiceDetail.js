import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { invoiceAPI, supplierAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import ProcessingStatus from '../components/ProcessingStatus';
import ApprovalActions from '../components/ApprovalActions';
import ApprovalHistory from '../components/ApprovalHistory';
import './Dashboard.css';

const STATUS_LABEL = {
  queued: 'Queued',
  processing: 'Processing',
  needs_review: 'Needs Review',
  ready: 'Ready',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Rejected',
  exporting: 'Exporting',
  exported: 'Exported',
  failed: 'Failed',
};

const EDITABLE_STATUSES = ['needs_review', 'ready', 'rejected'];
const TOLERANCE = 0.02;
const DATE_FIELDS = new Set(['invoiceDate', 'dueDate', 'deliveryDate']);
const NUMBER_FIELDS = new Set(['netTotal', 'vatTotal', 'grossTotal']);

const inlineInputStyle = {
  border: 'none',
  borderBottom: '2px solid #3498db',
  outline: 'none',
  fontSize: 'inherit',
  fontFamily: 'inherit',
  background: 'transparent',
  padding: '1px 0',
  width: '100%',
  minWidth: '60px',
};

const cellInputStyle = {
  padding: '0.2rem 0.3rem',
  border: '1px solid #ccc',
  borderRadius: '3px',
  fontSize: '0.85rem',
  background: '#fafbfc',
  width: '100%',
  boxSizing: 'border-box',
};

function toDateInputValue(val) {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
}

function formatDate(val) {
  if (!val) return '-';
  const s = String(val);
  const d = new Date(s.includes('T') ? s : s + 'T12:00:00');
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString();
}

function lineToEdit(l) {
  return {
    productCode: l.productCode || '',
    description: l.description || '',
    qty: l.qty != null ? String(l.qty) : '',
    unit: l.unit || '',
    unitPrice: l.unitPrice != null ? String(l.unitPrice) : '',
    vatRate: l.vatRate != null ? String(l.vatRate) : '',
    net: l.net != null ? String(l.net) : '',
    gross: l.gross != null ? String(l.gross) : '',
  };
}

function InvoiceDetail() {
  const { logout, user } = useAuth();
  const { id } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showPdf, setShowPdf] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null);
  const [leftPanelWidth, setLeftPanelWidth] = useState(50);
  const isDragging = useRef(false);
  const containerRef = useRef(null);
  const [suppliers, setSuppliers] = useState([]);
  const [editingSupplier, setEditingSupplier] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [editingFsNr, setEditingFsNr] = useState(false);
  const [fsNrValue, setFsNrValue] = useState('');

  // Double-click inline edit state
  const [editingField, setEditingField] = useState(null);
  const [editingLineIdx, setEditingLineIdx] = useState(null);
  const [pendingChanges, setPendingChanges] = useState({});
  const [pendingLines, setPendingLines] = useState(null);
  const [tempValue, setTempValue] = useState('');
  const [saving, setSaving] = useState(false);

  const hasPendingChanges = Object.keys(pendingChanges).length > 0 || pendingLines !== null;

  // ── Resize handle ──
  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setLeftPanelWidth(Math.min(80, Math.max(25, pct)));
    };
    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // ── Data fetching ──
  const fetchInvoice = useCallback(async () => {
    try {
      const res = await invoiceAPI.getById(id);
      setInvoice(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load invoice');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    supplierAPI.getAll().then((res) => setSuppliers(res.data)).catch(() => {});
  }, []);

  useEffect(() => {
    fetchInvoice();
    let interval;
    interval = setInterval(async () => {
      try {
        const res = await invoiceAPI.getById(id);
        setInvoice(res.data);
        if (!['queued', 'processing'].includes(res.data.status)) clearInterval(interval);
      } catch { clearInterval(interval); }
    }, 3000);
    return () => clearInterval(interval);
  }, [id, fetchInvoice]);

  useEffect(() => {
    if (!showPdf || pdfBlobUrl) return;
    let revoked = false;
    invoiceAPI.getFile(id)
      .then((res) => { if (revoked) return; setPdfBlobUrl(URL.createObjectURL(res.data)); })
      .catch(() => {});
    return () => { revoked = true; };
  }, [showPdf, id, pdfBlobUrl]);

  useEffect(() => {
    return () => { if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl); };
  }, [pdfBlobUrl]);

  // ── Supplier link helpers ──
  const handleSaveSupplier = async () => {
    try {
      await invoiceAPI.update(id, { supplierId: selectedSupplierId || null });
      setEditingSupplier(false);
      supplierAPI.getAll().then((res) => setSuppliers(res.data)).catch(() => {});
      fetchInvoice();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update supplier');
    }
  };

  const handleSaveFsNr = async () => {
    if (!invoice.supplierId) return;
    try {
      await supplierAPI.update(invoice.supplierId, { futursoftSupplierNr: fsNrValue || '' });
      setEditingFsNr(false);
      fetchInvoice();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update Futursoft supplier nr');
    }
  };

  // ── Field editing ──
  // Get display value for a field (pending overrides invoice)
  const dv = (field) => {
    if (Object.prototype.hasOwnProperty.call(pendingChanges, field)) return pendingChanges[field];
    return invoice?.[field] ?? null;
  };

  const startFieldEdit = (field, initVal) => {
    setEditingField(field);
    setTempValue(initVal ?? '');
  };

  const commitFieldEdit = useCallback(() => {
    if (!editingField) return;
    const field = editingField;
    const value = tempValue;
    setPendingChanges((prev) => ({ ...prev, [field]: value }));
    setEditingField(null);
  }, [editingField, tempValue]);

  const cancelFieldEdit = useCallback(() => {
    setEditingField(null);
    setTempValue('');
  }, []);

  const handleFieldKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitFieldEdit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelFieldEdit(); }
  };

  // Render an inline-editable field value
  // field: state key; displayFn: optional formatter for display; opts: { type, step, width }
  const renderEditable = (field, displayFn, opts = {}) => {
    const isActive = editingField === field;
    const hasDirty = Object.prototype.hasOwnProperty.call(pendingChanges, field);
    const raw = dv(field);

    if (!canEdit) {
      return <>{displayFn ? displayFn(raw) : (raw ?? '-')}</>;
    }

    if (isActive) {
      const inputType = DATE_FIELDS.has(field) ? 'date' : NUMBER_FIELDS.has(field) ? 'number' : 'text';
      return (
        <input
          autoFocus
          type={inputType}
          step={inputType === 'number' ? (opts.step || '0.01') : undefined}
          value={tempValue}
          onChange={(e) => setTempValue(e.target.value)}
          onBlur={commitFieldEdit}
          onKeyDown={handleFieldKeyDown}
          style={{ ...inlineInputStyle, width: opts.width || '100%' }}
        />
      );
    }

    const displayed = displayFn ? displayFn(raw) : (raw != null ? String(raw) : '-');
    const initVal = DATE_FIELDS.has(field) ? toDateInputValue(raw) : (raw != null ? String(raw) : '');

    return (
      <span
        onDoubleClick={() => startFieldEdit(field, initVal)}
        title="Double-click to edit"
        style={{
          cursor: 'text',
          borderBottom: hasDirty ? '2px solid #f39c12' : '1px dotted #ccc',
          display: 'inline-block',
          minWidth: '1.5rem',
          padding: '1px 0',
        }}
      >
        {displayed || '-'}
      </span>
    );
  };

  // ── Line editing ──
  const initPendingLines = useCallback(() => {
    return (invoice?.lines || []).map(lineToEdit);
  }, [invoice]);

  const startLineEdit = (idx) => {
    if (editingField) commitFieldEdit();
    if (!pendingLines) setPendingLines(initPendingLines());
    setEditingLineIdx(idx);
  };

  const updatePendingLine = (idx, field, value) => {
    setPendingLines((prev) => {
      const next = [...(prev || [])];
      next[idx] = { ...next[idx], [field]: value };
      if (field === 'qty' || field === 'unitPrice') {
        const q = parseFloat(field === 'qty' ? value : next[idx].qty);
        const p = parseFloat(field === 'unitPrice' ? value : next[idx].unitPrice);
        if (!isNaN(q) && !isNaN(p)) next[idx].net = String(Math.round(q * p * 100) / 100);
      }
      if (['net', 'vatRate', 'qty', 'unitPrice'].includes(field)) {
        const n = parseFloat(next[idx].net);
        const vr = parseFloat(next[idx].vatRate);
        if (!isNaN(n) && !isNaN(vr)) next[idx].gross = String(Math.round(n * (1 + vr / 100) * 100) / 100);
      }
      return next;
    });
  };

  const commitLineEdit = () => setEditingLineIdx(null);

  const cancelLineEdit = useCallback(() => {
    if (editingLineIdx !== null) {
      const original = invoice?.lines?.[editingLineIdx];
      if (original) {
        setPendingLines((prev) => {
          if (!prev) return prev;
          const next = [...prev];
          next[editingLineIdx] = lineToEdit(original);
          return next;
        });
      }
    }
    setEditingLineIdx(null);
  }, [editingLineIdx, invoice]);

  const addLine = () => {
    const currentLen = (pendingLines || invoice?.lines || []).length;
    setPendingLines((prev) => {
      const base = prev || initPendingLines();
      return [...base, { productCode: '', description: '', qty: '1', unit: '', unitPrice: '', vatRate: '0', net: '', gross: '' }];
    });
    setEditingLineIdx(currentLen);
  };

  const deleteLine = (idx) => {
    setPendingLines((prev) => {
      const base = prev || initPendingLines();
      return base.filter((_, i) => i !== idx);
    });
    if (editingLineIdx === idx) setEditingLineIdx(null);
    else if (editingLineIdx > idx) setEditingLineIdx((p) => p - 1);
  };

  // ── Save / Discard ──
  const saveAll = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = {};

      for (const [key, val] of Object.entries(pendingChanges)) {
        payload[key] = val;
      }
      for (const k of ['netTotal', 'vatTotal', 'grossTotal']) {
        if (k in payload) payload[k] = payload[k] !== '' ? Number(payload[k]) : null;
      }
      for (const k of ['invoiceDate', 'dueDate', 'deliveryDate']) {
        if (k in payload) payload[k] = payload[k] || null;
      }

      if (pendingLines !== null) {
        payload.lines = pendingLines.map((l) => ({
          productCode: l.productCode || null,
          description: l.description || null,
          qty: l.qty !== '' ? Number(l.qty) : null,
          unit: l.unit || null,
          unitPrice: l.unitPrice !== '' ? Number(l.unitPrice) : null,
          vatRate: l.vatRate !== '' ? Number(l.vatRate) : null,
          net: l.net !== '' ? Number(l.net) : null,
          vatAmount: (l.vatRate !== '' && l.net !== '') ? Math.round(Number(l.net) * Number(l.vatRate) / 100 * 100) / 100 : null,
          gross: l.gross !== '' ? Number(l.gross) : null,
        }));
      }

      await invoiceAPI.update(id, payload);
      setPendingChanges({});
      setPendingLines(null);
      setEditingField(null);
      setEditingLineIdx(null);
      fetchInvoice();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const discardAll = () => {
    setPendingChanges({});
    setPendingLines(null);
    setEditingField(null);
    setEditingLineIdx(null);
  };

  // ── Row sums and error detection ──
  const viewLines = (pendingLines ?? invoice?.lines) || [];

  const lineErrors = viewLines.map((line) => {
    const q = parseFloat(line.qty);
    const p = parseFloat(line.unitPrice);
    const n = parseFloat(line.net);
    const errors = [];
    if (!isNaN(q) && !isNaN(p) && !isNaN(n)) {
      const expected = Math.round(q * p * 100) / 100;
      if (Math.abs(expected - n) > TOLERANCE) {
        errors.push(`qty × unitPrice = ${expected.toFixed(2)}, but net = ${n.toFixed(2)}`);
      }
    }
    return errors;
  });

  const rowNetSum = viewLines.reduce((s, l) => s + (parseFloat(l.net) || 0), 0);
  const rowGrossSum = viewLines.reduce((s, l) => s + (parseFloat(l.gross) || 0), 0);

  const invNetTotal = Object.prototype.hasOwnProperty.call(pendingChanges, 'netTotal')
    ? parseFloat(pendingChanges.netTotal) : invoice?.netTotal;
  const invGrossTotal = Object.prototype.hasOwnProperty.call(pendingChanges, 'grossTotal')
    ? parseFloat(pendingChanges.grossTotal) : invoice?.grossTotal;

  const netMatches = invNetTotal != null && !isNaN(invNetTotal) && Math.abs(rowNetSum - invNetTotal) <= TOLERANCE;
  const grossMatches = invGrossTotal != null && !isNaN(invGrossTotal) && Math.abs(rowGrossSum - invGrossTotal) <= TOLERANCE;

  // ── Render ──
  if (loading) return <div className="container"><p>Loading...</p></div>;
  if (error && !invoice) return <div className="container"><div className="error">{error}</div></div>;
  if (!invoice) return null;

  const isProcessing = ['queued', 'processing'].includes(invoice.status);
  const canEdit = EDITABLE_STATUSES.includes(invoice.status);

  return (
    <div>
      <nav className="navbar">
        <h1>Invoice Portal</h1>
        <div>
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/invoices">Invoices</Link>
          <Link to="/invoices/upload">Upload Invoice</Link>
          <button className="btn btn-danger" onClick={logout}>Logout</button>
        </div>
      </nav>

      {/* ── Sticky Workflow Bar ── */}
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 200,
        background: '#fff',
        borderBottom: '1px solid #e0e0e0',
        padding: '0.5rem 1rem',
        display: 'flex',
        gap: '0.5rem',
        flexWrap: 'wrap',
        alignItems: 'center',
        boxShadow: '0 2px 4px rgba(0,0,0,0.06)',
      }}>
        <span className={`status-badge status-${invoice.status}`} style={{ marginRight: '0.25rem' }}>
          {STATUS_LABEL[invoice.status] || invoice.status}
        </span>
        {['needs_review', 'ready', 'approved', 'pending_approval'].includes(invoice.status) && (
          <Link to={`/invoices/${id}/matching`} className="btn btn-primary" style={{ fontSize: '0.82rem', padding: '0.3rem 0.7rem' }}>
            Row Matching
          </Link>
        )}
        {invoice.workflowConfig?.orderProposal && (
          <Link to={`/invoices/${id}/proposal`} className="btn" style={{ fontSize: '0.82rem', padding: '0.3rem 0.7rem', backgroundColor: '#2980b9', color: 'white' }}>
            Order Proposal
          </Link>
        )}
        {invoice.workflowConfig?.orderConfirmation && (
          <button className="btn" style={{ fontSize: '0.82rem', padding: '0.3rem 0.7rem', backgroundColor: '#f39c12', color: 'white' }} disabled>
            Order Confirmation
          </button>
        )}
        {invoice.workflowConfig?.order && (
          <button className="btn" style={{ fontSize: '0.82rem', padding: '0.3rem 0.7rem', backgroundColor: '#e67e22', color: 'white' }} disabled>
            Order
          </button>
        )}
        {invoice.workflowConfig?.receiving && invoice.purchaseOrderNr && (
          <Link to={`/invoices/${id}/receiving`} className="btn" style={{ fontSize: '0.82rem', padding: '0.3rem 0.7rem', backgroundColor: '#27ae60', color: 'white' }}>
            Receiving
          </Link>
        )}
        {invoice.purchaseOrderNr && (
          <Link to={`/invoices/${id}/consolidation`} className="btn" style={{ fontSize: '0.82rem', padding: '0.3rem 0.7rem', backgroundColor: '#8e44ad', color: 'white' }}>
            Consolidation
          </Link>
        )}
        <div style={{ flex: 1 }} />
        {canEdit && (
          <span style={{ fontSize: '0.75rem', color: '#bbb' }}>Double-click to edit</span>
        )}
        <button
          className="btn"
          onClick={() => setShowPdf(!showPdf)}
          style={{ fontSize: '0.82rem', padding: '0.3rem 0.7rem', backgroundColor: showPdf ? '#2c3e50' : '#ecf0f1', color: showPdf ? 'white' : '#333' }}
        >
          {showPdf ? 'Hide PDF' : 'Show PDF'}
        </button>
      </div>

      <div ref={containerRef} style={{ display: 'flex', padding: '0 1rem', maxWidth: showPdf ? '100%' : '1100px', margin: '0 auto' }}>

        {/* Left: Invoice data */}
        <div style={{ width: showPdf ? `${leftPanelWidth}%` : '100%', flexShrink: 0, minWidth: 0, paddingRight: showPdf ? '0.5rem' : 0 }}>

          <h2 style={{ marginTop: '1rem', marginBottom: '0.75rem' }}>Invoice Detail</h2>

          {error && <div className="error" style={{ marginBottom: '1rem' }}>{error}</div>}

          {isProcessing && (
            <div className="card">
              <h3>Processing...</h3>
              <p>The invoice is being extracted. This page will update automatically.</p>
              <ProcessingStatus invoiceId={id} />
            </div>
          )}

          {invoice.status === 'failed' && (
            <div className="card" style={{ borderLeft: '4px solid #e74c3c' }}>
              <h3>Processing Failed</h3>
              <p>{invoice.errorMessage || 'Unknown error'}</p>
              <ProcessingStatus invoiceId={id} />
            </div>
          )}

          {!isProcessing && (
            <>
              {/* ── Supplier Card ── */}
              <div className="card">
                <h3>Supplier</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <strong>Name:</strong><br />
                    {renderEditable('supplierName')}
                  </div>
                  <div>
                    <strong>Address:</strong><br />
                    {renderEditable('supplierAddress')}
                  </div>
                  <div>
                    <strong>Reg. Number:</strong><br />
                    {renderEditable('supplierRegNumber')}
                  </div>
                  <div>
                    <strong>VAT Number:</strong><br />
                    {renderEditable('supplierVatNumber')}
                  </div>
                  <div>
                    <strong>Bank Account:</strong><br />
                    {renderEditable('supplierBankAccount')}
                  </div>
                </div>

                {/* Supplier Registry Link */}
                <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid #eee' }}>
                  {editingSupplier ? (
                    <div>
                      <strong>Link to supplier registry:</strong>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem' }}>
                        <select
                          value={selectedSupplierId}
                          onChange={(e) => setSelectedSupplierId(e.target.value)}
                          style={{ flex: 1, maxWidth: '350px', padding: '0.4rem' }}
                        >
                          <option value="">— none (unlinked) —</option>
                          {suppliers.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}{s.futursoftSupplierNr ? ` (FS# ${s.futursoftSupplierNr})` : ''}
                            </option>
                          ))}
                        </select>
                        <button className="btn btn-primary" style={{ fontSize: '0.85rem', padding: '0.35rem 0.75rem' }} onClick={handleSaveSupplier}>Save</button>
                        <button className="btn" style={{ fontSize: '0.85rem', padding: '0.35rem 0.75rem' }} onClick={() => setEditingSupplier(false)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      {invoice.supplierId ? (
                        <span><strong>Linked:</strong>{' '}<Link to={`/suppliers/${invoice.supplierId}`}>{invoice.supplierName}</Link></span>
                      ) : (
                        <span style={{ color: '#e67e22' }}>Not linked to supplier registry</span>
                      )}
                      <button
                        className="btn"
                        style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem', backgroundColor: '#ecf0f1', color: '#333' }}
                        onClick={() => { setSelectedSupplierId(invoice.supplierId || ''); setEditingSupplier(true); }}
                      >
                        {invoice.supplierId ? 'Change' : 'Link Supplier'}
                      </button>
                    </div>
                  )}

                  {invoice.supplierId && (
                    <div style={{ marginTop: '0.5rem' }}>
                      {editingFsNr ? (
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <strong>Futursoft #:</strong>
                          <input
                            type="text"
                            value={fsNrValue}
                            onChange={(e) => setFsNrValue(e.target.value)}
                            placeholder="Enter supplier nr..."
                            style={{ width: '140px', padding: '0.35rem' }}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveFsNr(); if (e.key === 'Escape') setEditingFsNr(false); }}
                            autoFocus
                          />
                          <button className="btn btn-primary" style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }} onClick={handleSaveFsNr}>Save</button>
                          <button className="btn" style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }} onClick={() => setEditingFsNr(false)}>Cancel</button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          {invoice.futursoftSupplierNr ? (
                            <span style={{ fontSize: '0.9em' }}><strong>Futursoft #:</strong> {invoice.futursoftSupplierNr}</span>
                          ) : (
                            <span style={{ color: '#999', fontSize: '0.9em' }}>Futursoft # not resolved</span>
                          )}
                          <button
                            className="btn"
                            style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem', backgroundColor: '#ecf0f1', color: '#333' }}
                            onClick={() => { setFsNrValue(invoice.futursoftSupplierNr || ''); setEditingFsNr(true); }}
                          >
                            {invoice.futursoftSupplierNr ? 'Edit' : 'Enter manually'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* ── Invoice Information Card ── */}
              <div className="card">
                <h3>Invoice Information</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div><strong>Invoice Number:</strong><br />{renderEditable('invoiceNumber')}</div>
                  <div><strong>Invoice Date:</strong><br />{renderEditable('invoiceDate', formatDate)}</div>
                  <div><strong>Due Date:</strong><br />{renderEditable('dueDate', formatDate)}</div>
                  <div><strong>Currency:</strong><br />{renderEditable('currency')}</div>
                  <div><strong>Reference Number:</strong><br />{renderEditable('referenceNumber')}</div>
                  <div><strong>Purchase Order #:</strong><br />{renderEditable('purchaseOrderNr')}</div>
                  <div><strong>Payment Terms:</strong><br />{renderEditable('paymentTerms')}</div>
                  <div><strong>Penalty Rate:</strong><br />{renderEditable('penaltyRate')}</div>
                  <div><strong>Delivery Date:</strong><br />{renderEditable('deliveryDate', formatDate)}</div>
                  <div><strong>Delivery Method:</strong><br />{renderEditable('deliveryMethod')}</div>
                  <div><strong>Delivery Note #:</strong><br />{renderEditable('deliveryNoteNr')}</div>
                  <div><strong>Our Reference:</strong><br />{renderEditable('buyerReference')}</div>
                  <div><strong>Their Reference:</strong><br />{renderEditable('sellerReference')}</div>
                </div>
              </div>

              {/* ── Totals Card ── */}
              <div className="card">
                <h3>Totals</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                  <div
                    title={invNetTotal != null ? `Row sum: ${rowNetSum.toFixed(2)}${netMatches ? ' (matches)' : ` (diff: ${(rowNetSum - invNetTotal).toFixed(2)})`}` : ''}
                    style={{ color: invNetTotal != null && viewLines.length > 0 ? (netMatches ? '#27ae60' : '#e74c3c') : undefined }}
                  >
                    <strong>Net Total:</strong><br />
                    {renderEditable('netTotal', (v) => v != null ? `${Number(v).toFixed(2)} ${invoice.currency || ''}` : '-', { step: '0.01' })}
                    {invNetTotal != null && viewLines.length > 0 && !netMatches && (
                      <span style={{ fontSize: '0.8em', display: 'block', marginTop: '0.2rem' }}>
                        rows: {rowNetSum.toFixed(2)}
                      </span>
                    )}
                  </div>
                  <div>
                    <strong>VAT Total:</strong><br />
                    {renderEditable('vatTotal', (v) => v != null ? `${Number(v).toFixed(2)} ${invoice.currency || ''}` : '-', { step: '0.01' })}
                  </div>
                  <div
                    title={invGrossTotal != null ? `Row sum: ${rowGrossSum.toFixed(2)}${grossMatches ? ' (matches)' : ` (diff: ${(rowGrossSum - invGrossTotal).toFixed(2)})`}` : ''}
                    style={{ color: invGrossTotal != null && viewLines.length > 0 ? (grossMatches ? '#27ae60' : '#e74c3c') : undefined }}
                  >
                    <strong>Gross Total:</strong><br />
                    {renderEditable('grossTotal', (v) => v != null ? `${Number(v).toFixed(2)} ${invoice.currency || ''}` : '-', { step: '0.01' })}
                    {invGrossTotal != null && viewLines.length > 0 && !grossMatches && (
                      <span style={{ fontSize: '0.8em', display: 'block', marginTop: '0.2rem' }}>
                        rows: {rowGrossSum.toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ marginTop: '0.75rem', color: '#666', fontSize: '0.9em' }}>
                  <strong>Source:</strong> {invoice.sourceType} — {invoice.originalFilename || '-'}
                  {invoice.extractionModel && (
                    <span style={{ marginLeft: '1rem' }}>
                      <strong>Model:</strong> {invoice.extractionModel}
                      {invoice.extractionRetried && <span style={{ color: '#e67e22', marginLeft: '0.5rem' }} title="Required retry with better model">(retried)</span>}
                      {invoice.mathCorrections > 0 && <span style={{ color: '#e67e22', marginLeft: '0.5rem' }}>{invoice.mathCorrections} math fix{invoice.mathCorrections > 1 ? 'es' : ''}</span>}
                      {invoice.extractionDurationMs != null && <span style={{ marginLeft: '0.5rem' }}>{(invoice.extractionDurationMs / 1000).toFixed(1)}s</span>}
                    </span>
                  )}
                </div>
              </div>

              {/* ── Invoice Lines ── */}
              <div className="card">
                <h3>Invoice Lines</h3>
                {viewLines.length > 0 ? (
                  <div style={{ maxHeight: '45vh', overflowY: 'auto', overflowX: 'auto' }}>
                  <table>
                    <thead style={{ position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
                      <tr>
                        <th>#</th>
                        <th>Product Code</th>
                        <th>Description</th>
                        <th>Qty</th>
                        <th>Unit</th>
                        <th>Unit Price</th>
                        <th>VAT %</th>
                        <th>Net</th>
                        <th>Gross</th>
                        <th>Match</th>
                        {canEdit && <th></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {viewLines.map((line, idx) => {
                        const hasError = lineErrors[idx] && lineErrors[idx].length > 0;
                        const isEditingThis = editingLineIdx === idx;
                        const errBorder = hasError ? { border: '1px solid #e74c3c', background: '#fff0f0' } : {};
                        const origLine = invoice?.lines?.[idx];

                        if (canEdit && isEditingThis) {
                          // ── Active edit row ──
                          return (
                            <tr
                              key={idx}
                              style={{ backgroundColor: hasError ? '#fff0f0' : '#f0f7ff' }}
                              title={hasError ? lineErrors[idx].join('; ') : undefined}
                              onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) commitLineEdit(); }}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') { e.preventDefault(); cancelLineEdit(); }
                                if (e.key === 'Enter') { e.preventDefault(); commitLineEdit(); }
                              }}
                            >
                              <td style={{ color: '#888', fontSize: '0.85em' }}>{idx + 1}</td>
                              <td><input style={cellInputStyle} value={line.productCode} onChange={(e) => updatePendingLine(idx, 'productCode', e.target.value)} /></td>
                              <td><input style={{ ...cellInputStyle, minWidth: '140px' }} value={line.description} onChange={(e) => updatePendingLine(idx, 'description', e.target.value)} /></td>
                              <td><input type="number" step="any" style={{ ...cellInputStyle, width: '65px', ...errBorder }} value={line.qty} onChange={(e) => updatePendingLine(idx, 'qty', e.target.value)} /></td>
                              <td><input style={{ ...cellInputStyle, width: '45px' }} value={line.unit} onChange={(e) => updatePendingLine(idx, 'unit', e.target.value)} /></td>
                              <td><input type="number" step="any" style={{ ...cellInputStyle, width: '85px', ...errBorder }} value={line.unitPrice} onChange={(e) => updatePendingLine(idx, 'unitPrice', e.target.value)} /></td>
                              <td><input type="number" step="any" style={{ ...cellInputStyle, width: '55px' }} value={line.vatRate} onChange={(e) => updatePendingLine(idx, 'vatRate', e.target.value)} /></td>
                              <td><input type="number" step="0.01" style={{ ...cellInputStyle, width: '75px' }} value={line.net} onChange={(e) => updatePendingLine(idx, 'net', e.target.value)} /></td>
                              <td><input type="number" step="0.01" style={{ ...cellInputStyle, width: '75px' }} value={line.gross} onChange={(e) => updatePendingLine(idx, 'gross', e.target.value)} /></td>
                              <td><span style={{ color: '#999' }}>—</span></td>
                              <td>
                                <button onClick={() => deleteLine(idx)} style={{ background: 'none', border: 'none', color: '#e74c3c', cursor: 'pointer', fontSize: '1.1rem', padding: '0.15rem 0.3rem' }} title="Remove row">×</button>
                              </td>
                            </tr>
                          );
                        }

                        // ── View row (with optional double-click to edit) ──
                        return (
                          <tr
                            key={origLine?.id || idx}
                            style={{ backgroundColor: hasError ? '#fff3f3' : undefined }}
                            title={hasError ? lineErrors[idx].join('; ') : (canEdit ? 'Double-click to edit row' : undefined)}
                            onDoubleClick={canEdit ? () => startLineEdit(idx) : undefined}
                          >
                            <td>{origLine?.rowNo ?? idx + 1}</td>
                            <td>{line.productCode || '-'}</td>
                            <td>{line.description || '-'}</td>
                            <td style={hasError ? { color: '#e74c3c', fontWeight: 'bold' } : undefined}>{line.qty != null && line.qty !== '' ? line.qty : '-'}</td>
                            <td>{line.unit || '-'}</td>
                            <td style={hasError ? { color: '#e74c3c', fontWeight: 'bold' } : undefined}>
                              {line.unitPrice != null && line.unitPrice !== '' ? (typeof line.unitPrice === 'number' ? line.unitPrice.toFixed(4) : Number(line.unitPrice).toFixed(4)) : '-'}
                            </td>
                            <td>{line.vatRate != null && line.vatRate !== '' ? `${line.vatRate}%` : '-'}</td>
                            <td>{line.net != null && line.net !== '' ? Number(line.net).toFixed(2) : '-'}</td>
                            <td>{line.gross != null && line.gross !== '' ? Number(line.gross).toFixed(2) : '-'}</td>
                            <td>
                              {origLine?.matchData ? (
                                <span className={`status-badge ${origLine.matchData.confidence >= 0.95 ? 'status-approved' : origLine.matchData.confidence >= 0.75 ? 'status-needs_review' : 'status-rejected'}`}>
                                  {Math.round((origLine.matchData.confidence || 0) * 100)}%
                                </span>
                              ) : <span style={{ color: '#999' }}>—</span>}
                            </td>
                            {canEdit && (
                              <td>
                                <button
                                  onClick={(e) => { e.stopPropagation(); deleteLine(idx); }}
                                  style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', fontSize: '1rem', padding: '0.15rem 0.3rem' }}
                                  onMouseEnter={(e) => { e.currentTarget.style.color = '#e74c3c'; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.color = '#ccc'; }}
                                  title="Remove row"
                                >
                                  ×
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                    {viewLines.length > 0 && (!netMatches || !grossMatches) && (
                      <tfoot>
                        <tr style={{ fontWeight: 'bold', fontSize: '0.9em', borderTop: '2px solid #ccc' }}>
                          <td colSpan={7} style={{ textAlign: 'right' }}>Row sums:</td>
                          <td style={{ color: netMatches ? '#27ae60' : '#e74c3c' }}>{rowNetSum.toFixed(2)}</td>
                          <td style={{ color: grossMatches ? '#27ae60' : '#e74c3c' }}>{rowGrossSum.toFixed(2)}</td>
                          <td></td>
                          {canEdit && <td></td>}
                        </tr>
                      </tfoot>
                    )}
                  </table>
                  </div>
                ) : (
                  <p style={{ color: '#999' }}>No invoice lines.</p>
                )}
                {canEdit && (
                  <button
                    className="btn"
                    onClick={addLine}
                    style={{ marginTop: '0.5rem', fontSize: '0.85rem', backgroundColor: '#ecf0f1', color: '#333' }}
                  >
                    + Add Row
                  </button>
                )}
              </div>

              {/* ── Approval Actions ── */}
              <ApprovalActions invoice={invoice} user={user} onActionComplete={fetchInvoice} />

              {/* ── Approval History ── */}
              <ApprovalHistory invoiceId={id} />

              {/* ── Processing Log ── */}
              {['needs_review', 'ready', 'failed'].includes(invoice.status) && (
                <details className="card" style={{ cursor: 'pointer' }}>
                  <summary style={{ fontWeight: 'bold', padding: '0.5rem 0' }}>Processing Log</summary>
                  <ProcessingStatus invoiceId={id} />
                </details>
              )}
            </>
          )}

          {/* ── Sticky Save Bar ── */}
          {hasPendingChanges && (
            <div style={{
              position: 'sticky',
              bottom: 0,
              background: '#fff',
              borderTop: '2px solid #3498db',
              padding: '0.75rem 1rem',
              display: 'flex',
              gap: '0.75rem',
              alignItems: 'center',
              boxShadow: '0 -2px 8px rgba(0,0,0,0.1)',
              zIndex: 100,
              marginTop: '1rem',
            }}>
              <span style={{ flex: 1, color: '#555', fontSize: '0.9rem' }}>Unsaved changes</span>
              <button className="btn btn-primary" onClick={saveAll} disabled={saving} style={{ fontSize: '0.85rem' }}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button className="btn" onClick={discardAll} disabled={saving} style={{ fontSize: '0.85rem', backgroundColor: '#ecf0f1', color: '#333' }}>
                Discard
              </button>
            </div>
          )}
        </div>

        {/* ── Resize Handle ── */}
        {showPdf && (
          <div
            onMouseDown={handleMouseDown}
            style={{ width: '6px', cursor: 'col-resize', backgroundColor: '#ddd', borderRadius: '3px', marginTop: '1rem', marginBottom: '1rem', flexShrink: 0, transition: 'background-color 0.15s' }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#aaa'; }}
            onMouseLeave={(e) => { if (!isDragging.current) e.currentTarget.style.backgroundColor = '#ddd'; }}
          />
        )}

        {/* ── PDF Sidebar ── */}
        {showPdf && (
          <div style={{ flex: 1, position: 'sticky', top: '1rem', alignSelf: 'flex-start', height: 'calc(100vh - 5rem)', marginTop: '1rem', border: '1px solid #ddd', borderRadius: '8px', overflow: 'hidden', backgroundColor: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {pdfBlobUrl
              ? <iframe src={pdfBlobUrl} title="Invoice PDF" style={{ width: '100%', height: '100%', border: 'none' }} />
              : <p style={{ color: '#999' }}>Loading PDF...</p>}
          </div>
        )}
      </div>
    </div>
  );
}

export default InvoiceDetail;
