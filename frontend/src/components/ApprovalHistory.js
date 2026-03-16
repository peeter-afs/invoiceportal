import React, { useState, useEffect } from 'react';
import { invoiceAPI } from '../services/api';

const ACTION_LABEL = {
  submit: 'Submitted for approval',
  approve: 'Approved',
  reject: 'Rejected',
  revoke: 'Revoked',
};

const ACTION_COLOR = {
  submit: '#2196f3',
  approve: '#27ae60',
  reject: '#e74c3c',
  revoke: '#ff9800',
};

function ApprovalHistory({ invoiceId }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    invoiceAPI.getApprovals(invoiceId)
      .then((res) => setHistory(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [invoiceId]);

  if (loading || history.length === 0) return null;

  return (
    <div className="card">
      <h3>Approval History</h3>
      <div style={{ borderLeft: '2px solid #eee', paddingLeft: '1rem' }}>
        {history.map((entry) => (
          <div key={entry.id} style={{ marginBottom: '0.75rem', position: 'relative' }}>
            <div style={{
              position: 'absolute', left: '-1.45rem', top: '0.2rem',
              width: '12px', height: '12px', borderRadius: '50%',
              backgroundColor: ACTION_COLOR[entry.action] || '#999',
            }} />
            <div style={{ fontWeight: 'bold', color: ACTION_COLOR[entry.action] }}>
              {ACTION_LABEL[entry.action] || entry.action}
            </div>
            <div style={{ color: '#555', fontSize: '0.85rem' }}>
              by {entry.actorDisplayName || entry.actorUsername}
              {entry.actor_role ? ` (${entry.actor_role})` : ''}{' '}
              · {new Date(entry.created_at).toLocaleString()}
            </div>
            {entry.comment && (
              <div style={{ marginTop: '0.25rem', color: '#333', fontStyle: 'italic' }}>
                "{entry.comment}"
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default ApprovalHistory;
