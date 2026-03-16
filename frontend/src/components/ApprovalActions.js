import React, { useState } from 'react';
import { invoiceAPI } from '../services/api';

function ApprovalActions({ invoice, user, onActionComplete }) {
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!invoice || !user) return null;

  const role = user.role;
  const status = invoice.status;

  const canSubmit =
    (role === 'reviewer' || role === 'tenant_admin') &&
    ['needs_review', 'ready', 'rejected'].includes(status);

  const canApproveReject =
    (role === 'approver' || role === 'tenant_admin') &&
    status === 'pending_approval';

  if (!canSubmit && !canApproveReject) return null;

  const doAction = async (action) => {
    if (action === 'reject' && !comment.trim()) {
      setError('Please provide a rejection reason.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      if (action === 'submit') await invoiceAPI.submit(invoice._id);
      else if (action === 'approve') await invoiceAPI.approve(invoice._id, comment);
      else if (action === 'reject') await invoiceAPI.reject(invoice._id, comment);
      setComment('');
      onActionComplete?.();
    } catch (err) {
      setError(err.response?.data?.error || `${action} failed`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h3>Approval Actions</h3>

      {canApproveReject && (
        <div className="form-group">
          <label>Comment (required for rejection)</label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="Add a comment..."
            style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ddd' }}
          />
        </div>
      )}

      {error && <div className="error" style={{ marginBottom: '0.75rem' }}>{error}</div>}

      <div style={{ display: 'flex', gap: '0.75rem' }}>
        {canSubmit && (
          <button
            className="btn btn-primary"
            onClick={() => doAction('submit')}
            disabled={loading}
          >
            {loading ? 'Submitting...' : 'Submit for Approval'}
          </button>
        )}
        {canApproveReject && (
          <>
            <button
              className="btn btn-success"
              onClick={() => doAction('approve')}
              disabled={loading}
              style={{ backgroundColor: '#27ae60', color: 'white' }}
            >
              {loading ? '...' : 'Approve'}
            </button>
            <button
              className="btn btn-danger"
              onClick={() => doAction('reject')}
              disabled={loading}
            >
              {loading ? '...' : 'Reject'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default ApprovalActions;
