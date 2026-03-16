import React, { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import './Dashboard.css';

function InvoiceUpload() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef();

  const handleFile = async (file) => {
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setError('Only PDF files are accepted');
      return;
    }
    setError('');
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await api.post('/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      navigate(`/invoices/${response.data.invoiceId}`);
    } catch (err) {
      if (err.response?.status === 409) {
        setError(`Duplicate: ${err.response.data.error}`);
        if (err.response.data.invoiceId) {
          navigate(`/invoices/${err.response.data.invoiceId}`);
        }
      } else {
        setError(err.response?.data?.error || 'Upload failed');
      }
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    handleFile(file);
  };

  const handleInputChange = (e) => {
    handleFile(e.target.files[0]);
  };

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

      <div className="container">
        <h2>Upload Invoice PDF</h2>

        <div
          className={`upload-zone ${dragOver ? 'drag-over' : ''} ${uploading ? 'uploading' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => !uploading && fileInputRef.current?.click()}
        >
          <input
            type="file"
            accept="application/pdf"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={handleInputChange}
          />
          {uploading ? (
            <p>Uploading and processing...</p>
          ) : (
            <>
              <p style={{ fontSize: '3rem', margin: 0 }}>📄</p>
              <p>Drag and drop a PDF invoice here, or click to select a file</p>
              <p style={{ color: '#999', fontSize: '0.85rem' }}>PDF files only, max 20 MB</p>
            </>
          )}
        </div>

        {error && <div className="error" style={{ marginTop: '1rem' }}>{error}</div>}

        <div style={{ marginTop: '1.5rem' }}>
          <p style={{ color: '#666' }}>
            After upload, the invoice will be automatically extracted using AI.
            You can then review the extracted data, match lines to purchase orders, and submit for approval.
          </p>
        </div>
      </div>
    </div>
  );
}

export default InvoiceUpload;
