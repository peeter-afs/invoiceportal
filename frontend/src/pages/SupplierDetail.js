import React, { useState, useEffect, useCallback } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { supplierAPI } from '../services/api';
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
    bankAccount: '', futursoftSupplierNr: '',
  });
  const [aliases, setAliases] = useState([]);
  const [newAlias, setNewAlias] = useState('');
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

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
      });
      setAliases(data.aliases || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load supplier');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!isNew) fetchSupplier();
  }, [isNew, fetchSupplier]);

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
      </div>
    </div>
  );
}

export default SupplierDetail;
