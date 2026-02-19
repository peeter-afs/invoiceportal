import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { invoiceAPI } from '../services/api';
import './Dashboard.css';

function Dashboard({ onLogout }) {
  const [stats, setStats] = useState({
    total: 0,
    draft: 0,
    sent: 0,
    paid: 0,
    overdue: 0,
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

      const stats = {
        total: invoices.length,
        draft: invoices.filter((inv) => inv.status === 'draft').length,
        sent: invoices.filter((inv) => inv.status === 'sent').length,
        paid: invoices.filter((inv) => inv.status === 'paid').length,
        overdue: invoices.filter((inv) => inv.status === 'overdue').length,
      };

      setStats(stats);
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
          <Link to="/invoices/create">Create Invoice</Link>
          <button className="btn btn-danger" onClick={onLogout}>
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
                <h3>Draft</h3>
                <p className="stat-value">{stats.draft}</p>
              </div>
              <div className="stat-card">
                <h3>Sent</h3>
                <p className="stat-value">{stats.sent}</p>
              </div>
              <div className="stat-card">
                <h3>Paid</h3>
                <p className="stat-value">{stats.paid}</p>
              </div>
              <div className="stat-card">
                <h3>Overdue</h3>
                <p className="stat-value">{stats.overdue}</p>
              </div>
            </div>

            <div className="card" style={{ marginTop: '2rem' }}>
              <h3>Recent Invoices</h3>
              {recentInvoices.length === 0 ? (
                <p>No invoices found. Create your first invoice!</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Invoice #</th>
                      <th>Client</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Due Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentInvoices.map((invoice) => (
                      <tr key={invoice._id}>
                        <td>{invoice.invoiceNumber}</td>
                        <td>{invoice.clientName}</td>
                        <td>${invoice.total.toFixed(2)}</td>
                        <td>
                          <span className={`status-badge status-${invoice.status}`}>
                            {invoice.status}
                          </span>
                        </td>
                        <td>{new Date(invoice.dueDate).toLocaleDateString()}</td>
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
