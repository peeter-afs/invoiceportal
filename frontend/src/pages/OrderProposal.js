import React, { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { invoiceAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import './Dashboard.css';

const ORDER_TYPES = [
  { value: 1, label: 'Daily Order' },
  { value: 2, label: 'Weekly Order' },
  { value: 3, label: 'Period Order' },
];

function OrderProposal() {
  const { logout } = useAuth();
  const { id } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [orderTypeCode, setOrderTypeCode] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

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
    fetchInvoice();
  }, [fetchInvoice]);

  const handleCreateProposal = async () => {
    setSubmitting(true);
    setError('');
    try {
      const res = await invoiceAPI.createProposal(id, orderTypeCode);
      setResult(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create order proposal');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="container"><p>Loading...</p></div>;
  if (!invoice) return <div className="container"><div className="error">{error}</div></div>;

  const canCreate = invoice.supplierId && invoice.futursoftSupplierNr && invoice.lines?.length > 0;

  return (
    <div>
      <nav className="navbar">
        <h1>Invoice Portal</h1>
        <div>
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/invoices">Invoices</Link>
          <button className="btn btn-danger" onClick={logout}>Logout</button>
        </div>
      </nav>

      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2>Order Proposal</h2>
          <Link to={`/invoices/${id}`} className="btn" style={{ fontSize: '0.85rem' }}>
            &larr; Back to Invoice
          </Link>
        </div>

        {error && <div className="error" style={{ marginBottom: '1rem' }}>{error}</div>}

        {result && (
          <div className="card" style={{ borderLeft: '4px solid #27ae60', marginBottom: '1rem' }}>
            <h3 style={{ color: '#27ae60', marginBottom: '0.5rem' }}>Proposal Created</h3>
            <p>
              Purchase Order #{result.purchaseOrderNr || 'N/A'}
              {' — '}Status: {result.status || 'PROPOSAL'}
            </p>
          </div>
        )}

        {/* Supplier Info */}
        <div className="card">
          <h3>Supplier</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <strong>Name:</strong><br />{invoice.supplierName || '-'}
            </div>
            <div>
              <strong>Futursoft Supplier #:</strong><br />
              {invoice.futursoftSupplierNr ? (
                <span style={{ color: '#27ae60', fontWeight: 'bold' }}>{invoice.futursoftSupplierNr}</span>
              ) : (
                <span style={{ color: '#e74c3c' }}>Not set</span>
              )}
            </div>
          </div>

          {!invoice.supplierId && (
            <div style={{ marginTop: '0.75rem', padding: '0.5rem', backgroundColor: '#fff3cd', borderRadius: '4px', color: '#856404' }}>
              Supplier is not linked to the registry. Go back to the invoice and link a supplier first.
            </div>
          )}
          {invoice.supplierId && !invoice.futursoftSupplierNr && (
            <div style={{ marginTop: '0.75rem', padding: '0.5rem', backgroundColor: '#fff3cd', borderRadius: '4px', color: '#856404' }}>
              Supplier has no Futursoft supplier number. Set it on the invoice detail or supplier page first.
            </div>
          )}
        </div>

        {/* Invoice Lines */}
        <div className="card" style={{ overflowX: 'auto' }}>
          <h3>Lines to include in proposal</h3>
          {invoice.lines && invoice.lines.length > 0 ? (
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
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ color: '#999' }}>No invoice lines.</p>
          )}
        </div>

        {/* Order Type + Submit */}
        {!result && (
          <div className="card">
            <h3>Create Proposal</h3>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <label htmlFor="orderType" style={{ fontWeight: 'bold', marginRight: '0.5rem' }}>Order Type:</label>
                <select
                  id="orderType"
                  value={orderTypeCode}
                  onChange={(e) => setOrderTypeCode(Number(e.target.value))}
                  style={{ padding: '0.4rem', fontSize: '0.9rem' }}
                >
                  {ORDER_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <button
                className="btn btn-primary"
                onClick={handleCreateProposal}
                disabled={!canCreate || submitting}
              >
                {submitting ? 'Creating...' : 'Create Proposal'}
              </button>
            </div>
            {!canCreate && !error && (
              <p style={{ color: '#999', marginTop: '0.5rem', fontSize: '0.9em' }}>
                Cannot create proposal — ensure supplier is linked with a Futursoft supplier number and invoice has lines.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default OrderProposal;
