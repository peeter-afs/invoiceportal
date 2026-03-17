import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { invoiceAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import './Dashboard.css';

const STATUS_OPTIONS = [
  'all', 'queued', 'processing', 'needs_review', 'ready',
  'pending_approval', 'approved', 'rejected', 'exporting', 'exported', 'failed',
];

function InvoiceList() {
  const { logout } = useAuth();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    fetchInvoices();
  }, []);

  const fetchInvoices = async () => {
    try {
      const response = await invoiceAPI.getAll();
      setInvoices(response.data);
    } catch (error) {
      console.error('Error fetching invoices:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (window.confirm('Are you sure you want to delete this invoice?')) {
      try {
        await invoiceAPI.delete(id);
        setInvoices(invoices.filter((inv) => inv._id !== id));
      } catch (error) {
        console.error('Error deleting invoice:', error);
        alert('Failed to delete invoice');
      }
    }
  };

  const filteredInvoices = filter === 'all'
    ? invoices
    : invoices.filter((inv) => inv.status === filter);

  return (
    <div>
      <nav className="navbar">
        <h1>Invoice Portal</h1>
        <div>
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/invoices">Invoices</Link>
          <Link to="/invoices/upload">Upload Invoice</Link>
          <Link to="/invoices/create">Create Manually</Link>
          <button className="btn btn-danger" onClick={logout}>
            Logout
          </button>
        </div>
      </nav>

      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2>Invoices</h2>
          <div>
            <label htmlFor="filter" style={{ marginRight: '0.5rem' }}>Filter by status:</label>
            <select
              id="filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #ddd' }}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s === 'all' ? 'All' : s.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <p>Loading...</p>
        ) : filteredInvoices.length === 0 ? (
          <div className="card">
            <p>No invoices found.</p>
            <Link to="/invoices/create" className="btn btn-primary">
              Create your first invoice
            </Link>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Supplier</th>
                <th>Due Date</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Model</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.map((invoice) => (
                <tr key={invoice._id}>
                  <td>
                    <Link to={`/invoices/${invoice._id}`}>{invoice.invoiceNumber || '—'}</Link>
                  </td>
                  <td>{invoice.supplierName}</td>
                  <td>{invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : '-'}</td>
                  <td>{invoice.grossTotal != null ? `${invoice.grossTotal.toFixed(2)}` : '-'}</td>
                  <td>
                    <span className={`status-badge status-${invoice.status}`}>
                      {invoice.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.8rem', color: '#666' }}>
                    {invoice.extractionModel || '-'}
                    {invoice.extractionRetried && <span style={{ color: '#e67e22' }} title="Retried with better model"> R</span>}
                    {invoice.mathCorrections > 0 && <span style={{ color: '#e67e22' }} title={`${invoice.mathCorrections} math correction(s)`}> M{invoice.mathCorrections}</span>}
                  </td>
                  <td>
                    <button
                      className="btn btn-danger"
                      onClick={() => handleDelete(invoice._id)}
                      style={{ fontSize: '0.85rem', padding: '0.25rem 0.75rem' }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default InvoiceList;
