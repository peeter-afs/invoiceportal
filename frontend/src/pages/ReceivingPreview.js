import React, { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { invoiceAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import './Dashboard.css';

function ReceivingPreview() {
  const { logout } = useAuth();
  const { id } = useParams();
  const navigate = useNavigate();
  const [preview, setPreview] = useState(null);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    invoiceAPI.getReceivingPreview(id)
      .then((res) => {
        setPreview(res.data);
        setLines(res.data.lines || []);
      })
      .catch((err) => setError(err.response?.data?.error || 'Failed to load receiving preview'))
      .finally(() => setLoading(false));
  }, [id]);

  const updateLine = (idx, field, value) => {
    setLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const handlePost = async () => {
    setPosting(true);
    setError('');
    try {
      const res = await invoiceAPI.postReceiving(id, lines);
      setResult(res.data);
      if (res.data.allSucceeded) {
        setTimeout(() => navigate(`/invoices/${id}`), 2000);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Receiving failed');
    } finally {
      setPosting(false);
    }
  };

  if (loading) return <div className="container"><p>Loading...</p></div>;
  if (error && !preview) return <div className="container"><div className="error">{error}</div></div>;

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
          <h2>Receiving Preview</h2>
          <span style={{ color: '#666' }}>PO: {preview?.purchaseOrderNr} · {preview?.currency}</span>
        </div>

        {result && (
          <div className="card" style={{ borderLeft: `4px solid ${result.allSucceeded ? '#27ae60' : '#e74c3c'}` }}>
            <h3>{result.allSucceeded ? 'Receiving posted successfully!' : 'Receiving completed with errors'}</h3>
            {result.results.map((r, i) => (
              <div key={i} style={{ fontSize: '0.85rem', color: r.success ? '#27ae60' : '#e74c3c' }}>
                Row {r.rowNo}: {r.success ? 'OK' : r.error}
              </div>
            ))}
          </div>
        )}

        {!result && (
          <>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Product Code</th>
                  <th>Description</th>
                  <th>Invoice Qty</th>
                  <th>Receiving Qty</th>
                  <th>Price</th>
                  <th>VAT %</th>
                  <th>Cancelled</th>
                  <th>Shelf Code</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => (
                  <tr key={line.lineId}>
                    <td>{line.rowNo}</td>
                    <td>{line.productCode || '-'}</td>
                    <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{line.description}</td>
                    <td>{line.invoiceQty}</td>
                    <td>
                      <input
                        type="number" step="0.001" min="0"
                        value={line.receivingQty}
                        onChange={(e) => updateLine(idx, 'receivingQty', parseFloat(e.target.value) || 0)}
                        style={{ width: '80px', padding: '0.25rem', border: '1px solid #ddd', borderRadius: '4px' }}
                      />
                    </td>
                    <td>{line.purchasePrice.toFixed(2)}</td>
                    <td>{line.vatRate}%</td>
                    <td>
                      <input
                        type="number" step="0.001" min="0"
                        value={line.canceledQuantity}
                        onChange={(e) => updateLine(idx, 'canceledQuantity', parseFloat(e.target.value) || 0)}
                        style={{ width: '70px', padding: '0.25rem', border: '1px solid #ddd', borderRadius: '4px' }}
                      />
                    </td>
                    <td>
                      <input
                        type="text" value={line.shelfCode}
                        onChange={(e) => updateLine(idx, 'shelfCode', e.target.value)}
                        style={{ width: '80px', padding: '0.25rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        placeholder="e.g. A1"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {error && <div className="error" style={{ marginTop: '1rem' }}>{error}</div>}

            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem' }}>
              <button className="btn btn-primary" onClick={handlePost} disabled={posting}>
                {posting ? 'Posting...' : 'Post Receiving'}
              </button>
              <Link to={`/invoices/${id}`} className="btn" style={{ backgroundColor: '#95a5a6', color: 'white' }}>
                Cancel
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ReceivingPreview;
