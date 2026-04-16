'use strict';

/* ═══════════════════════════════════════════════════════════════
   DYNASTY OS — netlify/functions/xero.js
   Xero OAuth2 + API proxy — all secrets kept server-side
   ═══════════════════════════════════════════════════════════════ */

const CLIENT_ID     = process.env.XERO_CLIENT_ID     || '';
const CLIENT_SECRET = process.env.XERO_CLIENT_SECRET || '';
const REDIRECT_URI  = 'https://dynastyos.com.au/dashboard.html';

const XERO_AUTH_URL  = 'https://login.xero.com/identity/connect/authorize';
const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
const XERO_CONN_URL  = 'https://api.xero.com/connections';
const XERO_API       = 'https://api.xero.com/api.xro/2.0';

const SCOPES = [
  'openid', 'profile', 'email',
  'accounting.transactions',
  'accounting.contacts',
  'accounting.reports.read',
  'offline_access',
].join(' ');

// ─── CORS headers ─────────────────────────────────────────────────────────────
const HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const respond = (statusCode, body) => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify(body),
});
const ok  = body       => respond(200, body);
const bad = (msg, code = 400) => respond(code, { error: msg });

// ─── Basic auth header ────────────────────────────────────────────────────────
function basicAuth() {
  return 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
}

// ─── Xero bearer headers ──────────────────────────────────────────────────────
function xeroHeaders(accessToken, tenantId) {
  const h = {
    Authorization:  `Bearer ${accessToken}`,
    Accept:         'application/json',
  };
  if (tenantId) h['Xero-tenant-id'] = tenantId;
  return h;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return bad('Method not allowed', 405);
  }

  // Extract sub-route from path: /api/xero/auth → 'auth'
  const segments = (event.path || '').split('/').filter(Boolean);
  const action   = segments[segments.length - 1];

  let body = {};
  try { body = JSON.parse(event.body || '{}'); }
  catch { return bad('Invalid JSON body'); }

  try {
    switch (action) {
      case 'auth':     return handleAuth();
      case 'callback': return await handleCallback(body);
      case 'refresh':  return await handleRefresh(body);
      case 'invoices': return await handleInvoices(body);
      case 'contacts': return await handleContacts(body);
      case 'accounts': return await handleAccounts(body);
      default:         return bad(`Unknown action: ${action}`, 404);
    }
  } catch (e) {
    console.error('[xero] Unhandled error:', e.message);
    return bad('Internal error: ' + e.message, 500);
  }
};

// ─── 1. Generate OAuth2 authorization URL ─────────────────────────────────────
function handleAuth() {
  if (!CLIENT_ID) return bad('XERO_CLIENT_ID is not configured', 500);

  // Build URL manually so spaces in scope are encoded as %20 (not +).
  // Xero rejects scope values that use + encoding.
  const url =
    `${XERO_AUTH_URL}` +
    `?response_type=code` +
    `&client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&state=xero`;

  return ok({ url });
}

// ─── 2. Exchange authorization code for tokens ────────────────────────────────
async function handleCallback({ code }) {
  if (!code)          return bad('code is required');
  if (!CLIENT_ID)     return bad('XERO_CLIENT_ID is not configured', 500);
  if (!CLIENT_SECRET) return bad('XERO_CLIENT_SECRET is not configured', 500);

  const tokenRes = await fetch(XERO_TOKEN_URL, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      Authorization:   basicAuth(),
    },
    body: new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    }).toString(),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    console.error('[xero] Token exchange failed:', tokenRes.status, text);
    return bad(`Token exchange failed (${tokenRes.status})`, 502);
  }

  const tokens  = await tokenRes.json();
  const tenants = await getConnections(tokens.access_token);
  const tenant  = tenants[0] || {};

  return ok({
    access_token:  tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in:    tokens.expires_in || 1800,
    tenantId:      tenant.tenantId   || '',
    tenantName:    tenant.tenantName || 'Xero Organisation',
  });
}

// ─── 3. Refresh access token ──────────────────────────────────────────────────
async function handleRefresh({ refreshToken }) {
  if (!refreshToken) return bad('refreshToken is required');
  if (!CLIENT_SECRET) return bad('XERO_CLIENT_SECRET is not configured', 500);

  const res = await fetch(XERO_TOKEN_URL, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:  basicAuth(),
    },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!res.ok) return bad('Token refresh failed', 502);
  return ok(await res.json());
}

// ─── 4. Fetch invoices ────────────────────────────────────────────────────────
async function handleInvoices({ accessToken, tenantId }) {
  if (!accessToken || !tenantId) return bad('accessToken and tenantId are required');

  const res = await fetch(
    `${XERO_API}/Invoices?order=DueDateUTC+DESC&pageSize=100&unitdp=4`,
    { headers: xeroHeaders(accessToken, tenantId) }
  );

  if (!res.ok) {
    console.error('[xero] Invoices:', res.status);
    return bad('Failed to fetch invoices from Xero', 502);
  }
  return ok(await res.json());
}

// ─── 5. Fetch contacts ────────────────────────────────────────────────────────
async function handleContacts({ accessToken, tenantId }) {
  if (!accessToken || !tenantId) return bad('accessToken and tenantId are required');

  const res = await fetch(
    `${XERO_API}/Contacts?order=Name+ASC&includeArchived=false`,
    { headers: xeroHeaders(accessToken, tenantId) }
  );

  if (!res.ok) {
    console.error('[xero] Contacts:', res.status);
    return bad('Failed to fetch contacts from Xero', 502);
  }
  return ok(await res.json());
}

// ─── 6. Fetch bank accounts ───────────────────────────────────────────────────
async function handleAccounts({ accessToken, tenantId }) {
  if (!accessToken || !tenantId) return bad('accessToken and tenantId are required');

  const res = await fetch(
    `${XERO_API}/Accounts?where=Type%3D%3D%22BANK%22`,
    { headers: xeroHeaders(accessToken, tenantId) }
  );

  if (!res.ok) {
    console.error('[xero] Accounts:', res.status);
    return bad('Failed to fetch accounts from Xero', 502);
  }
  return ok(await res.json());
}

// ─── Helper: get connected tenant list ────────────────────────────────────────
async function getConnections(accessToken) {
  try {
    const res = await fetch(XERO_CONN_URL, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}
