import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

// Extract tenant key from URL path (first segment if it's not a known route)
const KNOWN_ROUTES = ['login', 'dashboard', 'invoices', 'settings', 'api'];

function getTenantKeyFromUrl() {
  const segments = window.location.pathname.split('/').filter(Boolean);
  if (segments.length > 0 && !KNOWN_ROUTES.includes(segments[0])) {
    return segments[0];
  }
  return null;
}

// Add X-Tenant-Key header to all requests if tenant key is in URL
api.interceptors.request.use((config) => {
  const tenantKey = getTenantKeyFromUrl();
  if (tenantKey) {
    config.headers['X-Tenant-Key'] = tenantKey;
  }
  return config;
});

// Auth API
export const authAPI = {
  login: (credentials) => api.post('/auth/login', credentials),
  logout: () => api.post('/auth/logout'),
  getCurrentUser: () => api.get('/auth/me'),
};

// Invoice API
export const invoiceAPI = {
  getAll: () => api.get('/invoices'),
  getById: (id) => api.get(`/invoices/${id}`),
  create: (invoiceData) => api.post('/invoices', invoiceData),
  update: (id, invoiceData) => api.put(`/invoices/${id}`, invoiceData),
  delete: (id) => api.delete(`/invoices/${id}`),
  getLogs: (id) => api.get(`/invoices/${id}/logs`),
  getFileUrl: (id) => `${API_URL}/invoices/${id}/file`,
  getFile: (id) => api.get(`/invoices/${id}/file`, { responseType: 'blob' }),
  // Approval
  submit: (id) => api.post(`/invoices/${id}/submit`),
  approve: (id, comment) => api.post(`/invoices/${id}/approve`, { comment }),
  reject: (id, comment) => api.post(`/invoices/${id}/reject`, { comment }),
  getApprovals: (id) => api.get(`/invoices/${id}/approvals`),
  // Matching
  triggerMatch: (id) => api.post(`/invoices/${id}/match`),
  getMatches: (id) => api.get(`/invoices/${id}/matches`),
  overrideMatch: (id, lineId, matchData) =>
    api.put(`/invoices/${id}/lines/${lineId}/match`, matchData),
  // Purchase orders
  getPurchaseOrder: (id) => api.get(`/invoices/${id}/purchase-order`),
  createPurchaseOrder: (id) => api.post(`/invoices/${id}/purchase-order`),
  // Receiving
  getReceivingPreview: (id) => api.get(`/invoices/${id}/receiving-preview`),
  postReceiving: (id, lines) => api.post(`/invoices/${id}/receiving`, { lines }),
  // Consolidation
  getConsolidation: (id) => api.get(`/invoices/${id}/consolidation`),
  applyConsolidationActions: (id, actions) =>
    api.post(`/invoices/${id}/consolidation/actions`, { actions }),
};

// Futursoft API (proxied through backend)
export const futursoftAPI = {
  getPurchaseOrder: (nr) => api.get(`/futursoft/purchase-orders/${encodeURIComponent(nr)}`),
  searchProducts: (search) => api.get(`/futursoft/products?search=${encodeURIComponent(search)}`),
  getProduct: (code) => api.get(`/futursoft/products/${encodeURIComponent(code)}`),
};

// User API
export const userAPI = {
  updateProfile: (userData) => api.put('/users/profile', userData),
  getAll: () => api.get('/users'),
  setRole: (userId, role) => api.put(`/users/${userId}/role`, { role }),
  setStatus: (userId, status) => api.put(`/users/${userId}/status`, { status }),
};

// Email Inbox API (admin only)
export const emailAPI = {
  getInbox: () => api.get('/email/inbox'),
  saveInbox: (config) => api.put('/email/inbox', config),
  deleteInbox: () => api.delete('/email/inbox'),
  testConnection: (config) => api.post('/email/inbox/test', config),
  pollNow: () => api.post('/email/inbox/poll'),
};

export default api;
