const axios = require('axios');
const { getTenantSettings } = require('./tenantService');
const { refreshToken } = require('./futursoftAuthService');

const FS_DEBUG = process.env.FS_DEBUG === 'true';

// Fixture data for mock mode
const MOCK_PURCHASE_ORDER = {
  purchaseOrderNr: 'PO-MOCK-001',
  supplierNr: 'SUP001',
  supplierName: 'Mock Supplier Oy',
  rows: [
    {
      rowNr: 1,
      productCode: 'PROD-001',
      productName: 'Widget A',
      orderingCode: 'SUP-W-001',
      ean: '1234567890123',
      qty: 10,
      confirmedQty: 10,
      receivedQty: 0,
      buyingPrice: 5.00,
      vatRate: 24,
    },
    {
      rowNr: 2,
      productCode: 'PROD-002',
      productName: 'Widget B',
      orderingCode: null,
      ean: null,
      qty: 5,
      confirmedQty: 5,
      receivedQty: 0,
      buyingPrice: 12.50,
      vatRate: 24,
    },
  ],
};

const MOCK_PRODUCTS = [
  { productCode: 'PROD-001', productName: 'Widget A', orderingCode: 'SUP-W-001', ean: '1234567890123', vatRate: 24 },
  { productCode: 'PROD-002', productName: 'Widget B', orderingCode: null, ean: null, vatRate: 24 },
  { productCode: 'PROD-003', productName: 'Component X', orderingCode: 'SUP-CX', ean: '9876543210987', vatRate: 24 },
];

class FutursoftApiClient {
  constructor(session, tenantSettings) {
    this.session = session; // { fsAccessToken, fsRefreshToken, fsTokenExpiresAt, tenantId }
    this.baseUrl = (tenantSettings?.futursoft_base_url || process.env.FS_API_BASE_URL || '').replace(/\/$/, '');
    this.wsBaseUrl = (tenantSettings?.futursoft_ws_base_url || process.env.FS_WS_API_BASE_URL || '').replace(/\/$/, '');
    this.salesBaseUrl = (process.env.FS_SALES_API_BASE_URL || '').replace(/\/$/, '');
    this.subscriptionKey = tenantSettings?.futursoft_subscription_key || process.env.FS_SUBSCRIPTION_KEY;
    this.mockMode = process.env.FS_MOCK_API === 'true';
  }

  async _ensureValidToken() {
    if (this.mockMode) return;
    if (!this.session?.fsAccessToken) throw new Error('No Futursoft access token in session');

    const expiresAt = new Date(this.session.fsTokenExpiresAt);
    const fiveMinutes = 5 * 60 * 1000;
    if (Date.now() < expiresAt.getTime() - fiveMinutes) return; // still valid

    // Refresh token
    if (!this.session.fsRefreshToken) {
      throw new Error('Futursoft token expired and no refresh token available. Please log in again.');
    }

    try {
      const tokenData = await refreshToken(this.session.fsRefreshToken, this.session.tenantId);
      this.session.fsAccessToken = tokenData.access_token;
      this.session.fsRefreshToken = tokenData.refresh_token || this.session.fsRefreshToken;
      this.session.fsTokenExpiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString();
    } catch (err) {
      throw new Error(`Token refresh failed: ${err.message}`);
    }
  }

  async _request(method, path, data) {
    if (this.mockMode) {
      throw new Error('Mock mode: use specific mock methods');
    }
    await this._ensureValidToken();

    const url = `${this.baseUrl}${path}`;
    console.log(`[futursoft] ${method} ${url}`);

    const headers = {
      Authorization: `Bearer ${this.session.fsAccessToken}`,
      'Content-Type': 'application/json',
    };
    if (this.subscriptionKey) {
      headers['Ocp-Apim-Subscription-Key'] = this.subscriptionKey;
    }

    try {
      const response = await axios({
        method,
        url,
        headers,
        data: data || undefined,
        timeout: 30000,
      });
      console.log(`[futursoft] ${method} ${url} → ${response.status}`);
      if (FS_DEBUG) {
        console.log(`[futursoft] Response headers:`, JSON.stringify(response.headers));
        console.log(`[futursoft] Response body:`, JSON.stringify(response.data).slice(0, 2000));
      }
      return response.data;
    } catch (err) {
      const status = err.response?.status || 'no response';
      const body = JSON.stringify(err.response?.data || err.message).slice(0, 500);
      console.error(`[futursoft] ${method} ${url} → FAILED (${status}): ${body}`);
      if (FS_DEBUG && err.response?.headers) {
        console.error(`[futursoft] Response headers:`, JSON.stringify(err.response.headers));
      }
      throw err;
    }
  }

  async _wsRequest(method, path, data) {
    if (this.mockMode) {
      throw new Error('Mock mode: use specific mock methods');
    }
    await this._ensureValidToken();

    const url = `${this.wsBaseUrl}${path}`;
    console.log(`[futursoft-ws] ${method} ${url}`);

    if (!this.wsBaseUrl) {
      console.error(`[futursoft-ws] FS_WS_API_BASE_URL is not set! Cannot call Workshop API.`);
      throw new Error('Workshop API base URL (FS_WS_API_BASE_URL) is not configured');
    }

    const headers = {
      Authorization: `Bearer ${this.session.fsAccessToken}`,
      'Content-Type': 'application/json',
    };
    if (this.subscriptionKey) {
      headers['Ocp-Apim-Subscription-Key'] = this.subscriptionKey;
    }

    try {
      const response = await axios({
        method,
        url,
        headers,
        data: data || undefined,
        timeout: 30000,
      });
      console.log(`[futursoft-ws] ${method} ${url} → ${response.status}`);
      if (FS_DEBUG) {
        console.log(`[futursoft-ws] Response headers:`, JSON.stringify(response.headers));
        console.log(`[futursoft-ws] Response body:`, JSON.stringify(response.data).slice(0, 2000));
      }
      return response.data;
    } catch (err) {
      const status = err.response?.status || 'no response';
      const body = JSON.stringify(err.response?.data || err.message).slice(0, 500);
      console.error(`[futursoft-ws] ${method} ${url} → FAILED (${status}): ${body}`);
      if (FS_DEBUG && err.response?.headers) {
        console.error(`[futursoft-ws] Response headers:`, JSON.stringify(err.response.headers));
      }
      throw err;
    }
  }

  async _salesRequest(method, path, data) {
    if (this.mockMode) {
      throw new Error('Mock mode: use specific mock methods');
    }
    if (!this.salesBaseUrl) {
      throw new Error('Sales API base URL (FS_SALES_API_BASE_URL) is not configured');
    }
    await this._ensureValidToken();

    const url = `${this.salesBaseUrl}${path}`;
    console.log(`[futursoft-sales] ${method} ${url}`);

    const headers = {
      Authorization: `Bearer ${this.session.fsAccessToken}`,
      'Content-Type': 'application/json',
    };
    if (this.subscriptionKey) {
      headers['Ocp-Apim-Subscription-Key'] = this.subscriptionKey;
    }

    try {
      const response = await axios({
        method,
        url,
        headers,
        data: data || undefined,
        timeout: 30000,
      });
      console.log(`[futursoft-sales] ${method} ${url} → ${response.status}`);
      if (FS_DEBUG) {
        console.log(`[futursoft-sales] Response body:`, JSON.stringify(response.data).slice(0, 2000));
      }
      return response.data;
    } catch (err) {
      const status = err.response?.status || 'no response';
      const body = JSON.stringify(err.response?.data || err.message).slice(0, 500);
      console.error(`[futursoft-sales] ${method} ${url} → FAILED (${status}): ${body}`);
      throw err;
    }
  }

  /**
   * Search Futursoft suppliers by name (Sales API).
   * Returns the supplierNr if a match is found, or 0 if not.
   */
  async searchSupplierByName(name) {
    if (this.mockMode) return 0;
    if (!this.salesBaseUrl) return 0;

    const payload = {
      name: [{ operator: 'Includes', value: name }],
    };

    try {
      const data = await this._salesRequest('POST', '/product/v1/suppliers/search', payload);
      const items = data?.items || data;
      if (!Array.isArray(items)) return 0;

      for (const row of items) {
        if (!row || typeof row !== 'object') continue;
        for (const key of ['supplierNr', 'number', 'id']) {
          if (row[key] != null && !isNaN(Number(row[key]))) {
            return String(row[key]);
          }
        }
      }
    } catch (err) {
      console.error(`[futursoft-sales] Supplier search failed for "${name}": ${err.message}`);
    }

    return 0;
  }

  async getPurchaseOrder(purchaseOrderNr) {
    if (this.mockMode) {
      return { ...MOCK_PURCHASE_ORDER, purchaseOrderNr };
    }
    return this._request('GET', `/warehouse/v1/purchase-order/${encodeURIComponent(purchaseOrderNr)}`);
  }

  async getOpenPurchaseOrdersForSupplier(supplierNr) {
    if (this.mockMode) {
      return [MOCK_PURCHASE_ORDER];
    }
    return this._request('GET', `/warehouse/v1/purchase-orders?supplierNr=${encodeURIComponent(supplierNr)}&status=open`);
  }

  async createPurchaseOrder(payload) {
    if (this.mockMode) {
      return { ...payload, purchaseOrderNr: `PO-MOCK-${Date.now()}`, status: 'open' };
    }
    return this._request('POST', '/warehouse/v1/purchase-orders', payload);
  }

  async postReceiving(payload) {
    if (this.mockMode) {
      return { success: true, ...payload };
    }
    return this._request('POST', '/warehouse/v1/purchase-orders/receiving', payload);
  }

  async searchProducts(search) {
    if (this.mockMode) {
      const q = (search || '').toLowerCase();
      return q
        ? MOCK_PRODUCTS.filter(
            (p) =>
              p.productCode.toLowerCase().includes(q) ||
              p.productName.toLowerCase().includes(q)
          )
        : MOCK_PRODUCTS;
    }
    return this._request('GET', `/warehouse/v1/products?search=${encodeURIComponent(search)}`);
  }

  async getProduct(productCode) {
    if (this.mockMode) {
      return MOCK_PRODUCTS.find((p) => p.productCode === productCode) || null;
    }
    return this._request('GET', `/warehouse/v1/products/${encodeURIComponent(productCode)}`);
  }

  /**
   * Fetch a Futursoft internal setting by name.
   * Used to get company name ("yrityksen nimi") for tenant resolution.
   */
  async getSetting(settingName) {
    if (this.mockMode) {
      if (settingName === 'yrityksen nimi') return 'Mock Company Oy';
      return null;
    }
    const result = await this._wsRequest('GET', `/api/v1/workshop/settings/internal/${encodeURIComponent(settingName)}`);
    console.log(`[futursoft-ws] getSetting("${settingName}") raw response:`, JSON.stringify(result));
    if (typeof result === 'string') return result.trim();
    // Response format: { "yrityksen nimi": "sysexpert testi" } — key is the setting name
    const val = result?.[settingName] ?? result?.value ?? result?.Value ?? '';
    return val.toString().trim();
  }
}

/**
 * Factory: creates a FutursoftApiClient from an Express session.
 * Loads tenant settings from DB.
 */
async function createFromSession(session) {
  const tenantSettings = await getTenantSettings(session.tenantId);
  return new FutursoftApiClient(session, tenantSettings);
}

/**
 * Create a client with just an access token (no session/tenant yet).
 * Used during login to query Futursoft before tenant is resolved.
 */
function createWithToken(accessToken) {
  const baseUrl = (process.env.FS_API_BASE_URL || '').replace(/\/$/, '');
  const wsBaseUrl = (process.env.FS_WS_API_BASE_URL || '').replace(/\/$/, '');
  const subscriptionKey = process.env.FS_SUBSCRIPTION_KEY;
  const pseudoSession = {
    fsAccessToken: accessToken,
    fsTokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
  };
  const pseudoSettings = {
    futursoft_base_url: baseUrl,
    futursoft_ws_base_url: wsBaseUrl,
    futursoft_subscription_key: subscriptionKey,
  };
  return new FutursoftApiClient(pseudoSession, pseudoSettings);
}

module.exports = { FutursoftApiClient, createFromSession, createWithToken };
