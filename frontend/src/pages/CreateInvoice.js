import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { invoiceAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import './CreateInvoice.css';

function CreateInvoice() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    invoiceNumber: '',
    supplierName: '',
    dueDate: '',
    currency: 'EUR',
    purchaseOrderNr: '',
  });
  const [lines, setLines] = useState([
    { description: '', qty: 1, unitPrice: 0, net: 0, vatRate: 0, vatAmount: 0, gross: 0 },
  ]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleLineChange = (index, field, value) => {
    const newLines = [...lines];
    newLines[index][field] = value;

    if (['qty', 'unitPrice', 'vatRate'].includes(field)) {
      const qty = Number(newLines[index].qty) || 0;
      const unitPrice = Number(newLines[index].unitPrice) || 0;
      const vatRate = Number(newLines[index].vatRate) || 0;
      const net = qty * unitPrice;
      const vatAmount = net * (vatRate / 100);
      newLines[index].net = net;
      newLines[index].vatAmount = vatAmount;
      newLines[index].gross = net + vatAmount;
    }

    setLines(newLines);
  };

  const addLine = () => {
    setLines([...lines, { description: '', qty: 1, unitPrice: 0, net: 0, vatRate: 0, vatAmount: 0, gross: 0 }]);
  };

  const removeLine = (index) => {
    if (lines.length > 1) {
      setLines(lines.filter((_, i) => i !== index));
    }
  };

  const calculateTotals = () => {
    const netTotal = lines.reduce((sum, l) => sum + (Number(l.net) || 0), 0);
    const vatTotal = lines.reduce((sum, l) => sum + (Number(l.vatAmount) || 0), 0);
    const grossTotal = lines.reduce((sum, l) => sum + (Number(l.gross) || 0), 0);
    return { netTotal, vatTotal, grossTotal };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await invoiceAPI.create({
        ...formData,
        lines,
      });
      navigate('/invoices');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create invoice');
    } finally {
      setLoading(false);
    }
  };

  const { netTotal, vatTotal, grossTotal } = calculateTotals();

  return (
    <div>
      <nav className="navbar">
        <h1>Invoice Portal</h1>
        <div>
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/invoices">Invoices</Link>
          <Link to="/invoices/create">Create Invoice</Link>
          <button className="btn btn-danger" onClick={logout}>
            Logout
          </button>
        </div>
      </nav>

      <div className="container">
        <h2>Create New Invoice</h2>

        <form onSubmit={handleSubmit}>
          <div className="card">
            <h3>Invoice Details</h3>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="invoiceNumber">Invoice Number</label>
                <input
                  type="text"
                  id="invoiceNumber"
                  name="invoiceNumber"
                  value={formData.invoiceNumber}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="dueDate">Due Date</label>
                <input
                  type="date"
                  id="dueDate"
                  name="dueDate"
                  value={formData.dueDate}
                  onChange={handleChange}
                />
              </div>
              <div className="form-group">
                <label htmlFor="currency">Currency</label>
                <input
                  type="text"
                  id="currency"
                  name="currency"
                  value={formData.currency}
                  onChange={handleChange}
                  maxLength={8}
                />
              </div>
            </div>
          </div>

          <div className="card">
            <h3>Supplier Information</h3>
            <div className="form-group">
              <label htmlFor="supplierName">Supplier Name</label>
              <input
                type="text"
                id="supplierName"
                name="supplierName"
                value={formData.supplierName}
                onChange={handleChange}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="purchaseOrderNr">Purchase Order Number (optional)</label>
              <input
                type="text"
                id="purchaseOrderNr"
                name="purchaseOrderNr"
                value={formData.purchaseOrderNr}
                onChange={handleChange}
                placeholder="e.g. PO-001"
              />
            </div>
          </div>

          <div className="card">
            <h3>Invoice Lines</h3>
            {lines.map((line, index) => (
              <div key={index} className="invoice-item">
                <div className="form-row">
                  <div className="form-group" style={{ flex: 2 }}>
                    <label>Description</label>
                    <input
                      type="text"
                      value={line.description}
                      onChange={(e) => handleLineChange(index, 'description', e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Qty</label>
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      value={line.qty}
                      onChange={(e) => handleLineChange(index, 'qty', parseFloat(e.target.value) || 0)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Unit Price</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.unitPrice}
                      onChange={(e) => handleLineChange(index, 'unitPrice', parseFloat(e.target.value) || 0)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>VAT %</label>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={line.vatRate}
                      onChange={(e) => handleLineChange(index, 'vatRate', parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <div className="form-group">
                    <label>Net</label>
                    <input type="number" value={line.net.toFixed(2)} readOnly />
                  </div>
                  <div className="form-group">
                    <label>Gross</label>
                    <input type="number" value={line.gross.toFixed(2)} readOnly />
                  </div>
                  <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end' }}>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => removeLine(index)}
                      disabled={lines.length === 1}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <button type="button" className="btn btn-success" onClick={addLine}>
              Add Line
            </button>
          </div>

          <div className="card">
            <h3>Totals</h3>
            <div className="totals">
              <div className="total-row">
                <span>Net Total:</span>
                <span>{netTotal.toFixed(2)}</span>
              </div>
              <div className="total-row">
                <span>VAT Total:</span>
                <span>{vatTotal.toFixed(2)}</span>
              </div>
              <div className="total-row total-final">
                <span>Gross Total:</span>
                <span>{grossTotal.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {error && <div className="error">{error}</div>}

          <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Creating...' : 'Create Invoice'}
            </button>
            <Link to="/invoices" className="btn" style={{ backgroundColor: '#95a5a6', color: 'white' }}>
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CreateInvoice;
