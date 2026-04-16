'use strict';

/* ═══════════════════════════════════════════════════════════════
   xero.js — Client-side Xero OAuth2 + Finance Panel
   ═══════════════════════════════════════════════════════════════ */

const XERO_STORAGE_KEY = 'xeroToken';
const XERO_API_BASE    = '/api/xero';

// ─── Token management ─────────────────────────────────────────────────────────
function loadXeroToken() {
  try { return JSON.parse(localStorage.getItem(XERO_STORAGE_KEY) || 'null'); }
  catch { return null; }
}

function saveXeroToken(t) {
  localStorage.setItem(XERO_STORAGE_KEY, JSON.stringify(t));
}

function clearXeroToken() {
  localStorage.removeItem(XERO_STORAGE_KEY);
}

// Returns a valid token (auto-refreshes if close to expiry); null if not connected
async function getValidXeroToken() {
  const t = loadXeroToken();
  if (!t) return null;

  // If token has more than 60 seconds left, use as-is
  if (t.expiresAt && Date.now() < t.expiresAt - 60_000) return t;

  // Attempt refresh
  try {
    const res = await fetch(`${XERO_API_BASE}/refresh`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ refreshToken: t.refreshToken }),
    });
    if (!res.ok) { clearXeroToken(); return null; }

    const data    = await res.json();
    const updated = {
      accessToken:  data.access_token,
      refreshToken: data.refresh_token || t.refreshToken,
      expiresAt:    Date.now() + (data.expires_in || 1800) * 1000,
      tenantId:     t.tenantId,
      tenantName:   t.tenantName,
    };
    saveXeroToken(updated);
    return updated;
  } catch {
    return null;
  }
}

// ─── OAuth connect flow ────────────────────────────────────────────────────────
async function connectXero() {
  try {
    const res  = await fetch(`${XERO_API_BASE}/auth`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    '{}',
    });
    const data = await res.json();
    if (!data.url) return;

    // Try popup first
    const popup = window.open(data.url, 'xero-oauth', 'width=600,height=700,noopener');

    if (!popup || popup.closed) {
      // Fallback: redirect main window
      window.location.href = data.url;
      return;
    }

    // Listen for postMessage from popup
    window.addEventListener('message', async function handler(e) {
      if (!e.data || e.data.type !== 'xero-callback') return;
      window.removeEventListener('message', handler);
      await exchangeXeroCode(e.data.code);
      updateXeroSettingsUI();
      loadXeroPanel();
    });
  } catch (e) {
    console.error('[xero] connectXero failed:', e.message);
  }
}

// ─── Exchange authorization code for tokens ───────────────────────────────────
async function exchangeXeroCode(code) {
  try {
    const res = await fetch(`${XERO_API_BASE}/callback`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ code }),
    });
    if (!res.ok) return;
    const data = await res.json();
    saveXeroToken({
      accessToken:  data.access_token,
      refreshToken: data.refresh_token,
      expiresAt:    Date.now() + (data.expires_in || 1800) * 1000,
      tenantId:     data.tenantId,
      tenantName:   data.tenantName || 'Xero Organisation',
    });
  } catch (e) {
    console.error('[xero] Code exchange failed:', e.message);
  }
}

// ─── Settings UI ──────────────────────────────────────────────────────────────
function updateXeroSettingsUI() {
  const t          = loadXeroToken();
  const btnConnect = document.getElementById('btnConnectXero');
  const connStatus = document.getElementById('xeroConnectedStatus');
  const orgName    = document.getElementById('xeroOrgName');
  const hint       = document.getElementById('xeroSettingsHint');

  if (t) {
    if (btnConnect)  btnConnect.hidden   = true;
    if (connStatus)  connStatus.hidden   = false;
    if (orgName)     orgName.textContent = t.tenantName || 'Xero';
    if (hint)        hint.textContent    = 'Live invoice and bank data is available in the Finance tab.';
  } else {
    if (btnConnect)  btnConnect.hidden   = false;
    if (connStatus)  connStatus.hidden   = true;
    if (hint)        hint.textContent    = 'Sync invoices, payments and bank data from Xero.';
  }
}

// ─── Finance panel loader ─────────────────────────────────────────────────────
async function loadXeroPanel() {
  const panelEl = document.getElementById('xeroFinancePanel');
  const labelEl = document.getElementById('xeroFinanceSectionLabel');
  if (!panelEl) return;

  const t = await getValidXeroToken();
  if (!t) {
    panelEl.hidden = true;
    if (labelEl) labelEl.hidden = true;
    return;
  }

  panelEl.hidden = false;
  if (labelEl) labelEl.hidden = false;
  panelEl.innerHTML = '<div class="xero-loading">Loading Xero data…</div>';

  try {
    const payload = { accessToken: t.accessToken, tenantId: t.tenantId };
    const [invRes, accRes] = await Promise.all([
      fetch(`${XERO_API_BASE}/invoices`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      }),
      fetch(`${XERO_API_BASE}/accounts`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      }),
    ]);

    const invData = invRes.ok ? await invRes.json() : {};
    const accData = accRes.ok ? await accRes.json() : {};

    renderXeroPanel(invData.Invoices || [], accData.Accounts || []);
    applyXeroBadgesToJobs(invData.Invoices || []);
  } catch (e) {
    panelEl.innerHTML = `<div class="xero-error">Failed to load Xero data: ${xeroEsc(e.message)}</div>`;
  }
}

// ─── Render Finance panel ─────────────────────────────────────────────────────
function renderXeroPanel(invoices, accounts) {
  const panelEl = document.getElementById('xeroFinancePanel');
  if (!panelEl) return;

  const now         = new Date();
  let outstanding   = 0;
  let paidThisMonth = 0;
  const overdue     = [];
  const clientTotals = {};

  invoices.forEach(inv => {
    if (inv.Status === 'AUTHORISED') {
      outstanding += inv.AmountDue || 0;
      if (inv.DueDateString && xeroParseDate(inv.DueDateString) < now) {
        overdue.push(inv);
      }
    }
    if (inv.Status === 'PAID' && inv.FullyPaidOnDate && xeroIsThisMonth(inv.FullyPaidOnDate)) {
      paidThisMonth += inv.Total || 0;
    }
    if (inv.Contact?.Name) {
      clientTotals[inv.Contact.Name] = (clientTotals[inv.Contact.Name] || 0) + (inv.Total || 0);
    }
  });

  const topClients = Object.entries(clientTotals)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  // Overdue rows (top 5)
  const overdueRows = overdue.slice(0, 5).map(inv =>
    `<div class="xero-overdue-row">
      <span class="xero-overdue-client">${xeroEsc(inv.Contact?.Name || '—')}</span>
      <span class="xero-overdue-inv">${xeroEsc(inv.InvoiceNumber || '')}</span>
      <span class="xero-overdue-amt">$${xeroFmt(inv.AmountDue)}</span>
    </div>`
  ).join('') || '<p class="xero-empty">No overdue invoices &#10003;</p>';

  // Top client rows
  const topClientRows = topClients.map(([name, total]) =>
    `<div class="xero-client-row">
      <span class="xero-client-name">${xeroEsc(name)}</span>
      <span class="xero-client-total">$${xeroFmt(total)}</span>
    </div>`
  ).join('') || '<p class="xero-empty">No data.</p>';

  // Bank account rows
  const bankRows = accounts.map(a =>
    `<div class="xero-bank-row">
      <span class="xero-bank-name">${xeroEsc(a.Name)}</span>
      <span class="xero-bank-bal${a.CurrentBalance < 0 ? ' xero-bank-bal--neg' : ''}">$${xeroFmt(a.CurrentBalance || 0)}</span>
    </div>`
  ).join('');

  panelEl.innerHTML = `
    <div class="xero-kpi-row">
      <div class="xero-kpi">
        <div class="xero-kpi-label">Outstanding</div>
        <div class="xero-kpi-value">$${xeroFmt(outstanding)}</div>
      </div>
      <div class="xero-kpi">
        <div class="xero-kpi-label">Paid This Month</div>
        <div class="xero-kpi-value xero-kpi-value--green">$${xeroFmt(paidThisMonth)}</div>
      </div>
      <div class="xero-kpi">
        <div class="xero-kpi-label">Overdue</div>
        <div class="xero-kpi-value xero-kpi-value--red">${overdue.length}</div>
      </div>
    </div>
    <div class="xero-sub-label">Overdue Invoices</div>
    <div class="xero-overdue-list">${overdueRows}</div>
    <div class="xero-sub-label">Top 5 Clients by Revenue</div>
    <div class="xero-clients-list">${topClientRows}</div>
    ${bankRows ? `<div class="xero-sub-label">Bank Accounts</div><div class="xero-bank-list">${bankRows}</div>` : ''}
  `;
}

// ─── Apply Xero badges to Jobs table ─────────────────────────────────────────
function applyXeroBadgesToJobs(invoices) {
  if (!invoices.length) return;

  const lookup = {};
  invoices.forEach(inv => {
    if (!inv.Contact?.Name) return;
    const key = inv.Contact.Name.toLowerCase().trim();
    (lookup[key] = lookup[key] || []).push(inv);
  });

  document.querySelectorAll('#jobsTableBody tr').forEach(row => {
    const clientCell = row.querySelector('td:first-child');
    if (!clientCell) return;
    const clientText = clientCell.textContent.toLowerCase().trim();

    const matched = Object.keys(lookup).find(k =>
      clientText.includes(k) || k.includes(clientText)
    );
    if (!matched) return;

    if (!row.querySelector('.xero-badge')) {
      const badge       = document.createElement('span');
      badge.className   = 'xero-badge';
      badge.textContent = 'X';
      badge.title       = 'Xero invoice matched';
      clientCell.appendChild(badge);
    }
  });
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function xeroParseDate(s) {
  // Xero date formats: "/Date(1234567890000+0000)/" or "YYYY-MM-DD"
  if (typeof s === 'string') {
    const m = s.match(/\/Date\((\d+)/);
    if (m) return new Date(parseInt(m[1], 10));
  }
  return new Date(s);
}

function xeroIsThisMonth(xeroDate) {
  const d = xeroParseDate(xeroDate);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
}

function xeroFmt(n) {
  return (n || 0).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function xeroEsc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Init ─────────────────────────────────────────────────────────────────────
(function initXero() {
  // Check if this page load is an OAuth callback (popup or main-window redirect)
  const params = new URLSearchParams(window.location.search);
  const code   = params.get('code');
  const state  = params.get('state');

  if (code && state === 'xero') {
    if (window.opener && !window.opener.closed) {
      // We're in the popup — relay code to parent and close
      try {
        window.opener.postMessage({ type: 'xero-callback', code }, window.location.origin);
      } catch (_) {}
      window.close();
      return;
    }

    // Main-window redirect fallback — exchange directly then clean URL
    exchangeXeroCode(code).then(() => {
      const url = new URL(window.location.href);
      url.searchParams.delete('code');
      url.searchParams.delete('state');
      window.history.replaceState({}, '', url.toString());
      updateXeroSettingsUI();
      // Load panel if Finance is currently visible
      const financeView = document.getElementById('viewFinance');
      if (financeView && !financeView.hidden) loadXeroPanel();
    });
    return;
  }

  // Wire up buttons after DOM is ready
  document.addEventListener('DOMContentLoaded', function () {
    const btnConnect    = document.getElementById('btnConnectXero');
    const btnDisconnect = document.getElementById('btnDisconnectXero');

    if (btnConnect) {
      btnConnect.addEventListener('click', connectXero);
    }
    if (btnDisconnect) {
      btnDisconnect.addEventListener('click', function () {
        clearXeroToken();
        updateXeroSettingsUI();
        const panelEl = document.getElementById('xeroFinancePanel');
        const labelEl = document.getElementById('xeroFinanceSectionLabel');
        if (panelEl) { panelEl.hidden = true; panelEl.innerHTML = ''; }
        if (labelEl) labelEl.hidden = true;
      });
    }

    updateXeroSettingsUI();

    // Load panel when Finance tab is clicked
    document.addEventListener('click', function (e) {
      const tab = e.target.closest('.tab[data-site="__finance__"]');
      if (tab) {
        // Small delay so switchTab() runs first and the panel is visible
        setTimeout(loadXeroPanel, 50);
      }
    });
  });
}());
