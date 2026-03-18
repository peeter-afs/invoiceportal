import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { settingsAPI, userAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import './Dashboard.css';

function WorkflowSettings() {
  const { logout } = useAuth();
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [approvers, setApprovers] = useState([]);

  useEffect(() => {
    settingsAPI.get()
      .then((res) => setSettings(res.data))
      .catch((err) => setError(err.response?.data?.error || 'Failed to load settings'))
      .finally(() => setLoading(false));
    userAPI.getApprovers()
      .then((res) => setApprovers(res.data || []))
      .catch(() => { /* non-critical */ });
  }, []);

  const handleToggle = (field) => {
    setSettings((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const res = await settingsAPI.update(settings);
      setSettings(res.data);
      setMessage('Settings saved successfully');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="container"><p>Loading...</p></div>;

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

      <div className="container" style={{ maxWidth: '700px' }}>
        <h2>Workflow Settings</h2>

        {error && <div className="error">{error}</div>}
        {message && <div style={{ padding: '0.75rem', backgroundColor: '#d4edda', color: '#155724', borderRadius: '6px', marginBottom: '1rem' }}>{message}</div>}

        {settings && (
          <>
            <div className="card">
              <h3>Approval</h3>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={settings.approvalEnabled} onChange={() => handleToggle('approvalEnabled')} />
                Enable approval workflow
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={settings.autoSubmitForApproval} onChange={() => handleToggle('autoSubmitForApproval')} />
                Auto-submit for approval after review
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={settings.autoExportOnApproval} onChange={() => handleToggle('autoExportOnApproval')} />
                Auto-export on approval
              </label>
            </div>

            <div className="card">
              <h3>Workflow Steps</h3>
              <p style={{ color: '#666', marginBottom: '1rem', fontSize: '0.9em' }}>
                Enable the post-extraction workflow steps shown on invoice detail pages.
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={settings.wfOrderProposalEnabled} onChange={() => handleToggle('wfOrderProposalEnabled')} />
                Order Proposal
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={settings.wfOrderConfirmationEnabled} onChange={() => handleToggle('wfOrderConfirmationEnabled')} />
                Order Confirmation
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={settings.wfOrderEnabled} onChange={() => handleToggle('wfOrderEnabled')} />
                Order
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={settings.wfReceivingEnabled} onChange={() => handleToggle('wfReceivingEnabled')} />
                Receiving
              </label>
              <hr style={{ margin: '0.75rem 0', borderColor: '#eee' }} />
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!settings.wfAutoApproveOnOrder} onChange={() => handleToggle('wfAutoApproveOnOrder')} />
                Auto-approve when order is created (approver role required)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!settings.wfRequireApprovalBeforeOrder} onChange={() => handleToggle('wfRequireApprovalBeforeOrder')} />
                Require approval before creating order
              </label>
            </div>

            <div className="card">
              <h3>Default Approver</h3>
              <p style={{ color: '#666', marginBottom: '0.75rem', fontSize: '0.9em' }}>
                Pre-selected approver when submitting invoices for approval. Can be overridden per supplier.
              </p>
              <select
                value={settings.defaultApproverId || ''}
                onChange={(e) => setSettings((prev) => ({ ...prev, defaultApproverId: e.target.value || null }))}
                style={{ padding: '0.4rem 0.5rem', borderRadius: '4px', border: '1px solid #ddd', minWidth: '220px' }}
              >
                <option value="">— no default —</option>
                {approvers.map((a) => (
                  <option key={a.id} value={a.id}>{a.displayName}</option>
                ))}
              </select>
            </div>

            <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ marginTop: '0.5rem' }}>
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default WorkflowSettings;
