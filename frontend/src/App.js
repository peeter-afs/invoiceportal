import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import InvoiceList from './pages/InvoiceList';
import InvoiceDetail from './pages/InvoiceDetail';
import InvoiceUpload from './pages/InvoiceUpload';
import CreateInvoice from './pages/CreateInvoice';
import InvoiceMatchReview from './pages/InvoiceMatchReview';
import ReceivingPreview from './pages/ReceivingPreview';
import ConsolidationReview from './pages/ConsolidationReview';
import EmailInboxSettings from './pages/EmailInboxSettings';
import WorkflowSettings from './pages/WorkflowSettings';
import OrderProposal from './pages/OrderProposal';
import SupplierList from './pages/SupplierList';
import SupplierDetail from './pages/SupplierDetail';
import './App.css';

// Extract tenant key from URL: /acme-corp/login → tenantKey="acme-corp"
// If the first path segment is a known route name, it's not a tenant key.
const KNOWN_ROUTES = ['login', 'dashboard', 'invoices', 'suppliers', 'settings'];

function getInitialTenantKey() {
  const segments = window.location.pathname.split('/').filter(Boolean);
  if (segments.length > 0 && !KNOWN_ROUTES.includes(segments[0])) {
    return segments[0];
  }
  return null;
}

const tenantKey = getInitialTenantKey();

function PrivateRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <div className="loading">Loading...</div>;
  return isAuthenticated ? children : <Navigate to="/login" />;
}

function PublicRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <div className="loading">Loading...</div>;
  return isAuthenticated ? <Navigate to="/dashboard" /> : children;
}

function App() {
  return (
    <Router basename={tenantKey ? `/${tenantKey}` : '/'}>
      <AuthProvider tenantKey={tenantKey}>
        <div className="App">
          <Routes>
            <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
            <Route path="/dashboard" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
            <Route path="/invoices" element={<PrivateRoute><InvoiceList /></PrivateRoute>} />
            <Route path="/invoices/upload" element={<PrivateRoute><InvoiceUpload /></PrivateRoute>} />
            <Route path="/invoices/create" element={<PrivateRoute><CreateInvoice /></PrivateRoute>} />
            <Route path="/invoices/:id" element={<PrivateRoute><InvoiceDetail /></PrivateRoute>} />
            <Route path="/invoices/:id/matching" element={<PrivateRoute><InvoiceMatchReview /></PrivateRoute>} />
            <Route path="/invoices/:id/receiving" element={<PrivateRoute><ReceivingPreview /></PrivateRoute>} />
            <Route path="/invoices/:id/proposal" element={<PrivateRoute><OrderProposal /></PrivateRoute>} />
            <Route path="/invoices/:id/consolidation" element={<PrivateRoute><ConsolidationReview /></PrivateRoute>} />
            <Route path="/suppliers" element={<PrivateRoute><SupplierList /></PrivateRoute>} />
            <Route path="/suppliers/:id" element={<PrivateRoute><SupplierDetail /></PrivateRoute>} />
            <Route path="/settings/email" element={<PrivateRoute><EmailInboxSettings /></PrivateRoute>} />
            <Route path="/settings/workflow" element={<PrivateRoute><WorkflowSettings /></PrivateRoute>} />
            <Route path="/" element={<Navigate to="/login" />} />
            <Route path="*" element={<Navigate to="/login" />} />
          </Routes>
        </div>
      </AuthProvider>
    </Router>
  );
}

export default App;
