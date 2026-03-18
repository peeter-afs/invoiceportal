import React, { useState, useEffect } from 'react';
import { invoiceAPI, userAPI } from '../services/api';

function ApprovalActions({ invoice, user, onActionComplete }) {
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [approvers, setApprovers] = useState([]);
  const [selectedApproverId, setSelectedApproverId] = useState('');

  const role = user?.role;
  const status = invoice?.status;

  const canSubmit =
    (role === 'reviewer' || role === 'tenant_admin') &&
    ['needs_review', 'ready', 'rejected'].includes(status);

  // Approvers can directly approve from needs_review/ready (skip pending_approval step)
  const canApproveReject =
    (role === 'approver' || role === 'tenant_admin') &&
    ['pending_approval', 'needs_review', 'ready'].includes(status);

  // Load approvers list when submit is possible
  useEffect(() => {
    if (!canSubmit) return;
    userAPI.getApprovers()
      .then((res) => {
        setApprovers(res.data || []);
        // Pre-fill with default approver from workflowConfig cascade (supplier > tenant)
        const defaultId = invoice?.workflowConfig?.defaultApproverId;
        if (defaultId) setSelectedApproverId(defaultId);
      })
      .catch(() => { /* non-critical */ });
  }, [canSubmit, invoice?.workflowConfig?.defaultApproverId]);

  if (!invoice || !user) return null;
  if (!canSubmit && !canApproveReject) return null;

  const doAction = async (action) => {
    if (action === 'reject' && !comment.trim()) {
      setError('Please provide a rejection reason.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      if (action === 'submit') await invoiceAPI.submit(invoice._id, selectedApproverId || undefined);
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

      {canSubmit && approvers.length > 0 && (
        <div className="form-group" style={{ marginBottom: '0.75rem' }}>
          <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>
            Assign to approver
          </label>
          <select
            value={selectedApproverId}
            onChange={(e) => setSelectedApproverId(e.target.value)}
            style={{ padding: '0.4rem 0.5rem', borderRadius: '4px', border: '1px solid #ddd', minWidth: '200px' }}
          >
            <option value="">— select approver —</option>
            {approvers.map((a) => (
              <option key={a.id} value={a.id}>{a.displayName}</option>
            ))}
          </select>
        </div>
      )}

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
