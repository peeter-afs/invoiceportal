import React, { useState, useEffect, useCallback } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { supplierAPI, invoiceAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import './Dashboard.css';

function SupplierDetail() {
  const { logout, user } = useAuth();
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = id === 'new';
  const isAdmin = user?.role === 'tenant_admin';

  const [supplier, setSupplier] = useState({
    name: '', vatNumber: '', regNumber: '', address: '',
    bankAccount: '', futursoftSupplierNr: '', extractionInstructions: '',
  });
  const [aliases, setAliases] = useState([]);
  const [newAlias, setNewAlias] = useState('');
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Extraction samples state
  const [samples, setSamples] = useState([]);
  const [linkedInvoices, setLinkedInvoices] = useState([]);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [sampleNotes, setSampleNotes] = useState('');
  const [addingSample, setAddingSample] = useState(false);

  const fetchSupplier = useCallback(async () => {
    try {
      const res = await supplierAPI.getById(id);
      const data = res.data;
      setSupplier({
        name: data.name || '',
        vatNumber: data.vatNumber || '',
        regNumber: data.regNumber || '',
        address: data.address || '',
        bankAccount: data.bankAccount || '',
        futursoftSupplierNr: data.futursoftSupplierNr || '',
        extractionInstructions: data.extractionInstructions || '',
      });
      setAliases(data.aliases || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load supplier');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchSamples = useCallback(async () => {
    try {
      const res = await supplierAPI.getSamples(id);
      setSamples(res.data);
    } catch { /* ignore */ }
  }, [id]);

  const fetchLinkedInvoices = useCallback(async () => {
    try {
      const res = await invoiceAPI.getAll();
      // Filter invoices linked to this supplier
      const linked = res.data.filter((inv) => inv.supplierId === id);
      setLinkedInvoices(linked);
    } catch { /* ignore */ }
  }, [id]);

  useEffect(() => {
    if (!isNew) {
      fetchSupplier();
      fetchSamples();
      fetchLinkedInvoices();
    }
  }, [isNew, fetchSupplier, fetchSamples, fetchLinkedInvoices]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      if (isNew) {
        const res = await supplierAPI.create(supplier);
        navigate(`/suppliers/${res.data.id}`, { replace: true });
      } else {
        await supplierAPI.update(id, supplier);
        setSuccess('Supplier saved successfully');
        fetchSupplier();
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save supplier');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this supplier?')) return;
    try {
      await supplierAPI.delete(id);
      navigate('/suppliers', { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete supplier');
    }
  };

  const handleAddAlias = async () => {
    if (!newAlias.trim()) return;
    try {
      await supplierAPI.addAlias(id, newAlias.trim());
      setNewAlias('');
      fetchSupplier();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add alias');
    }
  };

  const handleRemoveAlias = async (aliasId) => {
    try {
      await supplierAPI.removeAlias(id, aliasId);
      fetchSupplier();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove alias');
    }
  };

  const handleAddSample = async () => {
    if (!selectedInvoiceId) return;
    setAddingSample(true);
    try {
      await supplierAPI.addSample(id, selectedInvoiceId, sampleNotes);
      setSelectedInvoiceId('');
      setSampleNotes('');
      fetchSamples();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add sample');
    } finally {
      setAddingSample(false);
    }
  };

  const handleRemoveSample = async (sampleId) => {
    try {
      await supplierAPI.removeSample(id, sampleId);
      fetchSamples();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove sample');
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
          <Link to="/suppliers">Suppliers</Link>
          <button className="btn btn-danger" onClick={logout}>Logout</button>
        </div>
      </nav>

      <div className="container">
        <h2>{isNew ? 'New Supplier' : 'Supplier Detail'}</h2>

        {error && <div className="error" style={{ marginBottom: '1rem' }}>{error}</div>}
        {success && <div style={{ color: '#27ae60', marginBottom: '1rem', fontWeight: 'bold' }}>{success}</div>}

        <form onSubmit={handleSave}>
          <div className="card">
            <h3>Supplier Information</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label><strong>Name *</strong></label>
                <input
                  type="text"
                  value={supplier.name}
                  onChange={(e) => setSupplier({ ...supplier, name: e.target.value })}
                  required
                  disabled={!isAdmin}
                  style={{ width: '100%', padding: '0.5rem', marginTop: '0.25rem' }}
                />
              </div>
              <div>
                <label><strong>VAT Number</strong></label>
                <input
                  type="text"
                  value={supplier.vatNumber}
                  onChange={(e) => setSupplier({ ...supplier, vatNumber: e.target.value })}
                  disabled={!isAdmin}
                  style={{ width: '100%', padding: '0.5rem', marginTop: '0.25rem' }}
                />
              </div>
              <div>
                <label><strong>Reg Number</strong></label>
                <input
                  type="text"
                  value={supplier.regNumber}
                  onChange={(e) => setSupplier({ ...supplier, regNumber: e.target.value })}
                  disabled={!isAdmin}
                  style={{ width: '100%', padding: '0.5rem', marginTop: '0.25rem' }}
                />
              </div>
              <div>
                <label><strong>Bank Account</strong></label>
                <input
                  type="text"
                  value={supplier.bankAccount}
                  onChange={(e) => setSupplier({ ...supplier, bankAccount: e.target.value })}
                  disabled={!isAdmin}
                  style={{ width: '100%', padding: '0.5rem', marginTop: '0.25rem' }}
                />
              </div>
              <div>
                <label><strong>Futursoft Supplier Nr</strong></label>
                <input
                  type="text"
                  value={supplier.futursoftSupplierNr}
                  onChange={(e) => setSupplier({ ...supplier, futursoftSupplierNr: e.target.value })}
                  disabled={!isAdmin}
                  style={{ width: '100%', padding: '0.5rem', marginTop: '0.25rem' }}
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label><strong>Address</strong></label>
                <textarea
                  value={supplier.address}
                  onChange={(e) => setSupplier({ ...supplier, address: e.target.value })}
                  disabled={!isAdmin}
                  rows={2}
                  style={{ width: '100%', padding: '0.5rem', marginTop: '0.25rem' }}
                />
              </div>
            </div>

            {isAdmin && (
              <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving...' : (isNew ? 'Create Supplier' : 'Save Changes')}
                </button>
                {!isNew && (
                  <button type="button" className="btn btn-danger" onClick={handleDelete}>
                    Delete Supplier
                  </button>
                )}
              </div>
            )}
          </div>
        </form>

        {/* Aliases section — only for existing suppliers */}
        {!isNew && (
          <div className="card" style={{ marginTop: '1rem' }}>
            <h3>Name Aliases</h3>
            <p style={{ color: '#666', fontSize: '0.9em', marginBottom: '0.75rem' }}>
              Aliases allow matching invoices from the same supplier using different names.
            </p>

            {aliases.length > 0 ? (
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {aliases.map((a) => (
                  <li key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <span style={{ flex: 1 }}>{a.alias}</span>
                    {isAdmin && (
                      <button
                        className="btn"
                        style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem', backgroundColor: '#e74c3c', color: 'white' }}
                        onClick={() => handleRemoveAlias(a.id)}
                      >
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ color: '#999' }}>No aliases configured.</p>
            )}

            {isAdmin && (
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                <input
                  type="text"
                  value={newAlias}
                  onChange={(e) => setNewAlias(e.target.value)}
                  placeholder="Add alias name..."
                  style={{ flex: 1, padding: '0.5rem' }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddAlias(); } }}
                />
                <button type="button" className="btn btn-primary" onClick={handleAddAlias}>
                  Add Alias
                </button>
              </div>
            )}
          </div>
        )}

        {/* Extraction Instructions — only for existing suppliers */}
        {!isNew && (
          <div className="card" style={{ marginTop: '1rem' }}>
            <h3>Extraction Instructions</h3>
            <p style={{ color: '#666', fontSize: '0.9em', marginBottom: '0.75rem' }}>
              Custom instructions for extracting invoices from this supplier. These are injected into the AI prompt.
            </p>
            <textarea
              value={supplier.extractionInstructions}
              onChange={(e) => setSupplier({ ...supplier, extractionInstructions: e.target.value })}
              placeholder="e.g., Qty column is labeled 'Kgk'. Position numbers in first column are NOT row numbers. Unit prices include VAT..."
              rows={4}
              style={{ width: '100%', padding: '0.5rem', fontFamily: 'inherit' }}
            />
            {isAdmin && (
              <button
                type="button"
                className="btn btn-primary"
                style={{ marginTop: '0.5rem' }}
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  setError('');
                  try {
                    await supplierAPI.update(id, { extractionInstructions: supplier.extractionInstructions });
                    setSuccess('Extraction instructions saved');
                  } catch (err) {
                    setError(err.response?.data?.error || 'Failed to save');
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                Save Instructions
              </button>
            )}
          </div>
        )}

        {/* Extraction Samples — only for existing suppliers */}
        {!isNew && (
          <div className="card" style={{ marginTop: '1rem' }}>
            <h3>Extraction Samples ({samples.length})</h3>
            <p style={{ color: '#666', fontSize: '0.9em', marginBottom: '0.75rem' }}>
              Reference invoices with correct extraction results. Used as few-shot examples for the AI.
            </p>

            {samples.length > 0 ? (
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {samples.map((s) => (
                  <li key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', padding: '0.5rem', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
                    <span style={{ flex: 1 }}>
                      {s.invoiceId ? (
                        <Link to={`/invoices/${s.invoiceId}`}>
                          {s.invoiceNumber || 'Invoice'}
                        </Link>
                      ) : (
                        <span style={{ color: '#999' }}>Source invoice deleted</span>
                      )}
                      {s.notes && <span style={{ color: '#666', marginLeft: '0.5rem' }}>— {s.notes}</span>}
                      <span style={{ color: '#999', fontSize: '0.8em', marginLeft: '0.5rem' }}>
                        {new Date(s.createdAt).toLocaleDateString()}
                      </span>
                    </span>
                    <button
                      className="btn"
                      style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem', backgroundColor: '#e74c3c', color: 'white' }}
                      onClick={() => handleRemoveSample(s.id)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ color: '#999' }}>No extraction samples configured.</p>
            )}

            <div style={{ marginTop: '0.75rem', padding: '0.75rem', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
              <strong style={{ fontSize: '0.9em' }}>Add sample from invoice:</strong>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  value={selectedInvoiceId}
                  onChange={(e) => setSelectedInvoiceId(e.target.value)}
                  style={{ flex: 1, minWidth: '200px', padding: '0.4rem' }}
                >
                  <option value="">— Select invoice —</option>
                  {linkedInvoices.map((inv) => (
                    <option key={inv._id} value={inv._id}>
                      {inv.invoiceNumber || 'No number'} — {inv.grossTotal != null ? `${inv.grossTotal.toFixed(2)}` : '?'} ({inv.status})
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={sampleNotes}
                  onChange={(e) => setSampleNotes(e.target.value)}
                  placeholder="Notes (optional)"
                  style={{ width: '200px', padding: '0.4rem' }}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleAddSample}
                  disabled={!selectedInvoiceId || addingSample}
                  style={{ fontSize: '0.85rem' }}
                >
                  {addingSample ? 'Adding...' : 'Add Sample'}
                </button>
              </div>
              {linkedInvoices.length === 0 && (
                <p style={{ color: '#999', fontSize: '0.85em', marginTop: '0.5rem' }}>
                  No invoices linked to this supplier. Link invoices first from the Invoice Detail page.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default SupplierDetail;
