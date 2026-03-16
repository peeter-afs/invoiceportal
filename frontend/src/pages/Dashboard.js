import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { invoiceAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import './Dashboard.css';

function Dashboard() {
  const { logout, user } = useAuth();
  const [stats, setStats] = useState({
    total: 0,
    needsReview: 0,
    pendingApproval: 0,
    approved: 0,
    exported: 0,
  });
  const [recentInvoices, setRecentInvoices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const response = await invoiceAPI.getAll();
      const invoices = response.data;

      setStats({
        total: invoices.length,
        needsReview: invoices.filter((inv) => inv.status === 'needs_review').length,
        pendingApproval: invoices.filter((inv) => inv.status === 'pending_approval').length,
        approved: invoices.filter((inv) => inv.status === 'approved').length,
        exported: invoices.filter((inv) => inv.status === 'exported').length,
      });

      setRecentInvoices(invoices.slice(0, 5));
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
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
          <Link to="/invoices/upload">Upload Invoice</Link>
          {user?.role === 'tenant_admin' && (
            <Link to="/settings/email">Email Settings</Link>
          )}
          <button className="btn btn-danger" onClick={logout}>
            Logout
          </button>
        </div>
      </nav>

      <div className="container">
        <h2>Dashboard</h2>

        {loading ? (
          <p>Loading...</p>
        ) : (
          <>
            <div className="stats-grid">
              <div className="stat-card">
                <h3>Total Invoices</h3>
                <p className="stat-value">{stats.total}</p>
              </div>
              <div className="stat-card">
                <h3>Needs Review</h3>
                <p className="stat-value">{stats.needsReview}</p>
              </div>
              <div className="stat-card">
                <h3>Pending Approval</h3>
                <p className="stat-value">{stats.pendingApproval}</p>
              </div>
              <div className="stat-card">
                <h3>Approved</h3>
                <p className="stat-value">{stats.approved}</p>
              </div>
              <div className="stat-card">
                <h3>Exported</h3>
                <p className="stat-value">{stats.exported}</p>
              </div>
            </div>

            <div className="card" style={{ marginTop: '2rem' }}>
              <h3>Recent Invoices</h3>
              {recentInvoices.length === 0 ? (
                <p>No invoices found. Upload your first invoice!</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Invoice #</th>
                      <th>Supplier</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Due Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentInvoices.map((invoice) => (
                      <tr key={invoice._id}>
                        <td>{invoice.invoiceNumber}</td>
                        <td>{invoice.supplierName}</td>
                        <td>{invoice.grossTotal != null ? `${invoice.grossTotal.toFixed(2)}` : '-'}</td>
                        <td>
                          <span className={`status-badge status-${invoice.status}`}>
                            {invoice.status.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td>{invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default Dashboard;
