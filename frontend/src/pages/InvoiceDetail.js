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

function InvoiceDetail() {
  const { logout, user } = useAuth();
  const { id } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showPdf, setShowPdf] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null);
  const [leftPanelWidth, setLeftPanelWidth] = useState(50); // percentage
  const isDragging = useRef(false);
  const containerRef = useRef(null);
  const [suppliers, setSuppliers] = useState([]);
  const [editingSupplier, setEditingSupplier] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState('');

  // Resize drag handlers
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

  const handleSaveSupplier = async () => {
    try {
      await invoiceAPI.update(id, { supplierId: selectedSupplierId || null });
      setEditingSupplier(false);
      fetchInvoice();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update supplier');
    }
  };

  useEffect(() => {
    fetchInvoice();
    // Poll while processing
    let interval;
    const startPolling = () => {
      interval = setInterval(async () => {
        try {
          const res = await invoiceAPI.getById(id);
          setInvoice(res.data);
          if (!['queued', 'processing'].includes(res.data.status)) {
            clearInterval(interval);
          }
        } catch {
          clearInterval(interval);
        }
      }, 3000);
    };
    startPolling();
    return () => clearInterval(interval);
  }, [id, fetchInvoice]);

  // Load PDF blob when sidebar is opened
  useEffect(() => {
    if (!showPdf || pdfBlobUrl) return;
    let revoked = false;
    invoiceAPI.getFile(id)
      .then((res) => {
        if (revoked) return;
        const url = URL.createObjectURL(res.data);
        setPdfBlobUrl(url);
      })
      .catch(() => {});
    return () => { revoked = true; };
  }, [showPdf, id, pdfBlobUrl]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    };
  }, [pdfBlobUrl]);

  if (loading) return <div className="container"><p>Loading...</p></div>;
  if (error) return <div className="container"><div className="error">{error}</div></div>;
  if (!invoice) return null;

  const isProcessing = ['queued', 'processing'].includes(invoice.status);

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

      <div ref={containerRef} style={{ display: 'flex', padding: '0 1rem', maxWidth: showPdf ? '100%' : '1100px', margin: '0 auto' }}>
        {/* Left: Invoice data */}
        <div style={{ width: showPdf ? `${leftPanelWidth}%` : '100%', flexShrink: 0, minWidth: 0, paddingRight: showPdf ? '0.5rem' : 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', marginTop: '1rem' }}>
            <h2>Invoice Detail</h2>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button
                className="btn"
                onClick={() => setShowPdf(!showPdf)}
                style={{ backgroundColor: showPdf ? '#2c3e50' : '#ecf0f1', color: showPdf ? 'white' : '#333', fontSize: '0.85rem' }}
              >
                {showPdf ? 'Hide PDF' : 'Show PDF'}
              </button>
              <span className={`status-badge status-${invoice.status}`}>
                {STATUS_LABEL[invoice.status] || invoice.status}
              </span>
            </div>
          </div>

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

          {/* Invoice Header */}
          {!isProcessing && (
            <>
              <div className="card">
                <h3>Supplier</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <strong>Name:</strong><br />
                    {editingSupplier ? (
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.25rem' }}>
                        <select
                          value={selectedSupplierId}
                          onChange={(e) => setSelectedSupplierId(e.target.value)}
                          style={{ flex: 1, padding: '0.35rem' }}
                        >
                          <option value="">— unlinked —</option>
                          {suppliers.map((s) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                        <button className="btn btn-primary" style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }} onClick={handleSaveSupplier}>Save</button>
                        <button className="btn" style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }} onClick={() => setEditingSupplier(false)}>Cancel</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        {invoice.supplierId ? (
                          <Link to={`/suppliers/${invoice.supplierId}`}>{invoice.supplierName || '-'}</Link>
                        ) : (
                          <span style={{ color: invoice.supplierName ? 'inherit' : '#999' }}>{invoice.supplierName || 'unlinked'}</span>
                        )}
                        <button
                          className="btn"
                          style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', backgroundColor: '#ecf0f1', color: '#333' }}
                          onClick={() => { setSelectedSupplierId(invoice.supplierId || ''); setEditingSupplier(true); }}
                        >
                          Change
                        </button>
                      </div>
                    )}
                  </div>
                  <div>
                    <strong>Address:</strong><br />{invoice.supplierAddress || '-'}
                  </div>
                  {invoice.supplierRegNumber && (
                    <div>
                      <strong>Reg. Number:</strong><br />{invoice.supplierRegNumber}
                    </div>
                  )}
                  {invoice.supplierVatNumber && (
                    <div>
                      <strong>VAT Number:</strong><br />{invoice.supplierVatNumber}
                    </div>
                  )}
                  {invoice.futursoftSupplierNr && (
                    <div>
                      <strong>Futursoft #:</strong><br />{invoice.futursoftSupplierNr}
                    </div>
                  )}
                  {invoice.supplierBankAccount && (
                    <div>
                      <strong>Bank Account:</strong><br />{invoice.supplierBankAccount}
                    </div>
                  )}
                </div>
              </div>

              <div className="card">
                <h3>Invoice Information</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <strong>Invoice Number:</strong><br />{invoice.invoiceNumber || '-'}
                  </div>
                  <div>
                    <strong>Invoice Date:</strong><br />
                    {invoice.invoiceDate ? new Date(invoice.invoiceDate).toLocaleDateString() : '-'}
                  </div>
                  <div>
                    <strong>Due Date:</strong><br />
                    {invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : '-'}
                  </div>
                  <div>
                    <strong>Currency:</strong><br />{invoice.currency || '-'}
                  </div>
                  {invoice.referenceNumber && (
                    <div>
                      <strong>Reference Number:</strong><br />{invoice.referenceNumber}
                    </div>
                  )}
                  {invoice.purchaseOrderNr && (
                    <div>
                      <strong>Purchase Order #:</strong><br />{invoice.purchaseOrderNr}
                    </div>
                  )}
                  {invoice.paymentTerms && (
                    <div>
                      <strong>Payment Terms:</strong><br />{invoice.paymentTerms}
                    </div>
                  )}
                  {invoice.penaltyRate && (
                    <div>
                      <strong>Penalty Rate:</strong><br />{invoice.penaltyRate}
                    </div>
                  )}
                  {invoice.deliveryDate && (
                    <div>
                      <strong>Delivery Date:</strong><br />
                      {new Date(invoice.deliveryDate).toLocaleDateString()}
                    </div>
                  )}
                  {invoice.deliveryMethod && (
                    <div>
                      <strong>Delivery Method:</strong><br />{invoice.deliveryMethod}
                    </div>
                  )}
                  {invoice.deliveryNoteNr && (
                    <div>
                      <strong>Delivery Note #:</strong><br />{invoice.deliveryNoteNr}
                    </div>
                  )}
                  {invoice.buyerReference && (
                    <div>
                      <strong>Our Reference:</strong><br />{invoice.buyerReference}
                    </div>
                  )}
                  {invoice.sellerReference && (
                    <div>
                      <strong>Their Reference:</strong><br />{invoice.sellerReference}
                    </div>
                  )}
                </div>
              </div>

              <div className="card">
                <h3>Totals</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                  <div>
                    <strong>Net Total:</strong><br />
                    {invoice.netTotal != null ? `${invoice.netTotal.toFixed(2)} ${invoice.currency || ''}` : '-'}
                  </div>
                  <div>
                    <strong>VAT Total:</strong><br />
                    {invoice.vatTotal != null ? `${invoice.vatTotal.toFixed(2)} ${invoice.currency || ''}` : '-'}
                  </div>
                  <div>
                    <strong>Gross Total:</strong><br />
                    {invoice.grossTotal != null ? `${invoice.grossTotal.toFixed(2)} ${invoice.currency || ''}` : '-'}
                  </div>
                </div>
                <div style={{ marginTop: '0.75rem', color: '#666', fontSize: '0.9em' }}>
                  <strong>Source:</strong> {invoice.sourceType} — {invoice.originalFilename || '-'}
                </div>
              </div>

              {/* Invoice Lines */}
              {invoice.lines && invoice.lines.length > 0 && (
                <div className="card" style={{ overflowX: 'auto' }}>
                  <h3>Invoice Lines</h3>
                  <table>
                    <thead>
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
                      </tr>
                    </thead>
                    <tbody>
                      {invoice.lines.map((line) => (
                        <tr key={line.id}>
                          <td>{line.rowNo}</td>
                          <td>{line.productCode || '-'}</td>
                          <td>{line.description || '-'}</td>
                          <td>{line.qty != null ? line.qty : '-'}</td>
                          <td>{line.unit || '-'}</td>
                          <td>{line.unitPrice != null ? line.unitPrice.toFixed(4) : '-'}</td>
                          <td>{line.vatRate != null ? `${line.vatRate}%` : '-'}</td>
                          <td>{line.net != null ? line.net.toFixed(2) : '-'}</td>
                          <td>{line.gross != null ? line.gross.toFixed(2) : '-'}</td>
                          <td>
                            {line.matchData ? (
                              <span className={`status-badge ${
                                line.matchData.confidence >= 0.95 ? 'status-approved' :
                                line.matchData.confidence >= 0.75 ? 'status-needs_review' :
                                'status-rejected'
                              }`}>
                                {Math.round((line.matchData.confidence || 0) * 100)}%
                              </span>
                            ) : (
                              <span style={{ color: '#999' }}>—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Workflow Actions */}
              {['needs_review', 'ready', 'approved'].includes(invoice.status) && (
                <div className="card">
                  <h3>Workflow Actions</h3>
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <Link to={`/invoices/${id}/matching`} className="btn btn-primary">
                      Row Matching
                    </Link>
                    {invoice.workflowConfig?.orderProposal && (
                      <Link to={`/invoices/${id}/matching`} className="btn" style={{ backgroundColor: '#2980b9', color: 'white' }}>
                        Order Proposal
                      </Link>
                    )}
                    {invoice.workflowConfig?.orderConfirmation && (
                      <button className="btn" style={{ backgroundColor: '#f39c12', color: 'white' }} disabled>
                        Order Confirmation
                      </button>
                    )}
                    {invoice.workflowConfig?.order && (
                      <button className="btn" style={{ backgroundColor: '#e67e22', color: 'white' }} disabled>
                        Order
                      </button>
                    )}
                    {invoice.workflowConfig?.receiving && invoice.purchaseOrderNr && (
                      <Link to={`/invoices/${id}/receiving`} className="btn" style={{ backgroundColor: '#27ae60', color: 'white' }}>
                        Receiving Preview
                      </Link>
                    )}
                    {invoice.purchaseOrderNr && (
                      <Link to={`/invoices/${id}/consolidation`} className="btn" style={{ backgroundColor: '#8e44ad', color: 'white' }}>
                        Cross-Order Consolidation
                      </Link>
                    )}
                  </div>
                </div>
              )}

              {/* Approval Actions */}
              <ApprovalActions
                invoice={invoice}
                user={user}
                onActionComplete={fetchInvoice}
              />

              {/* Approval History */}
              <ApprovalHistory invoiceId={id} />

              {/* Processing logs (collapsed by default) */}
              {['needs_review', 'ready', 'failed'].includes(invoice.status) && (
                <details className="card" style={{ cursor: 'pointer' }}>
                  <summary style={{ fontWeight: 'bold', padding: '0.5rem 0' }}>Processing Log</summary>
                  <ProcessingStatus invoiceId={id} />
                </details>
              )}
            </>
          )}
        </div>

        {/* Resize Handle */}
        {showPdf && (
          <div
            onMouseDown={handleMouseDown}
            style={{
              width: '6px',
              cursor: 'col-resize',
              backgroundColor: '#ddd',
              borderRadius: '3px',
              marginTop: '1rem',
              marginBottom: '1rem',
              flexShrink: 0,
              transition: 'background-color 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#aaa'; }}
            onMouseLeave={(e) => { if (!isDragging.current) e.currentTarget.style.backgroundColor = '#ddd'; }}
          />
        )}

        {/* Right: PDF Preview Sidebar */}
        {showPdf && (
          <div style={{
            flex: 1,
            position: 'sticky',
            top: '1rem',
            alignSelf: 'flex-start',
            height: 'calc(100vh - 5rem)',
            marginTop: '1rem',
            border: '1px solid #ddd',
            borderRadius: '8px',
            overflow: 'hidden',
            backgroundColor: '#f5f5f5',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {pdfBlobUrl ? (
              <iframe
                src={pdfBlobUrl}
                title="Invoice PDF"
                style={{ width: '100%', height: '100%', border: 'none' }}
              />
            ) : (
              <p style={{ color: '#999' }}>Loading PDF...</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default InvoiceDetail;
