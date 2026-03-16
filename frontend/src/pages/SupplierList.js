import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supplierAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import './Dashboard.css';

function SupplierList() {
  const { logout, user } = useAuth();
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchSuppliers();
  }, []);

  const fetchSuppliers = async () => {
    try {
      const res = await supplierAPI.getAll();
      setSuppliers(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load suppliers');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <nav className="navbar">
        <h1>Invoice Portal</h1>
        <div>
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/invoices">Invoices</Link>
          <Link to="/suppliers">Suppliers</Link>
          <Link to="/invoices/upload">Upload Invoice</Link>
          <button className="btn btn-danger" onClick={logout}>Logout</button>
        </div>
      </nav>

      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2>Suppliers</h2>
          {user?.role === 'tenant_admin' && (
            <Link to="/suppliers/new" className="btn btn-primary">Add Supplier</Link>
          )}
        </div>

        {loading && <p>Loading...</p>}
        {error && <div className="error">{error}</div>}

        {!loading && suppliers.length === 0 && (
          <div className="card">
            <p>No suppliers found. Suppliers are auto-created when invoices are processed.</p>
          </div>
        )}

        {suppliers.length > 0 && (
          <div className="card" style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>VAT Number</th>
                  <th>Reg Number</th>
                  <th>Futursoft #</th>
                  <th>Aliases</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id}>
                    <td><Link to={`/suppliers/${s.id}`}>{s.name}</Link></td>
                    <td>{s.vatNumber || '-'}</td>
                    <td>{s.regNumber || '-'}</td>
                    <td>{s.futursoftSupplierNr || '-'}</td>
                    <td>{s.aliasCount || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default SupplierList;
