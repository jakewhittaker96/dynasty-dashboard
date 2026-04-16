'use strict';

/* ═══════════════════════════════════════════════════════════════
   DYNASTY OS — clients.js
   Multi-client login system: CRUD, auth helpers, admin manager
   ═══════════════════════════════════════════════════════════════ */

// ─── Storage helpers ─────────────────────────────────────────────────────────
const CLIENTS_KEY = 'dynastyClients';

function loadClients() {
  try { return JSON.parse(localStorage.getItem(CLIENTS_KEY) || '[]'); } catch { return []; }
}
function saveClients(arr) { localStorage.setItem(CLIENTS_KEY, JSON.stringify(arr)); }

function genUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// btoa-based hash (sufficient for this single-tenant SaaS)
function hashPw(pw) {
  try { return btoa(unescape(encodeURIComponent(pw))); } catch { return btoa(pw); }
}
function checkPw(pw, hash) {
  try { return hashPw(pw) === hash; } catch { return false; }
}

// ─── Exposed helpers for app.js initAuth (loaded before clients.js) ──────────
window.findClientByEmail = function(email) {
  return loadClients().find(c => c.email.toLowerCase() === email.toLowerCase().trim());
};
window.checkClientPassword = checkPw;

// ─── Admin Client Manager ─────────────────────────────────────────────────────
let editingClientId = null;

(function initClientManager() {
  const overlay     = document.getElementById('clientsOverlay');
  const closeBtn    = document.getElementById('clientsClose');
  const btnAdd      = document.getElementById('btnAddClient');
  const tableBody   = document.getElementById('clientsTableBody');

  const formOverlay = document.getElementById('clientFormOverlay');
  const formClose   = document.getElementById('clientFormClose');
  const formTitle   = document.getElementById('clientFormTitle');
  const saveBtn     = document.getElementById('btnSaveClient');
  const formMsg     = document.getElementById('clientFormMsg');

  const onbOverlay  = document.getElementById('onboardingOverlay');
  const onbClose    = document.getElementById('onboardingClose');
  const onbText     = document.getElementById('onboardingText');
  const onbCopy     = document.getElementById('btnCopyOnboarding');

  const manageBtn   = document.getElementById('btnManageClients');

  if (!overlay || !manageBtn) return;

  // ── Wire up open/close ──────────────────────────────────────────────────────
  manageBtn.addEventListener('click', () => {
    // Close settings first
    document.getElementById('settingsOverlay')?.classList.remove('is-open');
    openClientsManager();
  });

  closeBtn?.addEventListener('click',   () => overlay.classList.remove('is-open'));
  overlay?.addEventListener('click',    e => { if (e.target === overlay) overlay.classList.remove('is-open'); });

  formClose?.addEventListener('click',   () => formOverlay.classList.remove('is-open'));
  formOverlay?.addEventListener('click', e => { if (e.target === formOverlay) formOverlay.classList.remove('is-open'); });

  onbClose?.addEventListener('click',   () => onbOverlay.classList.remove('is-open'));
  onbCopy?.addEventListener('click', () => {
    const txt = onbText?.textContent || '';
    navigator.clipboard.writeText(txt)
      .then(() => showToast('Onboarding message copied!', 'success'))
      .catch(() => showToast('Copy failed — please copy manually.', 'error'));
  });

  btnAdd?.addEventListener('click', () => openClientForm(null));
  saveBtn?.addEventListener('click', saveClient);

  // Event delegation for edit / activate toggle
  tableBody?.addEventListener('click', e => {
    const editBtn  = e.target.closest('[data-edit-client]');
    const togBtn   = e.target.closest('[data-toggle-client]');
    if (editBtn) openClientForm(editBtn.dataset.editClient);
    if (togBtn)  toggleClientActive(togBtn.dataset.toggleClient);
  });

  // ── Functions ───────────────────────────────────────────────────────────────
  function openClientsManager() {
    renderClientsTable();
    overlay.classList.add('is-open');
  }

  function renderClientsTable() {
    if (!tableBody) return;
    const clients = loadClients();
    if (!clients.length) {
      tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:2rem">No clients yet — click Add Client to create one.</td></tr>';
      return;
    }
    tableBody.innerHTML = clients.map(c => `
      <tr class="${c.active ? '' : 'client-row--inactive'}">
        <td>
          <div style="font-weight:600">${escHtml(c.businessName)}</div>
          ${c.ownerName ? `<div style="font-size:0.75rem;color:var(--text-muted)">${escHtml(c.ownerName)}</div>` : ''}
        </td>
        <td>${escHtml(c.email)}</td>
        <td><span class="plan-badge plan-badge--${(c.plan || 'starter').toLowerCase()}">${escHtml(c.plan || 'Starter')}</span></td>
        <td>
          <span class="status-dot ${c.active ? 'status-dot--green' : 'status-dot--red'}"></span>
          ${c.active ? 'Active' : 'Inactive'}
        </td>
        <td>${c.createdDate ? c.createdDate.slice(0, 10) : '—'}</td>
        <td class="client-row-actions">
          <button class="client-action-btn" data-edit-client="${c.uuid}">Edit</button>
          <button class="client-action-btn client-action-btn--danger" data-toggle-client="${c.uuid}">
            ${c.active ? 'Deactivate' : 'Activate'}
          </button>
        </td>
      </tr>
    `).join('');
  }

  function openClientForm(uuid) {
    editingClientId = uuid || null;
    if (formTitle) formTitle.textContent = uuid ? 'Edit Client' : 'Add Client';
    if (formMsg)   { formMsg.textContent = ''; formMsg.className = 'settings-msg'; }

    const pwHint = document.getElementById('cf_password_hint');

    if (uuid) {
      const client = loadClients().find(c => c.uuid === uuid);
      if (client) {
        const fields = ['businessName','ownerName','email','phone','abn','plan',
                        'servicem8ApiKey','googleSheetUrl','myobApiKey','xeroApiKey'];
        fields.forEach(key => {
          const el = document.getElementById('cf_' + key);
          if (el) el.value = client[key] || '';
        });
        const ttEl = document.getElementById('cf_tradeType');
        if (ttEl) ttEl.value = client.tradeType || 'bricklayer';
        const pwEl = document.getElementById('cf_password');
        if (pwEl) pwEl.value = '';
        if (pwHint) pwHint.style.display = '';
      }
    } else {
      const allFields = ['cf_businessName','cf_ownerName','cf_email','cf_phone','cf_abn',
                         'cf_servicem8ApiKey','cf_googleSheetUrl','cf_myobApiKey','cf_xeroApiKey','cf_password'];
      allFields.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      const planEl = document.getElementById('cf_plan');
      if (planEl) planEl.value = 'Starter';
      const ttEl = document.getElementById('cf_tradeType');
      if (ttEl) ttEl.value = 'bricklayer';
      if (pwHint) pwHint.style.display = 'none';
    }

    formOverlay.classList.add('is-open');
  }

  function saveClient() {
    const businessName = document.getElementById('cf_businessName')?.value.trim() || '';
    const ownerName    = document.getElementById('cf_ownerName')?.value.trim()    || '';
    const email        = (document.getElementById('cf_email')?.value.trim() || '').toLowerCase();
    const password     = document.getElementById('cf_password')?.value             || '';
    const phone        = document.getElementById('cf_phone')?.value.trim()         || '';
    const abn          = document.getElementById('cf_abn')?.value.trim()           || '';
    const plan         = document.getElementById('cf_plan')?.value                 || 'Starter';
    const tradeType    = document.getElementById('cf_tradeType')?.value             || 'bricklayer';
    const sm8Key       = document.getElementById('cf_servicem8ApiKey')?.value.trim() || '';
    const sheetUrl     = document.getElementById('cf_googleSheetUrl')?.value.trim()  || '';
    const myobKey      = document.getElementById('cf_myobApiKey')?.value.trim()      || '';
    const xeroKey      = document.getElementById('cf_xeroApiKey')?.value.trim()      || '';

    if (!businessName) { showFormMsg('Business name is required.', 'err'); return; }
    if (!email || !email.includes('@')) { showFormMsg('A valid email address is required.', 'err'); return; }
    if (!editingClientId && !password) { showFormMsg('Password is required for new clients.', 'err'); return; }
    if (password && password.length < 6) { showFormMsg('Password must be at least 6 characters.', 'err'); return; }

    const clients = loadClients();
    const dupe = clients.find(c => c.email === email && c.uuid !== editingClientId);
    if (dupe) { showFormMsg('A client with that email already exists.', 'err'); return; }

    let client;
    if (editingClientId) {
      client = clients.find(c => c.uuid === editingClientId);
      if (!client) { showFormMsg('Client not found.', 'err'); return; }
    } else {
      client = {
        uuid:         genUUID(),
        createdDate:  new Date().toISOString(),
        active:       true,
        passwordHash: '',
      };
      clients.push(client);
    }

    client.businessName    = businessName;
    client.ownerName       = ownerName;
    client.email           = email;
    client.phone           = phone;
    client.abn             = abn;
    client.plan            = plan;
    client.tradeType       = tradeType;
    client.servicem8ApiKey = sm8Key;
    client.googleSheetUrl  = sheetUrl;
    client.myobApiKey      = myobKey;
    client.xeroApiKey      = xeroKey;
    if (password) client.passwordHash = hashPw(password);

    saveClients(clients);
    showFormMsg(editingClientId ? 'Client updated!' : 'Client created!', 'ok');

    // Capture before editingClientId is cleared
    const isNew       = !editingClientId;
    const savedClient = client;
    const tempPw      = password;

    setTimeout(() => {
      formOverlay.classList.remove('is-open');
      renderClientsTable();
      if (isNew) showOnboarding(savedClient, tempPw);
    }, 700);
  }

  function showFormMsg(msg, type) {
    if (!formMsg) return;
    formMsg.textContent = msg;
    formMsg.className = `settings-msg settings-msg--${type}`;
  }

  function toggleClientActive(uuid) {
    const clients = loadClients();
    const client  = clients.find(c => c.uuid === uuid);
    if (!client) return;
    client.active = !client.active;
    saveClients(clients);
    renderClientsTable();
    showToast(`${client.businessName} ${client.active ? 'activated' : 'deactivated'}.`, 'success');
  }

  function showOnboarding(client, tempPassword) {
    const sheetNote = client.googleSheetUrl
      ? '3. Your Google Sheet data feed is connected and ready.'
      : '3. To connect Google Sheets: contact your Dynasty OS admin to set up your data feed.';

    const msg =
      `Welcome to Dynasty OS!\n` +
      `${'─'.repeat(40)}\n\n` +
      `Hi ${client.ownerName || client.businessName},\n\n` +
      `Your Dynasty OS dashboard is ready. Here are your login details:\n\n` +
      `  Dashboard URL:  https://dynastyos.com.au/dashboard.html\n` +
      `  Email:          ${client.email}\n` +
      `  Password:       ${tempPassword}\n` +
      `  Plan:           ${client.plan}\n\n` +
      `GETTING STARTED\n` +
      `${'─'.repeat(40)}\n` +
      `1. Go to the Dashboard URL above and click "Client Portal".\n` +
      `2. Log in with your email and password above.\n` +
      `${sheetNote}\n` +
      (client.servicem8ApiKey
        ? `4. ServiceM8 is connected — your jobs will load automatically.\n`
        : `4. To connect ServiceM8: contact your Dynasty OS admin with your SM8 API key.\n`) +
      `\n` +
      `Questions? Reply to this message or contact Jake at jake@dynastyos.com.au\n\n` +
      `— Jake @ Dynasty OS`;

    if (onbText) onbText.textContent = msg;
    if (onbOverlay) onbOverlay.classList.add('is-open');
  }

  // Expose so app.js settings handler can show/hide this section
  window.refreshClientsSection = function() {
    const section = document.getElementById('settingsClientsSection');
    if (section) section.hidden = !isFullMode();
  };
})();
