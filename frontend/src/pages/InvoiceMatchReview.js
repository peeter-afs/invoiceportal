import React, { useState, useEffect, useCallback } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { invoiceAPI, futursoftAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import './Dashboard.css';

function ConfidenceBadge({ confidence }) {
  if (confidence == null) return <span style={{ color: '#999' }}>—</span>;
  const pct = Math.round(confidence * 100);
  const cls = confidence >= 0.95 ? 'status-approved' : confidence >= 0.75 ? 'status-needs_review' : 'status-rejected';
  return <span className={`status-badge ${cls}`}>{pct}%</span>;
}

function InvoiceMatchReview() {
  const { logout } = useAuth();
  const { id } = useParams();
  const navigate = useNavigate();
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [matchLoading, setMatchLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchModal, setSearchModal] = useState(null); // { lineId, rowNo }
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const fetchMatches = useCallback(async () => {
    try {
      const res = await invoiceAPI.getMatches(id);
      setMatches(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load matches');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchMatches(); }, [fetchMatches]);

  const triggerMatch = async () => {
    setMatchLoading(true);
    setError('');
    try {
      await invoiceAPI.triggerMatch(id);
      await fetchMatches();
    } catch (err) {
      setError(err.response?.data?.error || 'Matching failed');
    } finally {
      setMatchLoading(false);
    }
  };

  const searchProducts = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await futursoftAPI.searchProducts(searchQuery);
      setSearchResults(Array.isArray(res.data) ? res.data : []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const selectProduct = async (product) => {
    if (!searchModal) return;
    try {
      await invoiceAPI.overrideMatch(id, searchModal.lineId, {
        matchedProductCode: product.productCode,
        matchedProductName: product.productName,
      });
      setSearchModal(null);
      setSearchQuery('');
      setSearchResults([]);
      await fetchMatches();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to override match');
    }
  };

  const allMatched = matches.length > 0 && matches.every((m) => m.match?.confidence >= 0.75);

  if (loading) return <div className="container"><p>Loading...</p></div>;

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
          <h2>Row Matching</h2>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-primary" onClick={triggerMatch} disabled={matchLoading}>
              {matchLoading ? 'Matching...' : 'Run Matching'}
            </button>
            <Link to={`/invoices/${id}`} className="btn" style={{ backgroundColor: '#95a5a6', color: 'white' }}>
              Back to Invoice
            </Link>
          </div>
        </div>

        {error && <div className="error" style={{ marginBottom: '1rem' }}>{error}</div>}

        {matches.length === 0 ? (
          <div className="card"><p>No lines to match. Run matching first.</p></div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Product Code</th>
                <th>Description</th>
                <th>Qty</th>
                <th>Unit Price</th>
                <th>Net</th>
                <th>Confidence</th>
                <th>Method</th>
                <th>Matched To</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m) => (
                <tr key={m.lineId}>
                  <td>{m.rowNo}</td>
                  <td>{m.productCode || '-'}</td>
                  <td>{m.description || '-'}</td>
                  <td>{m.qty != null ? m.qty : '-'}</td>
                  <td>{m.unitPrice != null ? m.unitPrice.toFixed(2) : '-'}</td>
                  <td>{m.net != null ? m.net.toFixed(2) : '-'}</td>
                  <td><ConfidenceBadge confidence={m.match?.confidence} /></td>
                  <td style={{ fontSize: '0.8rem', color: '#666' }}>
                    {m.match?.matchMethod?.replace(/_/g, ' ') || '-'}
                  </td>
                  <td>
                    {m.match?.matchedProductCode ? (
                      <span>{m.match.matchedProductCode} {m.match.matchedProductName ? `— ${m.match.matchedProductName}` : ''}</span>
                    ) : '-'}
                  </td>
                  <td>
                    <button
                      className="btn"
                      style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem', backgroundColor: '#3498db', color: 'white' }}
                      onClick={() => { setSearchModal({ lineId: m.lineId, rowNo: m.rowNo }); setSearchQuery(m.productCode || m.description || ''); }}
                    >
                      Match
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {allMatched && (
          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
            <button
              className="btn btn-primary"
              onClick={() => navigate(`/invoices/${id}/receiving`)}
            >
              Proceed to Receiving
            </button>
            <button
              className="btn"
              style={{ backgroundColor: '#8e44ad', color: 'white' }}
              onClick={() => navigate(`/invoices/${id}/consolidation`)}
            >
              Review Consolidation
            </button>
          </div>
        )}
      </div>

      {/* Product Search Modal */}
      {searchModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{ background: 'white', borderRadius: '8px', padding: '2rem', width: '600px', maxHeight: '80vh', overflow: 'auto' }}>
            <h3>Search Products — Line #{searchModal.rowNo}</h3>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              <input
                type="text" value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchProducts()}
                placeholder="Search by code or name..."
                style={{ flex: 1, padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
              />
              <button className="btn btn-primary" onClick={searchProducts} disabled={searching}>
                {searching ? '...' : 'Search'}
              </button>
            </div>
            {searchResults.length > 0 && (
              <table style={{ fontSize: '0.85rem' }}>
                <thead><tr><th>Code</th><th>Name</th><th>EAN</th><th></th></tr></thead>
                <tbody>
                  {searchResults.map((p) => (
                    <tr key={p.productCode}>
                      <td>{p.productCode}</td>
                      <td>{p.productName}</td>
                      <td>{p.ean || '-'}</td>
                      <td>
                        <button className="btn btn-primary" style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem' }}
                          onClick={() => selectProduct(p)}>Select</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {searchResults.length === 0 && !searching && <p style={{ color: '#666' }}>No results. Try a different search term.</p>}
            <button className="btn" style={{ marginTop: '1rem', backgroundColor: '#95a5a6', color: 'white' }}
              onClick={() => { setSearchModal(null); setSearchResults([]); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default InvoiceMatchReview;
