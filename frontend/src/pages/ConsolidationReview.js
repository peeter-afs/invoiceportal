import React, { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { invoiceAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import './Dashboard.css';

const ACTION_OPTIONS = [
  { value: 'accept', label: 'Accept match' },
  { value: 'move', label: 'Move to current PO' },
  { value: 'add_new', label: 'Add as new row' },
  { value: 'manual', label: 'Manual handling' },
];

function ConsolidationReview() {
  const { logout } = useAuth();
  const { id } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState(null);
  const [actions, setActions] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    invoiceAPI.getConsolidation(id)
      .then((res) => {
        setState(res.data);
        // Default all lines to 'accept'
        const defaultActions = {};
        for (const poNr of Object.keys(res.data.groups || {})) {
          for (const line of res.data.groups[poNr]) {
            defaultActions[line.lineId] = { action: 'accept', targetPO: res.data.currentPO };
          }
        }
        for (const line of (res.data.unmatched || [])) {
          defaultActions[line.lineId] = { action: 'manual', targetPO: res.data.currentPO };
        }
        setActions(defaultActions);
      })
      .catch((err) => setError(err.response?.data?.error || 'Failed to load consolidation'))
      .finally(() => setLoading(false));
  }, [id]);

  const setAction = (lineId, field, value) => {
    setActions((prev) => ({
      ...prev,
      [lineId]: { ...prev[lineId], [field]: value },
    }));
  };

  const handleConfirm = async () => {
    setSaving(true);
    setError('');
    try {
      const actionList = Object.entries(actions).map(([lineId, a]) => ({
        lineId,
        action: a.action,
        targetPO: a.targetPO || state.currentPO,
      }));
      await invoiceAPI.applyConsolidationActions(id, actionList);
      navigate(`/invoices/${id}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to apply consolidation');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="container"><p>Loading...</p></div>;
  if (error && !state) return <div className="container"><div className="error">{error}</div></div>;

  const poNumbers = Object.keys(state.groups || {});

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
        <h2>Cross-Order Consolidation</h2>

        {!state.isMultiPO && (
          <div className="card" style={{ borderLeft: '4px solid #27ae60' }}>
            <p>All lines match a single purchase order ({state.currentPO}). No consolidation needed.</p>
            <Link to={`/invoices/${id}/receiving`} className="btn btn-primary">
              Proceed to Receiving
            </Link>
          </div>
        )}

        {state.isMultiPO && (
          <div className="card" style={{ borderLeft: '4px solid #f39c12', marginBottom: '1rem' }}>
            <p>Lines match <strong>{poNumbers.length} different purchase orders</strong>. Review and decide how to consolidate.</p>
            <p style={{ fontSize: '0.85rem', color: '#666' }}>Current receiving order: <strong>{state.currentPO || 'none'}</strong></p>
          </div>
        )}

        {poNumbers.map((poNr) => (
          <div key={poNr} className="card" style={{ marginBottom: '1rem' }}>
            <h3>PO: {poNr} {poNr === state.currentPO ? '(current)' : ''}</h3>
            <table style={{ fontSize: '0.85rem' }}>
              <thead>
                <tr><th>#</th><th>Product</th><th>Description</th><th>Qty</th><th>Confidence</th><th>Action</th></tr>
              </thead>
              <tbody>
                {state.groups[poNr].map((line) => (
                  <tr key={line.lineId}>
                    <td>{line.rowNo}</td>
                    <td>{line.productCode || '-'}</td>
                    <td>{line.description || '-'}</td>
                    <td>{line.qty}</td>
                    <td>
                      {line.match?.confidence != null
                        ? <span className={`status-badge ${
                            line.match.confidence >= 0.95 ? 'status-approved' :
                            line.match.confidence >= 0.75 ? 'status-needs_review' : 'status-rejected'
                          }`}>{Math.round(line.match.confidence * 100)}%</span>
                        : '-'}
                    </td>
                    <td>
                      <select
                        value={actions[line.lineId]?.action || 'accept'}
                        onChange={(e) => setAction(line.lineId, 'action', e.target.value)}
                        style={{ padding: '0.25rem', borderRadius: '4px', border: '1px solid #ddd' }}
                      >
                        {ACTION_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {(state.unmatched || []).length > 0 && (
          <div className="card" style={{ marginBottom: '1rem' }}>
            <h3>Unmatched Lines</h3>
            <table style={{ fontSize: '0.85rem' }}>
              <thead><tr><th>#</th><th>Product</th><th>Description</th><th>Qty</th><th>Action</th></tr></thead>
              <tbody>
                {state.unmatched.map((line) => (
                  <tr key={line.lineId}>
                    <td>{line.rowNo}</td>
                    <td>{line.productCode || '-'}</td>
                    <td>{line.description || '-'}</td>
                    <td>{line.qty}</td>
                    <td>
                      <select
                        value={actions[line.lineId]?.action || 'manual'}
                        onChange={(e) => setAction(line.lineId, 'action', e.target.value)}
                        style={{ padding: '0.25rem', borderRadius: '4px', border: '1px solid #ddd' }}
                      >
                        {ACTION_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {state.openPOs?.length > 0 && (
          <div className="card" style={{ marginBottom: '1rem' }}>
            <h3>Open POs for this Supplier</h3>
            <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
              {state.openPOs.map((po) => (
                <li key={po.purchaseOrderNr}>
                  <strong>{po.purchaseOrderNr}</strong> — {po.supplierName} ({po.rowCount} rows)
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <div className="error" style={{ marginTop: '1rem' }}>{error}</div>}

        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-primary" onClick={handleConfirm} disabled={saving}>
            {saving ? 'Saving...' : 'Confirm Consolidation'}
          </button>
          <Link to={`/invoices/${id}`} className="btn" style={{ backgroundColor: '#95a5a6', color: 'white' }}>
            Back to Invoice
          </Link>
        </div>
      </div>
    </div>
  );
}

export default ConsolidationReview;
