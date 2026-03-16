import React, { useState, useEffect } from 'react';
import { invoiceAPI } from '../services/api';

const LEVEL_COLOR = { info: '#2196f3', warn: '#ff9800', error: '#f44336' };

function ProcessingStatus({ invoiceId }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchLogs = async () => {
      try {
        const res = await invoiceAPI.getLogs(invoiceId);
        if (!cancelled) setLogs(res.data);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchLogs();
    return () => { cancelled = true; };
  }, [invoiceId]);

  if (loading) return <p style={{ color: '#666' }}>Loading logs...</p>;
  if (logs.length === 0) return <p style={{ color: '#666' }}>No processing logs yet.</p>;

  return (
    <div style={{ fontFamily: 'monospace', fontSize: '0.85rem', marginTop: '0.5rem' }}>
      {logs.map((log) => (
        <div key={log.id} style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.3rem', alignItems: 'flex-start' }}>
          <span style={{ color: '#999', whiteSpace: 'nowrap' }}>
            {new Date(log.created_at).toLocaleTimeString()}
          </span>
          <span style={{ color: LEVEL_COLOR[log.level] || '#333', textTransform: 'uppercase', minWidth: '40px' }}>
            {log.level}
          </span>
          <span style={{ color: '#555', minWidth: '120px' }}>{log.step}</span>
          <span>{log.message}</span>
        </div>
      ))}
    </div>
  );
}

export default ProcessingStatus;
