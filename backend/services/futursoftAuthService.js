const { getTenantSettings } = require('./tenantService');

const B2C_TOKEN_URL = 'https://vitecfutursoft.b2clogin.com/vitecfutursoft.onmicrosoft.com/oauth2/v2.0/token?p=B2C_1_ROPC_login';

async function authenticate(username, password, tenantId) {
  // Mock mode for development without Futursoft access
  if (process.env.FS_AUTH_MOCK === 'true') {
    return {
      access_token: `mock-access-token-${Date.now()}`,
      refresh_token: `mock-refresh-token-${Date.now()}`,
      expires_in: 3600,
      token_type: 'Bearer',
    };
  }

  const clientId = process.env.FS_B2C_CLIENT_ID;
  if (!clientId) {
    throw new Error('FS_B2C_CLIENT_ID is not configured');
  }

  const scope = process.env.FS_B2C_SCOPE || `openid offline_access ${clientId}`;

  const body = new URLSearchParams({
    grant_type: 'password',
    username,
    password,
    scope,
    client_id: clientId,
    response_type: 'token',
  });

  const response = await fetch(B2C_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorDesc = errorData.error_description || errorData.error || 'Authentication failed';
    throw new Error(errorDesc);
  }

  return response.json();
}

async function refreshToken(refreshTokenValue, tenantId) {
  if (process.env.FS_AUTH_MOCK === 'true') {
    return {
      access_token: `mock-access-token-${Date.now()}`,
      refresh_token: `mock-refresh-token-${Date.now()}`,
      expires_in: 3600,
      token_type: 'Bearer',
    };
  }

  const clientId = process.env.FS_B2C_CLIENT_ID;
  if (!clientId) {
    throw new Error('FS_B2C_CLIENT_ID is not configured');
  }

  const scope = process.env.FS_B2C_SCOPE || `openid offline_access ${clientId}`;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshTokenValue,
    scope,
    client_id: clientId,
  });

  const response = await fetch(B2C_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error_description || 'Token refresh failed');
  }

  return response.json();
}

function getFutursoftConfig(tenantSettings) {
  return {
    baseUrl: tenantSettings?.futursoft_base_url || process.env.FS_API_BASE_URL || 'https://api.futursoft.net',
    subscriptionKey: tenantSettings?.futursoft_subscription_key || process.env.FS_SUBSCRIPTION_KEY,
  };
}

module.exports = { authenticate, refreshToken, getFutursoftConfig };
