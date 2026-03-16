import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { emailAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import './Dashboard.css';

function EmailInboxSettings() {
  const { logout, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [polling, setPolling] = useState(false);
  const [message, setMessage] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [pollResult, setPollResult] = useState(null);

  const [config, setConfig] = useState({
    enabled: false,
    imapHost: '',
    imapPort: 993,
    imapTls: true,
    imapUser: '',
    imapPassword: '',
    folder: 'INBOX',
  });
  const [configured, setConfigured] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);
  const [lastUid, setLastUid] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);

  useEffect(() => {
    loadConfig();
  }, []);

  async function loadConfig() {
    try {
      const res = await emailAPI.getInbox();
      if (res.data.configured) {
        setConfig({
          enabled: res.data.enabled,
          imapHost: res.data.imapHost,
          imapPort: res.data.imapPort,
          imapTls: res.data.imapTls,
          imapUser: res.data.imapUser,
          imapPassword: '',
          folder: res.data.folder,
        });
        setConfigured(true);
        setHasPassword(res.data.hasPassword);
        setLastUid(res.data.lastUid);
        setUpdatedAt(res.data.updatedAt);
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Failed to load configuration' });
    } finally {
      setLoading(false);
    }
  }

  function handleChange(e) {
    const { name, value, type, checked } = e.target;
    setConfig((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : (name === 'imapPort' ? parseInt(value, 10) || '' : value),
    }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const payload = { ...config };
      // Don't send empty password if already configured (keeps existing)
      if (configured && !payload.imapPassword) {
        delete payload.imapPassword;
      }

      await emailAPI.saveInbox(payload);
      setMessage({ type: 'success', text: 'Configuration saved successfully' });
      setConfigured(true);
      setHasPassword(true);
      loadConfig();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Failed to save configuration' });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!config.imapHost || !config.imapUser || !config.imapPassword) {
      setTestResult({ success: false, error: 'Please fill in host, user, and password to test' });
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      const res = await emailAPI.testConnection({
        imapHost: config.imapHost,
        imapPort: config.imapPort,
        imapTls: config.imapTls,
        imapUser: config.imapUser,
        imapPassword: config.imapPassword,
      });
      setTestResult(res.data);
    } catch (err) {
      setTestResult({
        success: false,
        error: err.response?.data?.error || 'Connection test failed',
      });
    } finally {
      setTesting(false);
    }
  }

  async function handlePollNow() {
    setPolling(true);
    setPollResult(null);

    try {
      const res = await emailAPI.pollNow();
      setPollResult(res.data);
    } catch (err) {
      setPollResult({
        error: err.response?.data?.error || 'Poll failed',
      });
    } finally {
      setPolling(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm('Remove email inbox configuration? Polling will stop.')) return;

    try {
      await emailAPI.deleteInbox();
      setConfig({
        enabled: false,
        imapHost: '',
        imapPort: 993,
        imapTls: true,
        imapUser: '',
        imapPassword: '',
        folder: 'INBOX',
      });
      setConfigured(false);
      setHasPassword(false);
      setLastUid(null);
      setUpdatedAt(null);
      setMessage({ type: 'success', text: 'Configuration removed' });
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Failed to remove configuration' });
    }
  }

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
        <h2>Email Inbox Settings</h2>
        <p style={{ color: '#666', marginBottom: '1.5rem' }}>
          Configure an IMAP inbox to automatically import invoice PDFs from email.
        </p>

        {message && (
          <div className={message.type === 'error' ? 'error' : 'success'}
            style={{ padding: '0.75rem', borderRadius: '4px', marginBottom: '1rem',
              background: message.type === 'error' ? '#fde8e8' : '#e8fde8',
              color: message.type === 'error' ? '#c0392b' : '#27ae60' }}>
            {message.text}
          </div>
        )}

        <form onSubmit={handleSave}>
          <div className="card">
            <h3>IMAP Connection</h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label>IMAP Host *</label>
                <input
                  type="text"
                  name="imapHost"
                  value={config.imapHost}
                  onChange={handleChange}
                  placeholder="imap.gmail.com"
                  required
                />
              </div>

              <div className="form-group">
                <label>Port</label>
                <input
                  type="number"
                  name="imapPort"
                  value={config.imapPort}
                  onChange={handleChange}
                />
              </div>

              <div className="form-group">
                <label>Username *</label>
                <input
                  type="text"
                  name="imapUser"
                  value={config.imapUser}
                  onChange={handleChange}
                  placeholder="invoices@yourcompany.com"
                  required
                />
              </div>

              <div className="form-group">
                <label>Password {configured && hasPassword ? '(leave blank to keep current)' : '*'}</label>
                <input
                  type="password"
                  name="imapPassword"
                  value={config.imapPassword}
                  onChange={handleChange}
                  placeholder={configured && hasPassword ? '••••••••' : ''}
                  required={!configured || !hasPassword}
                />
              </div>

              <div className="form-group">
                <label>Folder</label>
                <input
                  type="text"
                  name="folder"
                  value={config.folder}
                  onChange={handleChange}
                  placeholder="INBOX"
                />
              </div>

              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '1rem', paddingTop: '1.5rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    name="imapTls"
                    checked={config.imapTls}
                    onChange={handleChange}
                  />
                  Use TLS
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    name="enabled"
                    checked={config.enabled}
                    onChange={handleChange}
                  />
                  Enable Polling
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving...' : 'Save Configuration'}
              </button>

              <button type="button" className="btn" onClick={handleTest}
                disabled={testing}
                style={{ backgroundColor: '#3498db', color: 'white' }}>
                {testing ? 'Testing...' : 'Test Connection'}
              </button>

              {configured && (
                <button type="button" className="btn btn-danger" onClick={handleDelete}>
                  Remove
                </button>
              )}
            </div>
          </div>
        </form>

        {/* Test Result */}
        {testResult && (
          <div className="card" style={{ borderLeft: `4px solid ${testResult.success ? '#27ae60' : '#e74c3c'}` }}>
            <h3>{testResult.success ? 'Connection Successful' : 'Connection Failed'}</h3>
            {testResult.success && testResult.folders && (
              <div>
                <strong>Available folders:</strong>
                <ul style={{ marginTop: '0.5rem' }}>
                  {testResult.folders.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
            {testResult.error && <p style={{ color: '#e74c3c' }}>{testResult.error}</p>}
          </div>
        )}

        {/* Polling Status */}
        {configured && (
          <div className="card">
            <h3>Polling Status</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <strong>Status:</strong><br />
                <span className={`status-badge ${config.enabled ? 'status-approved' : 'status-rejected'}`}>
                  {config.enabled ? 'Active' : 'Disabled'}
                </span>
              </div>
              <div>
                <strong>Last Processed UID:</strong><br />
                {lastUid || 'None (will fetch all)'}
              </div>
              <div>
                <strong>Last Updated:</strong><br />
                {updatedAt ? new Date(updatedAt).toLocaleString() : '-'}
              </div>
            </div>

            <div style={{ marginTop: '1rem' }}>
              <button
                className="btn"
                onClick={handlePollNow}
                disabled={polling}
                style={{ backgroundColor: '#8e44ad', color: 'white' }}
              >
                {polling ? 'Polling...' : 'Poll Now'}
              </button>
            </div>

            {pollResult && (
              <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#f8f9fa', borderRadius: '4px' }}>
                {pollResult.error ? (
                  <p style={{ color: '#e74c3c' }}>Error: {pollResult.error}</p>
                ) : (
                  <>
                    <p><strong>Messages processed:</strong> {pollResult.messagesProcessed}</p>
                    {pollResult.results && pollResult.results.length > 0 && (
                      <ul style={{ marginTop: '0.5rem' }}>
                        {pollResult.results.map((r, i) => (
                          <li key={i}>
                            {r.skipped
                              ? `Skipped: ${r.reason}`
                              : r.results
                                ? r.results.map((pr) =>
                                    pr.skipped
                                      ? `${pr.filename}: skipped (${pr.reason})`
                                      : `${pr.filename}: queued (${pr.invoiceId})`
                                  ).join(', ')
                                : `UID ${r.uid}: ${r.error || 'processed'}`
                            }
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default EmailInboxSettings;
