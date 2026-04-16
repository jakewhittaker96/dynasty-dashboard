/* =============================================
   DYNASTY DASHBOARD — app.js
   Multi-site Google Sheets integration
   ============================================= */

'use strict';

// ─── PIN storage (module-level so settings can update them) ──────────────────
const PIN_KEY             = 'dynasty-pin';
const PORTAL_PIN_KEY      = 'dynasty-portal-pin';
const ANTHROPIC_KEY_STORE = 'dynasty-anthropic-key';
const BUILDER_PIN         = '7777';
let currentFullPin        = localStorage.getItem(PIN_KEY)        || '0220';
const PORTAL_PIN          = localStorage.getItem(PORTAL_PIN_KEY) || '9999';

function isPortal()  { return sessionStorage.getItem('dynasty-mode') === 'portal'; }
function isBuilder() { return sessionStorage.getItem('dynasty-mode') === 'builder'; }
function isFullMode(){ return sessionStorage.getItem('dynasty-mode') === 'full'; }
function isClient()  { return sessionStorage.getItem('dynasty-mode') === 'client'; }

// ─── Client config helpers ────────────────────────────────────────────────────
function applyClientConfig(client) {
  if (!client) return;
  if (client.servicem8ApiKey) SM8_API_KEY = client.servicem8ApiKey;
  if (client.googleSheetUrl)  SHEET_CSV_URL = client.googleSheetUrl;
}

function applyClientUI(client) {
  if (!client) return;
  // Plan badge
  const badge = document.getElementById('clientPlanBadge');
  if (badge) {
    badge.textContent = client.plan || 'Starter';
    badge.className   = `client-plan-badge client-plan-badge--${(client.plan || 'starter').toLowerCase()}`;
    badge.hidden      = false;
  }
  // Business name display
  const nameEl = document.getElementById('clientNameDisplay');
  if (nameEl) {
    nameEl.textContent = client.businessName || '';
    nameEl.hidden      = false;
  }
  // Hide owner-only controls
  const settingsBtn = document.getElementById('btnSettings');
  if (settingsBtn) settingsBtn.hidden = true;
}

// ─── Authentication (PIN + Client email/password) ─────────────────────────────
(function initAuth() {
  const AUTH_KEY    = 'dynasty-auth';
  const loginScreen = document.getElementById('loginScreen');
  const dashboard   = document.getElementById('dashboardRoot');
  const pinInput    = document.getElementById('pinInput');
  const loginBtn    = document.getElementById('loginBtn');
  const loginError  = document.getElementById('loginError');

  // Client login elements
  const clientEmailInput    = document.getElementById('clientEmailInput');
  const clientPasswordInput = document.getElementById('clientPasswordInput');
  const clientLoginBtn      = document.getElementById('clientLoginBtn');
  const clientLoginError    = document.getElementById('clientLoginError');

  // Mode toggle
  const btnLoginOwner   = document.getElementById('btnLoginOwner');
  const btnLoginClient  = document.getElementById('btnLoginClient');
  const ownerLoginForm  = document.getElementById('ownerLoginForm');
  const clientLoginForm = document.getElementById('clientLoginForm');

  function setLoginMode(mode) {
    const isClient = mode === 'client';
    if (ownerLoginForm)  ownerLoginForm.style.display  = isClient ? 'none' : '';
    if (clientLoginForm) clientLoginForm.style.display = isClient ? '' : 'none';
    btnLoginOwner?.classList.toggle('login-mode-btn--active',  !isClient);
    btnLoginClient?.classList.toggle('login-mode-btn--active',  isClient);
  }
  window.setLoginMode = setLoginMode;

  btnLoginOwner?.addEventListener('click',  () => setLoginMode('owner'));
  btnLoginClient?.addEventListener('click', () => setLoginMode('client'));

  function unlock(mode, clientData) {
    sessionStorage.setItem(AUTH_KEY, '1');
    sessionStorage.setItem('dynasty-mode', mode);
    if (mode === 'client' && clientData) {
      sessionStorage.setItem('dynasty-client-uuid', clientData.uuid);
      applyClientConfig(clientData);
    }
    loginScreen.style.display = 'none';
    dashboard.hidden = false;
    if (mode === 'portal') {
      const wm = document.getElementById('portalWatermark');
      if (wm) wm.hidden = false;
    }
    if (mode === 'builder') {
      const wm = document.getElementById('builderWatermark');
      if (wm) wm.hidden = false;
    }
    if (mode === 'client' && clientData) {
      applyClientUI(clientData);
    }
  }

  // ── Already authenticated this session ─────────────────────────────────────
  if (sessionStorage.getItem(AUTH_KEY) === '1') {
    loginScreen.style.display = 'none';
    dashboard.hidden = false;
    const mode = sessionStorage.getItem('dynasty-mode');
    if (mode === 'portal') {
      const wm = document.getElementById('portalWatermark');
      if (wm) wm.hidden = false;
    }
    if (mode === 'builder') {
      const wm = document.getElementById('builderWatermark');
      if (wm) wm.hidden = false;
    }
    if (mode === 'client') {
      const uuid = sessionStorage.getItem('dynasty-client-uuid');
      if (uuid) {
        try {
          const clients = JSON.parse(localStorage.getItem('dynastyClients') || '[]');
          const client  = clients.find(c => c.uuid === uuid);
          if (client && client.active) {
            applyClientConfig(client);
            applyClientUI(client);
          }
        } catch (_) { /* ignore */ }
      }
    }
    return;
  }

  // ── PIN login attempt ───────────────────────────────────────────────────────
  function attempt() {
    const pin = pinInput.value;
    if (pin === currentFullPin) {
      loginError.hidden = true;
      unlock('full');
    } else if (pin === PORTAL_PIN) {
      loginError.hidden = true;
      unlock('portal');
    } else if (pin === BUILDER_PIN) {
      loginError.hidden = true;
      unlock('builder');
    } else {
      loginError.hidden = false;
      pinInput.value = '';
      pinInput.focus();
    }
  }

  // ── Client email/password login attempt ─────────────────────────────────────
  function attemptClientLogin() {
    const email    = clientEmailInput?.value.trim()  || '';
    const password = clientPasswordInput?.value       || '';

    if (!email || !password) {
      if (clientLoginError) {
        clientLoginError.textContent = 'Please enter your email and password.';
        clientLoginError.hidden = false;
      }
      return;
    }

    // findClientByEmail and checkClientPassword are defined in clients.js
    // clients.js loads after app.js, so we access them via window at call time
    const client = typeof window.findClientByEmail === 'function'
      ? window.findClientByEmail(email)
      : null;

    if (!client || !client.active) {
      if (clientLoginError) {
        clientLoginError.textContent = 'Account not found or inactive. Contact your Dynasty OS admin.';
        clientLoginError.hidden = false;
      }
      if (clientPasswordInput) clientPasswordInput.value = '';
      return;
    }

    const valid = typeof window.checkClientPassword === 'function'
      ? window.checkClientPassword(password, client.passwordHash)
      : false;

    if (!valid) {
      if (clientLoginError) {
        clientLoginError.textContent = 'Incorrect email or password.';
        clientLoginError.hidden = false;
      }
      if (clientPasswordInput) clientPasswordInput.value = '';
      return;
    }

    if (clientLoginError) clientLoginError.hidden = true;
    unlock('client', client);
  }

  loginBtn.addEventListener('click', attempt);
  pinInput.addEventListener('keydown', e => { if (e.key === 'Enter') attempt(); });

  clientLoginBtn?.addEventListener('click', attemptClientLogin);
  clientEmailInput?.addEventListener('keydown',    e => { if (e.key === 'Enter') clientPasswordInput?.focus(); });
  clientPasswordInput?.addEventListener('keydown', e => { if (e.key === 'Enter') attemptClientLogin(); });
})();

// ─── Sheet URL ────────────────────────────────────────────────────────────────
let SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vTvsSIicwnMasEr8OQIilHtmjC0PAAgGh4WHxB3yJMNPv8feICE5MM97xFz6G0OTkpjWs7EZheqtB8G/pub?output=csv';

// ServiceM8 API
const SM8_URL     = 'https://api.servicem8.com/api_1.0/job.json';
let   SM8_API_KEY = 'smk-aa87cc-9a9a0a802a22e535-394394c0f2a1d836';

// Ordered list of CORS proxies tried in sequence until one returns valid CSV
const CORS_PROXIES = [
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

// Column mapping (0-indexed):
// A[0]=Timestamp, B[1]=Date, C[2]=Job Site, D[3]=Crew, E[4]=Bricks Today,
// F[5]=Running Total, G[6]=Progress%, H[7]=Est Days, I[8]=Done Today,
// J[9]=Problems, K[10]=Materials Tomorrow, L[11]=Boss Note

// ─── Module state ─────────────────────────────────────────────────────────────
let chartBricks       = null;
let chartProgress     = null;
let chartCrew         = null;
let chartWeeklyTrend  = null;
let currentBySite = null; // Map<siteName, rows[]>
let activeTab     = '__all__';
let jobsLoaded       = false;
let activeJobsData   = [];        // active jobs, sorted — source of truth for filtering
let jobsStatusFilter = '__all__'; // current status pill selection
let jobsSearchText   = '';        // current search string (lower-cased)
let sm8Materials     = null;      // fetched jobmaterial.json data (null = not loaded)
let sm8Activities    = null;      // fetched jobactivity.json data (null = not loaded)
let sm8CompanyMap    = new Map(); // uuid → company_name, populated on first SM8 load
let showProfit         = false;   // whether Profit column is visible
let showOldWorkOrders  = true;    // show Work Orders older than 90 days in overdue panel

// ─── Weather & new feature state ─────────────────────────────────────────────
const siteWeatherCache = new Map(); // siteName → { fetched, data, rain3day }
const WEATHER_TTL      = 30 * 60 * 1000; // 30 min cache TTL

function loadSubbies() {
  try { return JSON.parse(localStorage.getItem('dynasty-subbies') || '[]'); } catch { return []; }
}
function saveSubbies(arr) { localStorage.setItem('dynasty-subbies', JSON.stringify(arr)); }

const DEFAULT_BRICK_PRICES = [
  { name: 'Standard Red Brick',     unit: '1000 bricks', price: 980,  updated: null },
  { name: 'Cream Face Brick',       unit: '1000 bricks', price: 1250, updated: null },
  { name: 'Concrete Block 190mm',   unit: '100 blocks',  price: 290,  updated: null },
  { name: 'Mortar (Bagged Mix)',     unit: '40kg bag',    price: 14,   updated: null },
  { name: 'Besser Block 390mm',     unit: '100 blocks',  price: 310,  updated: null },
];
function loadChaseLog() {
  try { return JSON.parse(localStorage.getItem('dynasty-chase-log') || '{}'); } catch { return {}; }
}
function saveChaseLog(obj) { localStorage.setItem('dynasty-chase-log', JSON.stringify(obj)); }

function loadSafetyData() {
  const d = { talks: [], incidents: [] };
  try { return JSON.parse(localStorage.getItem('dynasty-safety') || 'null') || d; } catch { return d; }
}
function saveSafetyData(obj) { localStorage.setItem('dynasty-safety', JSON.stringify(obj)); }

function loadBrickPrices() {
  try {
    const saved = JSON.parse(localStorage.getItem('dynasty-brick-prices') || 'null');
    if (!saved || !Array.isArray(saved)) return DEFAULT_BRICK_PRICES.map(p => ({...p}));
    return saved;
  } catch { return DEFAULT_BRICK_PRICES.map(p => ({...p})); }
}
function saveBrickPrices(arr) { localStorage.setItem('dynasty-brick-prices', JSON.stringify(arr)); }

// ─── Business filter ─────────────────────────────────────────────────────────
const BIZ_KEY = 'dynasty-biz-filter';
let activeBiz = localStorage.getItem(BIZ_KEY) || 'all'; // 'all' | 'bricklaying' | 'pressure'

const BIZ_KEYWORDS = {
  bricklaying: ['brick', 'block', 'footing', 'mortar', 'rwb', 'veneer', 'wall', 'render', 'paving'],
  pressure:    ['clean', 'pressure', 'solar', 'roof', 'driveway', 'wash', 'gutter', 'high-pres'],
};

function jobMatchesBiz(job) {
  if (activeBiz === 'all') return true;
  const kws  = BIZ_KEYWORDS[activeBiz] || [];
  const text = ((job.job_description || '') + ' ' + (job.job_address || '')).toLowerCase();
  return kws.some(k => text.includes(k));
}

function filterByBiz(jobs) {
  return activeBiz === 'all' ? jobs : jobs.filter(jobMatchesBiz);
}

function isPaid(job) {
  const v = job.payment_received;
  return v === 1 || v === '1';
}

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const dom = {
  btnRefresh:      $('btnRefresh'),
  lastUpdated:     $('lastUpdated'),
  tabBar:          $('tabBar'),
  // Views
  viewAll:         $('viewAll'),
  viewSite:        $('viewSite'),
  viewJobs:        $('viewJobs'),
  viewPipeline:    $('viewPipeline'),
  viewFinance:     $('viewFinance'),
  viewRisk:        $('viewRisk'),
  viewSubbies:     $('viewSubbies'),
  viewSafety:      $('viewSafety'),
  viewSchedule:    $('viewSchedule'),
  // Jobs tab
  jobsRevenue:     $('jobsRevenue'),
  jobsSearch:      $('jobsSearch'),
  jobsFilterPills: $('jobsFilterPills'),
  jobsCount:       $('jobsCount'),
  jobsTableBody:   $('jobsTableBody'),
  // Pipeline tab
  pipelineProjected:   $('pipelineProjected'),
  pipelineConversion:  $('pipelineConversion'),
  pipelineOverdue:     $('pipelineOverdue'),
  pipelineStaleQuotes: $('pipelineStaleQuotes'),
  // Finance tab
  financeProjected:     $('financeProjected'),
  // All Jobs KPIs
  ovTotalBricks:   $('ovTotalBricks'),
  ovTotalCrew:     $('ovTotalCrew'),
  ovActiveSites:   $('ovActiveSites'),
  ovTotalProblems: $('ovTotalProblems'),
  ovProblemsCard:  $('ovProblemsCard'),
  alertsBanner:        $('alertsBanner'),
  siteCardsGrid:       $('siteCardsGrid'),
  completionCountdown: $('completionCountdown'),
  allMaterialsPanel:   $('allMaterialsPanel'),
  weeklySummary:       $('weeklySummary'),
  // Single site
  jobLabel:        $('jobLabel'),
  bossNote:        $('bossNote'),
  bossNoteText:    $('bossNoteText'),
  kpiBricks:       $('kpiBricks'),
  kpiBricksTrend:  $('kpiBricksTrend'),
  kpiCrew:         $('kpiCrew'),
  kpiProgress:     $('kpiProgress'),
  progressBar:     $('progressBar'),
  kpiDays:         $('kpiDays'),
  kpiTotal:        $('kpiTotal'),
  kpiProblems:     $('kpiProblems'),
  problemsCard:    $('problemsCard'),
  siteAverages:    $('siteAverages'),
  doneTodayText:   $('doneTodayText'),
  problemList:     $('problemList'),
  materialsList:   $('materialsList'),
  tableBody:       $('tableBody'),
};

// ─── Utilities ────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info', duration = 3500) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className = `toast toast--${type}`;
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), duration);
}

function showLoading() {
  let el = document.querySelector('.loading-overlay');
  if (!el) {
    el = document.createElement('div');
    el.className = 'loading-overlay';
    el.innerHTML = '<div class="spinner"></div><div class="loading-text">Fetching live data…</div>';
    document.body.appendChild(el);
  }
  el.classList.remove('hidden');
}

function hideLoading() {
  const el = document.querySelector('.loading-overlay');
  if (el) el.classList.add('hidden');
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

// Strip time component so "14/04/2026 12:00:00" → "14/04/2026"
function cleanDateStr(s) {
  return (s || '').trim().split(/[\sT]/)[0];
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  try {
    const clean = cleanDateStr(dateStr);
    // DD/MM/YYYY or D/M/YYYY — Australian / UK Google Sheets format
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(clean)) {
      const [d, m, y] = clean.split('/');
      const dt = new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}T12:00:00`);
      return isNaN(dt) ? null : dt;
    }
    // YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
      const dt = new Date(clean + 'T12:00:00');
      return isNaN(dt) ? null : dt;
    }
    // Fallback — let JS try, avoiding timezone shift by appending noon
    const dt = new Date(clean.includes('T') ? clean : clean + 'T12:00:00');
    return isNaN(dt) ? null : dt;
  } catch { return null; }
}

function formatDateShort(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return dateStr || '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function timeAgo(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return formatDateShort(dateStr);
  const now = new Date();
  const dDay     = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const todayDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((todayDay - dDay) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return `${diffDays} days ago`;
}

// Three-state site status: 'problem' | 'behind' | 'ontrack'
function getSiteStatus(siteName, rows) {
  const latest = rows[rows.length - 1];
  // Problem: latest entry has a problem that hasn't been resolved
  if (latest.problems && latest.problems.trim()) {
    const resolved    = loadResolved();
    const resolvedSet = new Set(resolved.map(r => r.key));
    if (!resolvedSet.has(alertKey(siteName, latest.date))) return 'problem';
  }
  // Behind: current days left is more than 20% above the first recorded estimate
  const firstDaysLeft = rows[0].daysLeft;
  if (firstDaysLeft > 0 && latest.daysLeft > firstDaysLeft * 1.2) return 'behind';
  return 'ontrack';
}

function startOfWeek(d) {
  // Monday-based week
  const day = d.getDay(); // 0=Sun … 6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diff);
  mon.setHours(0, 0, 0, 0);
  return mon;
}

// ─── CSV fetch & parse ────────────────────────────────────────────────────────
async function fetchCSV() {
  // 1. Try direct — works when served from a real web server (GitHub Pages, localhost)
  try {
    console.log('[Dynasty] Trying direct fetch…');
    const res = await fetch(SHEET_CSV_URL);
    if (res.ok) {
      const text = await res.text();
      console.log('[Dynasty] Direct fetch succeeded. First 200 chars:', text.slice(0, 200));
      return text;
    }
    console.warn('[Dynasty] Direct fetch HTTP', res.status);
  } catch (err) {
    console.warn('[Dynasty] Direct fetch threw (CORS expected on file://):', err.message);
  }

  // 2. Try each CORS proxy in order until one returns valid CSV
  for (let i = 0; i < CORS_PROXIES.length; i++) {
    const proxyUrl = CORS_PROXIES[i](SHEET_CSV_URL);
    console.log(`[Dynasty] Trying proxy ${i + 1}/${CORS_PROXIES.length}:`, proxyUrl);
    try {
      const res = await fetch(proxyUrl);
      console.log(`[Dynasty] Proxy ${i + 1} status: HTTP ${res.status}`);
      if (!res.ok) {
        console.warn(`[Dynasty] Proxy ${i + 1} returned HTTP ${res.status} — trying next.`);
        continue;
      }
      const text = await res.text();
      console.log(`[Dynasty] Proxy ${i + 1} raw response (first 400 chars):`, text.slice(0, 400));
      // Reject if the proxy returned an HTML error page instead of CSV
      if (text.trimStart().startsWith('<')) {
        console.warn(`[Dynasty] Proxy ${i + 1} returned HTML, not CSV — trying next.`);
        continue;
      }
      console.log(`[Dynasty] Proxy ${i + 1} returned valid CSV ✓`);
      return text;
    } catch (err) {
      console.warn(`[Dynasty] Proxy ${i + 1} threw:`, err.message);
    }
  }

  throw new Error('All fetch attempts failed — check console for details.');
}

function splitCSVLine(line) {
  const cols = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  cols.push(cur.trim());
  return cols;
}

function parseCSV(csv) {
  const lines = csv.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  // ── Debug: log raw column values so date/number issues are visible in console
  console.log('[Dynasty] Header row :', lines[0]);
  lines.slice(1, 4).forEach((line, i) => {
    const c = splitCSVLine(line);
    console.log(`[Dynasty] Raw row ${i + 1} — A(timestamp)="${c[0]}" B(date)="${c[1]}" C(site)="${c[2]}" D(crew)="${c[3]}" E(bricks)="${c[4]}"`);
  });

  const rows = lines.slice(1).map(line => {
    const c = splitCSVLine(line);
    return {
      timestamp:    c[0]  || '',
      date:         c[1]  || '',
      jobSite:      c[2]  || '',
      crew:         parseFloat(c[3])  || 0,
      crewName:     c[3]  || '',
      bricks:       parseFloat(c[4])  || 0,
      runningTotal: parseFloat(c[5])  || 0,
      progress:     parseFloat(c[6])  || 0,
      daysLeft:     parseFloat(c[7])  || 0,
      doneToday:    c[8]  || '',
      problems:     c[9]  || '',
      materials:    c[10] || '',
      bossNote:     c[11] || '',
      weatherDelay: (c[12] || '').trim(),   // "Yes" or "No"
      photoUrl:     (c[13] || '').trim(),   // Google Drive file URL
    };
  }).filter(r => r.date || r.timestamp);

  console.log(`[Dynasty] Parsed ${rows.length} rows. Dates:`,  rows.slice(0, 5).map(r => r.date));
  console.log('[Dynasty] Bricks/Crew (first 5):', rows.slice(0, 5).map(r => `${r.bricks}/${r.crew}`));
  return rows;
}

// ─── Group rows by site ────────────────────────────────────────────────────────
function groupBySite(rows) {
  const map = new Map();
  for (const row of rows) {
    const site = (row.jobSite || '').trim();
    if (!site) continue; // ignore blank / missing job site
    if (!map.has(site)) map.set(site, []);
    map.get(site).push(row);
  }
  // Sort each site's rows by date ascending so rows[last] = most recent entry
  for (const siteRows of map.values()) {
    siteRows.sort((a, b) => {
      const da = parseDate(a.date), db = parseDate(b.date);
      if (!da && !db) return 0;
      if (!da) return -1;
      if (!db) return 1;
      return da - db;
    });
    // Compute cumulative running total from bricks column (replaces column F)
    let running = 0;
    for (const row of siteRows) {
      running += row.bricks || 0;
      row.calcRunningTotal = running;
    }
  }
  return map;
}

// ─── Tab management ───────────────────────────────────────────────────────────
function buildTabs(bySite) {
  dom.tabBar.innerHTML = '';
  const portal = isPortal();

  const makeTab = (key, label, count) => {
    const btn = document.createElement('button');
    btn.className = 'tab' + (key === activeTab ? ' tab--active' : '');
    btn.dataset.site = key;
    btn.innerHTML = escHtml(label) +
      (count != null ? `<span class="tab-count">${count}</span>` : '') +
      `<span class="tab-badge" id="badge-${key}" hidden></span>`;
    btn.addEventListener('click', () => switchTab(key));
    dom.tabBar.appendChild(btn);
  };

  const builder = isBuilder();

  makeTab('__all__', 'All Jobs', null);
  if (!portal && !builder) {
    makeTab('__jobs__',     'Jobs',     null);
    makeTab('__pipeline__', 'Pipeline', null);
    makeTab('__finance__',  'Finance',  null);
    makeTab('__risk__',     'Risk Report', null);
    makeTab('__subbies__',  'Subbies',  null);
    makeTab('__safety__',   'Safety',   null);
    makeTab('__schedule__', 'Schedule', null);
  }

  // Hide biz toggle in portal/builder mode
  const bizToggle = document.getElementById('bizToggle');
  if (bizToggle) bizToggle.style.display = (portal || builder) ? 'none' : '';

  // If restricted mode and current tab is not allowed, switch to all
  if ((portal || builder) && activeTab !== '__all__') {
    activeTab = '__all__';
  }
}

function updateTabBadges(jobs) {
  const now = new Date();
  const MS  = 1000 * 60 * 60 * 24;

  // Jobs tab: unpaid completed jobs that haven't been chased yet
  const chaseLog        = loadChaseLog();
  const unpaidCompleted = jobs.filter(j =>
    j.status === 'Completed' && !isPaid(j) &&
    parseFloat(j.total_invoice_amount || 0) > 0 && !chaseLog[j.uuid]
  ).length;

  // Pipeline tab: overdue work orders (>30 days old)
  const overdueCount = jobs.filter(j => {
    if (j.status !== 'Work Order') return false;
    const d = new Date((j.date || '').substring(0, 10) + 'T00:00:00');
    return !isNaN(d) && (now - d) / MS > 30;
  }).length;

  // Finance tab: unpaid completed jobs older than 60 days
  const overdueUnpaid = jobs.filter(j => {
    if (j.status !== 'Completed' || isPaid(j)) return false;
    const d = new Date((j.date || '').substring(0, 10) + 'T00:00:00');
    return !isNaN(d) && (now - d) / MS > 60;
  }).length;

  const setBadge = (id, count) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.hidden = count === 0;
    el.textContent = count > 9 ? '9+' : String(count);
  };

  setBadge('badge-__jobs__',     unpaidCompleted);
  setBadge('badge-__pipeline__', overdueCount);
  setBadge('badge-__finance__',  overdueUnpaid);
}

function switchTab(siteKey) {
  activeTab = siteKey;
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('tab--active', t.dataset.site === siteKey);
  });

  const showOnly = id => {
    dom.viewAll.hidden      = id !== 'all';
    dom.viewSite.hidden     = id !== 'site';
    dom.viewJobs.hidden     = id !== 'jobs';
    dom.viewPipeline.hidden = id !== 'pipeline';
    dom.viewFinance.hidden  = id !== 'finance';
    if (dom.viewRisk)      dom.viewRisk.hidden      = id !== 'risk';
    if (dom.viewSubbies)   dom.viewSubbies.hidden   = id !== 'subbies';
    if (dom.viewSafety)    dom.viewSafety.hidden    = id !== 'safety';
    if (dom.viewSchedule)  dom.viewSchedule.hidden  = id !== 'schedule';
  };

  if (siteKey === '__all__') {
    showOnly('all');
    renderAllJobs(currentBySite);
  } else if (siteKey === '__jobs__') {
    showOnly('jobs');
    loadServiceM8Data('__jobs__');
  } else if (siteKey === '__pipeline__') {
    showOnly('pipeline');
    loadServiceM8Data('__pipeline__');
  } else if (siteKey === '__finance__') {
    showOnly('finance');
    loadServiceM8Data('__finance__');
  } else if (siteKey === '__risk__') {
    showOnly('risk');
    renderRiskTab();
  } else if (siteKey === '__subbies__') {
    showOnly('subbies');
    renderSubbiesTab();
  } else if (siteKey === '__safety__') {
    showOnly('safety');
    renderSafetyTab();
  } else if (siteKey === '__schedule__') {
    showOnly('schedule');
    renderScheduleTab();
  }
}

// ─── Weekly / monthly summary (All Jobs view) ─────────────────────────────────
function renderWeeklySummary(bySite) {
  const now        = new Date();
  const weekStart  = startOfWeek(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const allRows = [];
  for (const [, rows] of bySite) allRows.push(...rows);

  const weekRows  = allRows.filter(r => { const d = parseDate(r.date); return d && d >= weekStart; });
  const monthRows = allRows.filter(r => { const d = parseDate(r.date); return d && d >= monthStart; });

  // Aggregate bricks and crew by date (summed across sites)
  const bricksByDate = {};
  const crewByDate   = {};
  for (const r of weekRows) {
    const key = r.date;
    bricksByDate[key] = (bricksByDate[key] || 0) + (r.bricks || 0);
    crewByDate[key]   = (crewByDate[key]   || 0) + (r.crew   || 0);
  }

  const weekDays   = Object.keys(bricksByDate).length;
  const weekBricks = Object.values(bricksByDate).reduce((s, v) => s + v, 0);
  const weekAvgBricks = weekDays > 0 ? Math.round(weekBricks / weekDays) : 0;

  let busiestDay = null, busiestBricks = 0;
  for (const [date, bricks] of Object.entries(bricksByDate)) {
    if (busiestDay === null || bricks > busiestBricks) { busiestDay = date; busiestBricks = bricks; }
  }

  const monthBricks  = monthRows.reduce((s, r) => s + (r.bricks || 0), 0);
  const totalCrewSum = Object.values(crewByDate).reduce((s, v) => s + v, 0);
  const weekAvgCrew  = weekDays > 0 ? (totalCrewSum / weekDays).toFixed(1) : '—';

  dom.weeklySummary.innerHTML = `
    <div class="weekly-summary-card">
      <h2 class="card-title"><span class="card-title-icon">&#128200;</span> Weekly &amp; Monthly Summary</h2>
      <div class="summary-grid">
        <div class="summary-stat">
          <div class="summary-stat-value">${weekBricks.toLocaleString()}</div>
          <div class="summary-stat-label">Bricks this week</div>
        </div>
        <div class="summary-stat">
          <div class="summary-stat-value">${weekAvgBricks.toLocaleString()}</div>
          <div class="summary-stat-label">Avg bricks / day this week</div>
        </div>
        <div class="summary-stat">
          <div class="summary-stat-value">${busiestDay ? formatDateShort(busiestDay) : '—'}</div>
          <div class="summary-stat-label">Busiest day this week</div>
        </div>
        <div class="summary-stat">
          <div class="summary-stat-value">${monthBricks.toLocaleString()}</div>
          <div class="summary-stat-label">Total bricks this month</div>
        </div>
        <div class="summary-stat">
          <div class="summary-stat-value">${weekAvgCrew}</div>
          <div class="summary-stat-label">Avg crew on site this week</div>
        </div>
      </div>
    </div>`;
}

// ─── Site averages section (single site view) ─────────────────────────────────
function renderSiteAverages(rows) {
  const withBricks = rows.filter(r => r.bricks > 0);
  const avgBricks  = withBricks.length > 0
    ? Math.round(withBricks.reduce((s, r) => s + r.bricks, 0) / withBricks.length)
    : 0;

  const latest      = rows[rows.length - 1];
  const totalBricks = latest.calcRunningTotal || rows.reduce((s, r) => s + (r.bricks || 0), 0);

  const withCrew = rows.filter(r => r.crew > 0);
  const avgCrew  = withCrew.length > 0
    ? (withCrew.reduce((s, r) => s + r.crew, 0) / withCrew.length).toFixed(1)
    : '—';

  dom.siteAverages.innerHTML = `
    <div class="site-averages-card">
      <h2 class="card-title"><span class="card-title-icon">&#9650;</span> Job Averages</h2>
      <div class="site-averages-grid">
        <div class="summary-stat">
          <div class="summary-stat-value">${avgBricks.toLocaleString()}</div>
          <div class="summary-stat-label">Avg bricks / day</div>
        </div>
        <div class="summary-stat">
          <div class="summary-stat-value">${totalBricks.toLocaleString()}</div>
          <div class="summary-stat-label">Total bricks to date</div>
        </div>
        <div class="summary-stat">
          <div class="summary-stat-value">${avgCrew}</div>
          <div class="summary-stat-label">Avg crew size</div>
        </div>
      </div>
    </div>`;
}

// ─── Resolved problems — localStorage helpers ─────────────────────────────────
const RESOLVED_KEY = 'dynasty-resolved-problems';

function loadResolved() {
  try { return JSON.parse(localStorage.getItem(RESOLVED_KEY) || '[]'); }
  catch { return []; }
}

function saveResolved(list) {
  localStorage.setItem(RESOLVED_KEY, JSON.stringify(list));
}

// Unique key per problem: site + entry date (new date = new active problem)
function alertKey(site, date) { return `${site}::${date}`; }

// ─── Completed sites — localStorage helpers ───────────────────────────────────
const COMPLETED_SITES_KEY = 'dynasty-completed-sites';

function loadCompletedSites() {
  try { return JSON.parse(localStorage.getItem(COMPLETED_SITES_KEY) || '[]'); }
  catch { return []; }
}

function saveCompletedSites(list) {
  localStorage.setItem(COMPLETED_SITES_KEY, JSON.stringify(list));
}

// Update site card badges in-place without re-rendering charts
function refreshSiteCardBadges() {
  if (!currentBySite) return;
  dom.siteCardsGrid.querySelectorAll('.site-card[data-site]').forEach(card => {
    const rows = currentBySite.get(card.dataset.site);
    if (!rows) return;
    const status = getSiteStatus(card.dataset.site, rows);
    const badge  = card.querySelector('.site-card-badge');
    if (!badge) return;
    badge.className = 'site-card-badge site-card-badge--' +
      (status === 'problem' ? 'problem' : status === 'behind' ? 'behind' : 'ok');
    badge.innerHTML = status === 'problem' ? '&#9888; Problem'
      : status === 'behind'  ? '&#9650; Behind'
      : '&#10003; On Track';
  });
}

// ─── Active Problems sidebar (sits alongside Weekly Summary) ──────────────────
function renderAlertsBanner(bySite) {
  const resolved    = loadResolved();
  const resolvedSet = new Set(resolved.map(r => r.key));

  // Collect unresolved active problems
  const active = [];
  for (const [site, rows] of bySite) {
    const latest = rows[rows.length - 1];
    if (!latest.problems || !latest.problems.trim()) continue;
    const key = alertKey(site, latest.date);
    if (!resolvedSet.has(key)) {
      active.push({ site, text: latest.problems.trim(), date: latest.date, key });
    }
  }

  const hasActive   = active.length   > 0;
  const hasResolved = resolved.length > 0;

  dom.alertsBanner.innerHTML = `
    <div class="alerts-sidebar-card">
      <div class="alerts-sidebar-header">
        <span class="alerts-sidebar-icon">&#9888;</span>
        <span class="alerts-sidebar-title">Active Problems &amp; Alerts</span>
        ${hasActive ? `<span class="alerts-sidebar-count">${active.length}</span>` : ''}
      </div>

      ${hasActive ? `
      <div class="alerts-sidebar-list">
        ${active.map(a => `
          <div class="alerts-sidebar-item" data-site="${escHtml(a.site)}" tabindex="0"
               aria-label="View ${escHtml(a.site)} details">
            <div class="alerts-sidebar-item-top">
              <span class="alerts-sidebar-site">${escHtml(a.site)}</span>
              <span class="alerts-sidebar-when">${timeAgo(a.date)}</span>
            </div>
            <div class="alerts-sidebar-text">${escHtml(a.text)}</div>
            <button class="alert-resolve-btn"
                    data-key="${escHtml(a.key)}"
                    data-site="${escHtml(a.site)}"
                    data-text="${escHtml(a.text)}"
                    data-date="${escHtml(a.date)}"
                    title="Mark as resolved">&#10003; Resolve</button>
          </div>`).join('')}
      </div>` : `
      <div class="alerts-sidebar-clear">
        <span class="alerts-sidebar-clear-icon">&#10003;</span>
        <span>All clear — no active problems</span>
      </div>`}

      ${hasResolved ? `
      <div class="resolved-panel">
        <button class="resolved-header" id="resolvedToggle" aria-expanded="false">
          <span class="resolved-icon">&#10003;</span>
          <span class="resolved-title">Resolved (${resolved.length})</span>
          <span class="resolved-chevron" id="resolvedChevron">&#9660;</span>
        </button>
        <div class="resolved-list" id="resolvedList" hidden>
          ${resolved.map(r => `
            <div class="resolved-item">
              <div class="resolved-item-body">
                <span class="resolved-site">${escHtml(r.site)}</span>
                <span class="alert-sep">—</span>
                <span class="resolved-text">${escHtml(r.text)}</span>
              </div>
              <div class="resolved-meta">
                <span>Flagged: ${formatDateShort(r.date)}</span>
                <span class="resolved-sep">·</span>
                <span>Resolved: ${new Date(r.resolvedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                <button class="resolved-reopen-btn" data-key="${escHtml(r.key)}" title="Reopen this problem">Reopen</button>
              </div>
            </div>`).join('')}
        </div>
      </div>` : ''}
    </div>`;

  // Open site modal on item click (not if clicking Resolve button)
  dom.alertsBanner.querySelectorAll('.alerts-sidebar-item').forEach(el => {
    const go = () => openSiteModal(el.dataset.site);
    el.addEventListener('click', e => { if (!e.target.closest('.alert-resolve-btn')) go(); });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.target.closest('.alert-resolve-btn')) go(); });
  });

  // Resolve button
  dom.alertsBanner.querySelectorAll('.alert-resolve-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const { key, site, text, date } = btn.dataset;
      const list = loadResolved();
      if (!list.find(r => r.key === key)) {
        list.push({ key, site, text, date, resolvedAt: new Date().toISOString() });
        saveResolved(list);
      }
      renderAlertsBanner(currentBySite);
      refreshSiteCardBadges();
    });
  });

  // Collapsed resolved section toggle
  const toggleBtn  = document.getElementById('resolvedToggle');
  const resolvedUl = document.getElementById('resolvedList');
  const chevron    = document.getElementById('resolvedChevron');
  if (toggleBtn && resolvedUl) {
    toggleBtn.addEventListener('click', () => {
      const opening = resolvedUl.hidden;
      resolvedUl.hidden = !opening;
      chevron.innerHTML  = opening ? '&#9650;' : '&#9660;';
      toggleBtn.setAttribute('aria-expanded', String(opening));
    });
  }

  // Reopen button
  dom.alertsBanner.querySelectorAll('.resolved-reopen-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      saveResolved(loadResolved().filter(r => r.key !== btn.dataset.key));
      renderAlertsBanner(currentBySite);
      refreshSiteCardBadges();
    });
  });
}

// ─── Job completion countdown ─────────────────────────────────────────────────
function renderCompletionCountdown(bySite) {
  const items = [...bySite.entries()].map(([site, rows]) => {
    const latest   = rows[rows.length - 1];
    const prog     = Math.min(100, Math.max(0, latest.progress || 0));
    const daysLeft = latest.daysLeft || 0;

    let etaStr = '';
    if (daysLeft > 0) {
      const eta = new Date();
      eta.setDate(eta.getDate() + Math.round(daysLeft));
      etaStr = eta.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    const withBricks = rows.filter(r => r.bricks > 0);
    const avgBricks  = withBricks.length > 0
      ? Math.round(withBricks.reduce((s, r) => s + r.bricks, 0) / withBricks.length)
      : 0;

    return `
      <div class="countdown-item" data-site="${escHtml(site)}" role="button" tabindex="0"
           aria-label="View ${escHtml(site)} completion details">
        <div class="countdown-header">
          <span class="countdown-site">${escHtml(site)}</span>
          <span class="countdown-pct">${prog}%</span>
          ${etaStr ? `<span class="countdown-eta">Est. finish: ${escHtml(etaStr)}</span>` : ''}
        </div>
        <div class="countdown-bar-wrap">
          <div class="countdown-bar" style="width:${prog}%"></div>
        </div>
        <div class="countdown-meta">
          ${daysLeft ? `<span>&#128197; ${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining</span>` : ''}
          ${avgBricks ? `<span>&#9651; ${avgBricks.toLocaleString()} bricks/day avg</span>` : ''}
        </div>
      </div>`;
  });

  dom.completionCountdown.innerHTML = `
    <div class="countdown-card">
      <h2 class="card-title"><span class="card-title-icon">&#127937;</span> Job Completion Countdown</h2>
      <div class="countdown-list">${items.join('')}</div>
    </div>`;

  dom.completionCountdown.querySelectorAll('.countdown-item').forEach(el => {
    const go = () => openSiteModal(el.dataset.site);
    el.addEventListener('click', go);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') go(); });
  });
}

// ─── Weekly bricks trend chart (All Jobs) ─────────────────────────────────────
function buildWeeklyTrendChart(bySite) {
  const now       = new Date();
  const weekStart = startOfWeek(now);

  // One entry per day Mon–Sun
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  // Sum bricks across all sites per calendar day
  const bricksByKey = {};
  for (const [, rows] of bySite) {
    for (const r of rows) {
      const d = parseDate(r.date);
      if (!d) continue;
      const key = d.toDateString();
      bricksByKey[key] = (bricksByKey[key] || 0) + (r.bricks || 0);
    }
  }

  const labels = days.map(d =>
    d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  );
  const data   = days.map(d => bricksByKey[d.toDateString()] || 0);
  const todayStr = now.toDateString();

  if (chartWeeklyTrend) chartWeeklyTrend.destroy();

  chartWeeklyTrend = new Chart($('chartWeeklyTrend'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Bricks laid',
        data,
        borderColor: '#c9a84c',
        borderWidth: 2.5,
        pointBackgroundColor: days.map(d => d.toDateString() === todayStr ? '#e8c96a' : '#c9a84c'),
        pointRadius:          days.map(d => d.toDateString() === todayStr ? 7 : 4),
        pointHoverRadius: 8,
        fill: true,
        backgroundColor: ctx => {
          const c = ctx.chart;
          return c.chartArea ? goldGrad(c.ctx, c.chartArea) : 'rgba(201,168,76,0.1)';
        },
        tension: 0.3,
      }],
    },
    options: {
      ...JSON.parse(JSON.stringify(CHART_DEFAULTS)),
      plugins: { ...CHART_DEFAULTS.plugins, tooltip: { ...CHART_DEFAULTS.plugins.tooltip,
        callbacks: { label: ctx => ` ${ctx.parsed.y.toLocaleString()} bricks` },
      }},
      scales: { ...CHART_DEFAULTS.scales,
        y: { ...CHART_DEFAULTS.scales.y, min: 0,
          ticks: { ...CHART_DEFAULTS.scales.y.ticks, callback: v => v.toLocaleString() } },
      },
    },
  });
}

// ─── All-sites materials panel ────────────────────────────────────────────────
function renderAllMaterials(bySite) {
  // Only show materials logged today or yesterday (entry date within last 24 h)
  const now           = new Date();
  const yesterdayStart = new Date(now);
  yesterdayStart.setDate(now.getDate() - 1);
  yesterdayStart.setHours(0, 0, 0, 0);

  const entries = [];
  for (const [site, rows] of bySite) {
    const r = [...rows].reverse().find(r => r.materials && r.materials.trim());
    if (!r) continue;
    const entryDate = parseDate(r.date);
    if (!entryDate || entryDate < yesterdayStart) continue; // stale — skip
    entries.push({ site, materials: r.materials.trim(), date: r.date });
  }

  if (!entries.length) {
    dom.allMaterialsPanel.innerHTML = '';
    return;
  }

  const cards = entries.map(({ site, materials, date }) => {
    const items = materials.split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
    return `
      <div class="mat-card" data-site="${escHtml(site)}" role="button" tabindex="0"
           aria-label="Materials for ${escHtml(site)}">
        <div class="mat-card-header">
          <span class="mat-site">${escHtml(site)}</span>
          <span class="mat-date">${formatDateShort(date)}</span>
        </div>
        <ul class="mat-list">
          ${items.map(item => `<li class="mat-item">&#128230; ${escHtml(item)}</li>`).join('')}
        </ul>
      </div>`;
  });

  dom.allMaterialsPanel.innerHTML = `
    <div class="all-materials-panel">
      <h2 class="card-title"><span class="card-title-icon">&#128230;</span> Materials Needed Tomorrow — All Sites</h2>
      <div class="mat-grid">${cards.join('')}</div>
    </div>`;

  dom.allMaterialsPanel.querySelectorAll('.mat-card').forEach(el => {
    const go = () => openSiteModal(el.dataset.site);
    el.addEventListener('click', go);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') go(); });
  });
}

// ─── All Jobs overview ────────────────────────────────────────────────────────
function renderAllJobs(bySite) {
  // Builder mode gets a clean card-only view
  if (isBuilder()) { renderBuilderView(bySite); return; }

  const completedSet = new Set(loadCompletedSites().map(s => s.name));

  // Split sites into active and completed
  const activeSites    = [...bySite.entries()].filter(([name]) => !completedSet.has(name));

  let totalBricks   = 0;
  let totalCrew     = 0;
  let totalProblems = 0;

  for (const [, rows] of activeSites) {
    const latest = rows[rows.length - 1];
    totalBricks   += latest.bricks || 0;
    totalCrew     += latest.crew   || 0;
    totalProblems += rows.filter(r => r.problems && r.problems.trim()).length;
  }

  dom.ovTotalBricks.textContent   = totalBricks.toLocaleString();
  dom.ovTotalCrew.textContent     = totalCrew;
  dom.ovActiveSites.textContent   = activeSites.length;
  dom.ovTotalProblems.textContent = totalProblems || '0';

  if (totalProblems > 0) dom.ovProblemsCard.classList.add('has-problems');
  else                   dom.ovProblemsCard.classList.remove('has-problems');

  // Active site summary cards (click opens modal)
  const cards = activeSites.map(([siteName, rows]) => {
    const latest       = rows[rows.length - 1];
    const problems     = rows.filter(r => r.problems && r.problems.trim());
    const latestProb   = problems.length ? problems[problems.length - 1].problems : null;
    const latestMats   = [...rows].reverse().find(r => r.materials && r.materials.trim());
    const latestDone   = [...rows].reverse().find(r => r.doneToday && r.doneToday.trim());
    const prog         = Math.min(100, Math.max(0, latest.progress || 0));
    const status       = getSiteStatus(siteName, rows);
    const isWeather    = latest.weatherDelay === 'Yes';
    const totalBricks  = latest.calcRunningTotal || rows.reduce((s, r) => s + (r.bricks || 0), 0);
    // Add 1 day for weather delay
    const daysLeft     = (latest.daysLeft || 0) + (isWeather ? 1 : 0);

    const badgeHtml = isWeather
      ? `<span class="site-card-badge site-card-badge--weather">&#127783; Weather Day</span>`
      : status === 'problem'
        ? `<span class="site-card-badge site-card-badge--problem">&#9888; Problem</span>`
        : status === 'behind'
          ? `<span class="site-card-badge site-card-badge--behind">&#9650; Behind</span>`
          : `<span class="site-card-badge site-card-badge--ok">&#10003; On Track</span>`;

    return `
      <div class="site-card" data-site="${escHtml(siteName)}" role="button" tabindex="0"
           aria-label="View ${escHtml(siteName)} details">
        <div class="site-card-header">
          <span class="site-card-name">${escHtml(siteName)}</span>
          ${badgeHtml}
        </div>

        <div class="site-card-progress">
          <div class="progress-bar-wrap">
            <div class="progress-bar" style="width:${prog}%"></div>
          </div>
          <span class="site-card-pct">${latest.progress || 0}% complete</span>
        </div>

        <div class="site-card-stats">
          <div class="site-card-stat">
            <div class="site-card-stat-value">${latest.bricks ? latest.bricks.toLocaleString() : '—'}</div>
            <div class="site-card-stat-label">Bricks today</div>
          </div>
          <div class="site-card-stat">
            <div class="site-card-stat-value">${totalBricks.toLocaleString()}</div>
            <div class="site-card-stat-label">Total bricks</div>
          </div>
          <div class="site-card-stat">
            <div class="site-card-stat-value">${daysLeft || '—'}</div>
            <div class="site-card-stat-label">Days left${isWeather ? ' (+1)' : ''}</div>
          </div>
          <div class="site-card-stat">
            <div class="site-card-stat-value site-weather-badge" data-site-weather="${escHtml(siteName)}">…</div>
            <div class="site-card-stat-label">Weather</div>
          </div>
        </div>

        ${latestDone
          ? `<div class="site-card-done">&#10003; ${escHtml(latestDone.doneToday)}</div>`
          : ''}
        ${isWeather
          ? `<div class="site-card-weather">&#127783; Weather delay — day not counted</div>`
          : latestProb
            ? `<div class="site-card-problem">&#9888; ${escHtml(latestProb)}</div>`
            : ''}
        ${latestMats
          ? `<div class="site-card-materials">&#128230; ${escHtml(latestMats.materials)}</div>`
          : ''}
      </div>`;
  });

  dom.siteCardsGrid.innerHTML = cards.join('');

  renderCompletionCountdown(new Map(activeSites));
  buildWeeklyTrendChart(new Map(activeSites));
  renderAllMaterials(bySite);
  renderWeeklySummary(bySite);
  renderAlertsBanner(bySite);
  renderCompletedSites(bySite);
  renderCrewLeaderboard(bySite);
  // Async weather load — populates data-site-weather badges after render
  loadWeatherForAllSites(bySite);

  // Click / keyboard nav on site cards → open site detail modal
  dom.siteCardsGrid.querySelectorAll('.site-card').forEach(card => {
    const go = () => openSiteModal(card.dataset.site);
    card.addEventListener('click', go);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') go(); });
  });
}

// ─── Chart helpers ────────────────────────────────────────────────────────────
const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#171717',
      borderColor: 'rgba(201,168,76,0.3)',
      borderWidth: 1,
      titleColor: '#c9a84c',
      bodyColor: '#f0ead8',
      padding: 10,
      cornerRadius: 6,
    },
  },
  scales: {
    x: {
      ticks: { color: '#5a5040', font: { size: 10 }, maxRotation: 45 },
      grid:  { color: 'rgba(255,255,255,0.04)' },
    },
    y: {
      ticks: { color: '#5a5040', font: { size: 10 } },
      grid:  { color: 'rgba(255,255,255,0.04)' },
    },
  },
};

function goldGrad(ctx, chartArea) {
  const grad = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  grad.addColorStop(0, 'rgba(201,168,76,0.35)');
  grad.addColorStop(1, 'rgba(201,168,76,0.02)');
  return grad;
}

function buildCharts(rows) {
  const labels = rows.map(r => formatDateShort(r.date));
  const bricks = rows.map(r => r.bricks);
  const prog   = rows.map(r => r.progress);
  const crew   = rows.map(r => r.crew);

  if (chartBricks)      chartBricks.destroy();
  if (chartProgress)    chartProgress.destroy();
  if (chartCrew)        chartCrew.destroy();

  chartBricks = new Chart($('chartBricks'), {
    type: 'bar',
    data: { labels, datasets: [{
      label: 'Bricks Laid', data: bricks,
      backgroundColor: ctx => {
        const c = ctx.chart;
        return c.chartArea ? goldGrad(c.ctx, c.chartArea) : 'rgba(201,168,76,0.5)';
      },
      borderColor: '#c9a84c', borderWidth: 1.5,
      borderRadius: 4, borderSkipped: 'bottom',
    }]},
    options: {
      ...JSON.parse(JSON.stringify(CHART_DEFAULTS)),
      plugins: { ...CHART_DEFAULTS.plugins, tooltip: { ...CHART_DEFAULTS.plugins.tooltip,
        callbacks: { label: ctx => ` ${ctx.parsed.y.toLocaleString()} bricks` },
      }},
    },
  });

  chartProgress = new Chart($('chartProgress'), {
    type: 'line',
    data: { labels, datasets: [{
      label: 'Progress %', data: prog,
      borderColor: '#c9a84c', borderWidth: 2.5,
      pointBackgroundColor: '#c9a84c', pointRadius: 4, pointHoverRadius: 6,
      fill: true,
      backgroundColor: ctx => {
        const c = ctx.chart;
        return c.chartArea ? goldGrad(c.ctx, c.chartArea) : 'rgba(201,168,76,0.1)';
      },
      tension: 0.4,
    }]},
    options: {
      ...JSON.parse(JSON.stringify(CHART_DEFAULTS)),
      plugins: { ...CHART_DEFAULTS.plugins, tooltip: { ...CHART_DEFAULTS.plugins.tooltip,
        callbacks: { label: ctx => ` ${ctx.parsed.y}%` },
      }},
      scales: { ...CHART_DEFAULTS.scales,
        y: { ...CHART_DEFAULTS.scales.y, min: 0, max: 100,
          ticks: { ...CHART_DEFAULTS.scales.y.ticks, callback: v => v + '%' } },
      },
    },
  });

  chartCrew = new Chart($('chartCrew'), {
    type: 'line',
    data: { labels, datasets: [{
      label: 'Crew', data: crew,
      borderColor: '#52c48a', borderWidth: 2.5,
      pointBackgroundColor: '#52c48a', pointRadius: 4, pointHoverRadius: 6,
      fill: true, backgroundColor: 'rgba(82,196,138,0.07)', tension: 0.3,
    }]},
    options: {
      ...JSON.parse(JSON.stringify(CHART_DEFAULTS)),
      plugins: { ...CHART_DEFAULTS.plugins, tooltip: { ...CHART_DEFAULTS.plugins.tooltip,
        callbacks: { label: ctx => ` ${ctx.parsed.y} workers` },
      }},
      scales: { ...CHART_DEFAULTS.scales,
        y: { ...CHART_DEFAULTS.scales.y, min: 0,
          ticks: { ...CHART_DEFAULTS.scales.y.ticks, stepSize: 1 } },
      },
    },
  });
}

// ─── Single site view ─────────────────────────────────────────────────────────
function renderSite(rows, siteName) {
  if (!rows || !rows.length) {
    showToast('No data for this site.', 'error');
    return;
  }

  const latest = rows[rows.length - 1];
  const prev   = rows.length > 1 ? rows[rows.length - 2] : null;

  dom.jobLabel.textContent = siteName || latest.jobSite || '—';

  // Boss note
  const latestBossNote = [...rows].reverse().find(r => r.bossNote && r.bossNote.trim());
  if (latestBossNote) {
    dom.bossNoteText.textContent = latestBossNote.bossNote;
    dom.bossNote.hidden = false;
  } else {
    dom.bossNote.hidden = true;
  }

  // KPIs
  dom.kpiBricks.textContent   = latest.bricks ? latest.bricks.toLocaleString() : '0';
  dom.kpiCrew.textContent     = latest.crew || '0';
  dom.kpiProgress.textContent = latest.progress + '%';
  dom.kpiDays.textContent     = latest.daysLeft || '—';
  dom.kpiTotal.textContent    = latest.calcRunningTotal ? latest.calcRunningTotal.toLocaleString() : '—';
  dom.progressBar.style.width = Math.min(100, Math.max(0, latest.progress)) + '%';

  // Brick trend vs previous day
  if (prev && prev.bricks > 0) {
    const diff = latest.bricks - prev.bricks;
    const pct  = Math.round((diff / prev.bricks) * 100);
    dom.kpiBricksTrend.textContent = (diff >= 0 ? '▲' : '▼') + ' ' + Math.abs(pct) + '%';
    dom.kpiBricksTrend.className   = 'kpi-trend ' + (diff >= 0 ? 'up' : 'down');
  } else {
    dom.kpiBricksTrend.textContent = '';
    dom.kpiBricksTrend.className   = 'kpi-trend';
  }

  // Averages section
  renderSiteAverages(rows);

  // What got done today
  const latestDone = [...rows].reverse().find(r => r.doneToday && r.doneToday.trim());
  if (latestDone) {
    dom.doneTodayText.textContent = latestDone.doneToday;
    dom.doneTodayText.className   = 'done-today';
  } else {
    dom.doneTodayText.textContent = 'No update recorded yet.';
    dom.doneTodayText.className   = 'done-today done-today--empty';
  }

  // Problems
  const allProblems = rows
    .filter(r => r.problems && r.problems.trim())
    .map(r => ({ date: r.date, text: r.problems }));

  dom.kpiProblems.textContent = allProblems.length || '0';
  if (allProblems.length > 0) {
    dom.problemsCard.classList.add('has-problems');
    dom.problemList.innerHTML = allProblems.slice(-5).reverse().map(p =>
      `<li class="problem-item">
         <span class="problem-date">${formatDateShort(p.date)}</span>${escHtml(p.text)}
       </li>`
    ).join('');
  } else {
    dom.problemsCard.classList.remove('has-problems');
    dom.problemList.innerHTML = '<li class="problem-item problem-item--empty">No problems flagged</li>';
  }

  // Materials
  const latestMats = [...rows].reverse().find(r => r.materials && r.materials.trim());
  if (latestMats) {
    const items = latestMats.materials.split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
    dom.materialsList.innerHTML = items.map(item =>
      `<li class="materials-item"><span>${escHtml(item)}</span></li>`
    ).join('');
  } else {
    dom.materialsList.innerHTML = '<li class="materials-item materials-item--empty">No materials flagged for tomorrow</li>';
  }

  // Table
  dom.tableBody.innerHTML = [...rows].reverse().map((r, i) => {
    const isLatest   = i === 0;
    const hasProb    = r.problems && r.problems.trim();
    const isWeather  = r.weatherDelay === 'Yes';
    const prog       = Math.min(100, r.progress || 0);
    return `<tr class="${isLatest ? 'row-latest' : ''} ${hasProb ? 'row-problem' : ''}">
      <td>${formatDateShort(r.date)}${isWeather ? ' <span style="color:#60a5fa;font-size:0.75rem">&#127783;</span>' : ''}</td>
      <td>${r.bricks ? r.bricks.toLocaleString() : '—'}</td>
      <td>${r.calcRunningTotal ? r.calcRunningTotal.toLocaleString() : '—'}</td>
      <td>${r.crewName || r.crew || '—'}</td>
      <td>
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <div style="background:var(--surface-3);border-radius:3px;height:5px;width:50px;overflow:hidden;flex-shrink:0">
            <div style="background:var(--gold);height:100%;width:${prog}%;border-radius:3px;"></div>
          </div>
          ${r.progress || 0}%
        </div>
      </td>
      <td>${r.daysLeft || '—'}</td>
      <td style="${hasProb ? 'color:var(--red)' : 'color:var(--text-dim)'}">${escHtml(r.problems) || '—'}</td>
      <td style="color:var(--text-muted)">${escHtml(r.materials) || '—'}</td>
    </tr>`;
  }).join('');

  // Charts
  buildCharts(rows);
}

// ─── Site detail modal ───────────────────────────────────────────────────────

// Single persistent overlay-click handler — wired once at page load (bottom of file)
function _initModalOverlayClick() {
  const modal = document.getElementById('siteModal');
  if (!modal) return;
  modal.addEventListener('click', e => {
    // Close only when the click lands directly on the overlay backdrop, not on modal content
    if (e.target === modal) {
      console.log('[Dynasty] Modal overlay background clicked — closing');
      closeSiteModal();
    }
  });
}

function openSiteModal(siteName) {
  const rows = currentBySite && currentBySite.get(siteName);
  if (!rows || !rows.length) {
    console.warn('[Dynasty] openSiteModal: no rows for', siteName);
    return;
  }

  const modal       = document.getElementById('siteModal');
  const nameEl      = document.getElementById('modalSiteName');
  const badgeEl     = document.getElementById('modalSiteBadge');
  const bodyEl      = document.getElementById('siteModalBody');
  const completeBtn = document.getElementById('modalCompleteBtn');
  const closeBtn    = document.getElementById('siteModalClose');

  // ── Populate header ──────────────────────────────────────────────────────
  nameEl.textContent = siteName;

  const latest0    = rows[rows.length - 1];
  const isWeather0 = latest0.weatherDelay === 'Yes';
  const status     = getSiteStatus(siteName, rows);

  if (isWeather0) {
    badgeEl.className = 'site-card-badge site-card-badge--weather';
    badgeEl.innerHTML = '&#127783; Weather Day';
  } else {
    badgeEl.className = 'site-card-badge site-card-badge--' +
      (status === 'problem' ? 'problem' : status === 'behind' ? 'behind' : 'ok');
    badgeEl.innerHTML = status === 'problem' ? '&#9888; Problem'
      : status === 'behind'  ? '&#9650; Behind'
      : '&#10003; On Track';
  }

  const isCompleted = loadCompletedSites().some(s => s.name === siteName);
  completeBtn.style.display = isCompleted ? 'none' : '';

  // ── Populate body ────────────────────────────────────────────────────────
  const latest      = rows[rows.length - 1];
  const isWeather   = latest.weatherDelay === 'Yes';
  const prog        = Math.min(100, Math.max(0, latest.progress || 0));
  const totalBricks = latest.calcRunningTotal || rows.reduce((s, r) => s + (r.bricks || 0), 0);
  const weatherDays = rows.filter(r => r.weatherDelay === 'Yes').length;
  const daysLeftAdj = (latest.daysLeft || 0) + (isWeather ? 1 : 0);
  const allProblems = rows.filter(r => r.problems && r.problems.trim());

  // ── Photo gallery — all rows with a photoUrl, newest first ─────────────────
  const photoRows = [...rows].reverse().filter(r => r.photoUrl && r.photoUrl.trim());
  let photoHtml = '';
  if (photoRows.length) {
    const thumbs = photoRows.map(r => {
      const raw = r.photoUrl.trim();
      const m   = raw.match(/\/file\/d\/([^/]+)/);
      const src = m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w400` : raw;
      const dateLabel = r.date ? formatDateShort(r.date) : '';
      return `
        <div class="photo-gallery-item">
          <a href="${escHtml(raw)}" target="_blank" rel="noopener" class="photo-gallery-link">
            <img src="${escHtml(src)}" alt="Progress photo ${escHtml(dateLabel)}"
                 class="photo-gallery-thumb" loading="lazy"
                 onerror="this.closest('.photo-gallery-item').innerHTML='<span class=photo-gallery-err>Unavailable</span>'" />
          </a>
          <div class="photo-gallery-date">${escHtml(dateLabel)}</div>
        </div>`;
    }).join('');
    photoHtml = `
      <h3 class="modal-section-title">&#128247; Progress Photos <span class="modal-section-count">${photoRows.length}</span></h3>
      <div class="photo-gallery-scroll">${thumbs}</div>`;
  } else {
    photoHtml = `
      <h3 class="modal-section-title">&#128247; Progress Photos</h3>
      <p class="photo-gallery-empty">No photos submitted yet.</p>`;
  }

  // ── Weather forecast placeholder — populated async after render ──────────────
  const weatherForecastHtml = `
    <h3 class="modal-section-title" id="weatherForecastTitle_${escHtml(siteName)}">&#9925; 7-Day Forecast</h3>
    <div class="weather-forecast-strip" id="weatherForecast_${escHtml(siteName)}">
      <span class="weather-loading">Loading forecast…</span>
    </div>
    <div id="weatherRainNote_${escHtml(siteName)}"></div>`;

  bodyEl.innerHTML = `
    <div class="modal-kpi-row">
      <div class="modal-kpi modal-kpi--progress">
        <div class="progress-bar-wrap" style="margin-bottom:0.35rem">
          <div class="progress-bar" style="width:${prog}%"></div>
        </div>
        <span class="modal-kpi-label">${prog}% complete</span>
      </div>
      <div class="modal-kpi">
        <div class="modal-kpi-value">${latest.bricks ? latest.bricks.toLocaleString() : '—'}</div>
        <div class="modal-kpi-label">Bricks today</div>
      </div>
      <div class="modal-kpi">
        <div class="modal-kpi-value">${latest.crew || '—'}</div>
        <div class="modal-kpi-label">Crew</div>
      </div>
      <div class="modal-kpi">
        <div class="modal-kpi-value${isWeather ? ' modal-kpi-value--weather' : ''}">${daysLeftAdj || '—'}</div>
        <div class="modal-kpi-label">Days left${isWeather ? ' (+1 weather)' : ''}</div>
      </div>
      <div class="modal-kpi">
        <div class="modal-kpi-value">${totalBricks.toLocaleString()}</div>
        <div class="modal-kpi-label">Total bricks</div>
      </div>
      ${weatherDays > 0 ? `
      <div class="modal-kpi modal-kpi--weather">
        <div class="modal-kpi-value modal-kpi-value--weather">&#127783; ${weatherDays}</div>
        <div class="modal-kpi-label">Weather day${weatherDays !== 1 ? 's' : ''}</div>
      </div>` : ''}
    </div>

    ${weatherForecastHtml}

    ${photoHtml}

    <h3 class="modal-section-title">
      Daily Log
      <span class="modal-section-count">${rows.length} entr${rows.length !== 1 ? 'ies' : 'y'}</span>
    </h3>
    <div class="modal-table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Date</th><th>Bricks</th><th>Running Total</th><th>Crew</th>
            <th>What got done</th><th>Problems</th><th>Materials tomorrow</th>
          </tr>
        </thead>
        <tbody>
          ${[...rows].reverse().map((r, i) => {
            const hasProb     = r.problems && r.problems.trim();
            const rowWeather  = r.weatherDelay === 'Yes';
            return `<tr class="${i === 0 ? 'row-latest' : ''} ${hasProb ? 'row-problem' : ''}">
              <td>${formatDateShort(r.date)}${rowWeather ? ' <span style="color:#60a5fa;font-size:0.75rem" title="Weather delay">&#127783;</span>' : ''}</td>
              <td>${r.bricks ? r.bricks.toLocaleString() : '—'}</td>
              <td>${r.calcRunningTotal ? r.calcRunningTotal.toLocaleString() : '—'}</td>
              <td>${escHtml(r.crewName || String(r.crew) || '—')}</td>
              <td class="modal-td-wrap">${escHtml(r.doneToday || '—')}</td>
              <td class="modal-td-wrap">${hasProb
                ? `<span style="color:var(--red)">${escHtml(r.problems)}</span>`
                : '<span style="color:var(--text-dim)">—</span>'}</td>
              <td class="modal-td-wrap" style="color:var(--text-muted)">${escHtml(r.materials || '—')}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>

    ${allProblems.length ? `
    <h3 class="modal-section-title">
      Problems History
      <span class="modal-section-count">${allProblems.length} total</span>
    </h3>
    <div class="modal-problems-list">
      ${[...allProblems].reverse().map(r => `
        <div class="modal-problem-item">
          <span class="modal-problem-date">${formatDateShort(r.date)}</span>
          <span class="modal-problem-text">${escHtml(r.problems)}</span>
        </div>`).join('')}
    </div>` : ''}
  `;

  // ── Show modal ───────────────────────────────────────────────────────────
  bodyEl.scrollTop = 0;
  modal.classList.add('is-open');
  document.body.classList.add('modal-open');

  // ── Async weather forecast population ───────────────────────────────────
  fetchSiteWeather(siteName).then(weather => {
    const forecastEl = document.getElementById(`weatherForecast_${siteName}`);
    const rainNoteEl = document.getElementById(`weatherRainNote_${siteName}`);
    if (!forecastEl) return;
    if (!weather) {
      forecastEl.innerHTML = '<span class="weather-loading">Forecast unavailable</span>';
      return;
    }
    forecastEl.innerHTML = weather.days.map(d => {
      const dayName = new Date(d.date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short' });
      const rainCls = d.rainProb > 60 ? 'weather-day--rainy' : d.rainProb > 30 ? 'weather-day--cloudy' : '';
      return `
        <div class="weather-day ${rainCls}">
          <div class="weather-day-name">${escHtml(dayName)}</div>
          <div class="weather-day-icon">${weatherCodeIcon(d.code)}</div>
          <div class="weather-day-temp">${Math.round(d.maxTemp)}°</div>
          <div class="weather-day-rain">${Math.round(d.rainProb)}%</div>
        </div>`;
    }).join('');

    if (rainNoteEl && weather.rain3day) {
      // Count days >60% in next 3
      const rainDays = weather.days.slice(0, 3).filter(d => d.rainProb > 60).length;
      rainNoteEl.innerHTML = `
        <div class="weather-rain-note">
          &#9888; <strong>Rain Risk</strong> — ${rainDays} high-rain day${rainDays !== 1 ? 's' : ''} forecast in next 3 days.
          Estimated finish extended by ${rainDays} day${rainDays !== 1 ? 's' : ''} due to forecast rain.
        </div>`;
      // Also update the header badge to show rain risk
      if (badgeEl && !isWeather0) {
        badgeEl.className = 'site-card-badge site-card-badge--weather';
        badgeEl.innerHTML = '&#9925; Rain Risk';
      }
    }
  });

  // ── Wire buttons (assigned fresh each open so siteName closure is current) ─
  closeBtn.onclick = () => {
    console.log('[Dynasty] Modal close button clicked');
    closeSiteModal();
  };
  completeBtn.onclick = () => {
    console.log('[Dynasty] Mark as Complete clicked for', siteName);
    confirmMarkComplete(siteName);
  };
}

function closeSiteModal() {
  const modal = document.getElementById('siteModal');
  if (modal) modal.classList.remove('is-open');
  document.body.classList.remove('modal-open');
}

// Confirm + execute mark-as-complete
function confirmMarkComplete(siteName) {
  if (!confirm(`Mark "${siteName}" as complete?\n\nThis will move it to the Completed Sites panel. You can reactivate it at any time.`)) return;
  const list = loadCompletedSites();
  if (!list.some(s => s.name === siteName)) {
    list.push({ name: siteName, completedAt: new Date().toISOString() });
    saveCompletedSites(list);
  }
  closeSiteModal();
  renderAllJobs(currentBySite);
}

// ─── Completed sites panel ────────────────────────────────────────────────────
function renderCompletedSites(bySite) {
  const el = document.getElementById('completedSitesPanel');
  if (!el) return;

  const completed    = loadCompletedSites();
  const validEntries = completed.filter(s => bySite.has(s.name));
  if (!validEntries.length) { el.innerHTML = ''; return; }

  const cards = validEntries.map(({ name, completedAt }) => {
    const rows        = bySite.get(name);
    const totalBricks = rows.reduce((s, r) => s + (r.bricks || 0), 0);
    const totalDays   = rows.length;
    const completedDate = new Date(completedAt).toLocaleDateString('en-AU', {
      day: 'numeric', month: 'short', year: 'numeric',
    });

    return `
      <div class="site-card site-card--completed" data-site="${escHtml(name)}"
           role="button" tabindex="0" aria-label="View ${escHtml(name)} history">
        <div class="site-card-header">
          <span class="site-card-name">${escHtml(name)}</span>
          <span class="site-card-badge site-card-badge--complete">&#10003; Complete</span>
        </div>
        <div class="site-card-completed-meta">
          <span>Completed ${escHtml(completedDate)}</span>
          <span class="completed-sep">&#183;</span>
          <span>${totalBricks.toLocaleString()} bricks total</span>
          <span class="completed-sep">&#183;</span>
          <span>${totalDays} day${totalDays !== 1 ? 's' : ''} on site</span>
        </div>
        <button class="btn-reactivate" data-site="${escHtml(name)}">&#8635; Reactivate</button>
      </div>`;
  });

  el.innerHTML = `
    <div class="completed-sites-panel">
      <button class="completed-sites-toggle" id="completedToggle" aria-expanded="false">
        <span class="completed-sites-icon">&#10003;</span>
        <span class="completed-sites-title">Completed Sites (${validEntries.length})</span>
        <span class="completed-sites-chevron" id="completedChevron">&#9660;</span>
      </button>
      <div class="completed-sites-list" id="completedSitesList" hidden>
        <div class="site-cards-grid completed-cards-grid">${cards.join('')}</div>
      </div>
    </div>`;

  // Toggle expand/collapse
  const toggleBtn = document.getElementById('completedToggle');
  const listEl    = document.getElementById('completedSitesList');
  const chevron   = document.getElementById('completedChevron');
  if (toggleBtn && listEl) {
    toggleBtn.addEventListener('click', () => {
      const opening = listEl.hidden;
      listEl.hidden = !opening;
      chevron.innerHTML = opening ? '&#9650;' : '&#9660;';
      toggleBtn.setAttribute('aria-expanded', String(opening));
    });
  }

  // Click card → open modal for history view
  el.querySelectorAll('.site-card--completed').forEach(card => {
    card.addEventListener('click', e => {
      if (!e.target.closest('.btn-reactivate')) openSiteModal(card.dataset.site);
    });
    card.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('.btn-reactivate')) {
        openSiteModal(card.dataset.site);
      }
    });
  });

  // Reactivate button
  el.querySelectorAll('.btn-reactivate').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      saveCompletedSites(loadCompletedSites().filter(s => s.name !== btn.dataset.site));
      renderAllJobs(currentBySite);
    });
  });
}

// ─── Crew Leaderboard ────────────────────────────────────────────────────────
function renderCrewLeaderboard(bySite) {
  const el = document.getElementById('crewLeaderboardPanel');
  if (!el) return;

  // Capitalise each word in a name
  function titleCase(s) {
    return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }

  // canonical (lowercase) key → { displayName, totalBricks }
  const crewMap = new Map();

  for (const [, rows] of bySite) {
    for (const row of rows) {
      const rawName = (row.crewName || '').trim();
      if (!rawName) continue;
      // Skip purely numeric entries (crew count, not names)
      if (/^\d+(\.\d+)?$/.test(rawName)) continue;

      // Split on commas only — checkbox values formatted as "Tommy, Henry, Alex"
      const parts = rawName
        .split(',')
        .map(n => n.trim())
        .filter(n => n.length > 1 && !/^\d+$/.test(n));

      if (!parts.length) continue;

      // Divide daily bricks equally among all crew on site that day
      const share = (row.bricks || 0) / parts.length;

      for (const part of parts) {
        const key = part.toLowerCase();
        if (!crewMap.has(key)) {
          crewMap.set(key, { displayName: titleCase(part), totalBricks: 0 });
        }
        crewMap.get(key).totalBricks += share;
      }
    }
  }

  if (crewMap.size === 0) {
    el.innerHTML = '';
    return;
  }

  const sorted = [...crewMap.values()]
    .sort((a, b) => b.totalBricks - a.totalBricks)
    .slice(0, 10);

  const maxBricks = sorted[0].totalBricks || 1;
  const medals = ['&#127947;', '&#129352;', '&#129353;'];

  const rowsHtml = sorted.map(({ displayName, totalBricks }, i) => {
    const rankEl = i < 3 ? medals[i] : `<span style="font-size:0.8rem;color:var(--text-dim)">${i + 1}</span>`;
    const pct    = Math.round((totalBricks / maxBricks) * 100);
    return `
      <div class="crew-lb-row">
        <span class="crew-lb-rank">${rankEl}</span>
        <span class="crew-lb-name">${escHtml(displayName)}</span>
        <div class="crew-lb-bar-wrap"><div class="crew-lb-bar" style="width:${pct}%"></div></div>
        <span class="crew-lb-bricks">${Math.round(totalBricks).toLocaleString()}</span>
        <span class="crew-lb-label">bricks</span>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="crew-leaderboard">
      <div class="crew-leaderboard-header">
        <span style="font-size:1.1rem">&#127947;</span>
        <span class="crew-leaderboard-title">Crew Leaderboard — Total Bricks</span>
      </div>
      <div class="crew-leaderboard-list">${rowsHtml}</div>
    </div>`;
}

// ─── Load & orchestrate ───────────────────────────────────────────────────────
async function loadSheet() {
  showLoading();
  dom.btnRefresh.classList.add('spinning');

  let rows       = [];
  let fetchError = null;

  try {
    const csv = await fetchCSV();
    console.log(`[Dynasty] CSV received — ${csv.length} chars. First 300:`, csv.slice(0, 300));
    rows = parseCSV(csv);
    console.log(`[Dynasty] Parsed ${rows.length} data row(s).`);
    if (rows.length) {
      console.log('[Dynasty] Sample row[0]:', rows[0]);
    }
  } catch (err) {
    fetchError = err;
    console.error('[Dynasty] Fetch/parse failed:', err);
  }

  // Always group and build tabs — even with 0 rows so the tab bar is visible
  currentBySite = groupBySite(rows);
  console.log('[Dynasty] Sites found:', [...currentBySite.keys()]);
  buildTabs(currentBySite);

  // If the previously active site tab no longer exists, fall back to All Jobs
  const sm8Tabs = new Set(['__jobs__', '__pipeline__', '__finance__', '__risk__', '__subbies__', '__safety__']);
  if (activeTab !== '__all__' && !sm8Tabs.has(activeTab) && !currentBySite.has(activeTab)) {
    activeTab = '__all__';
  }
  jobsLoaded = false; // force re-fetch next time any SM8 tab is visited
  switchTab(activeTab);

  dom.lastUpdated.textContent = 'Last updated: ' + new Date().toLocaleTimeString();

  // Show the most useful error message available
  if (fetchError) {
    showToast('Could not load data: ' + fetchError.message, 'error', 8000);
  } else if (rows.length === 0) {
    showToast('Sheet loaded but no data rows found — check the sheet format.', 'error', 8000);
  } else if (currentBySite.size === 0) {
    showToast('Data loaded but no job sites found — check the Job Site column.', 'error', 8000);
  }

  hideLoading();
  dom.btnRefresh.classList.remove('spinning');
}

// ─── Events & auto-refresh ────────────────────────────────────────────────────
dom.btnRefresh.addEventListener('click', loadSheet);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const settingsOv = document.getElementById('settingsOverlay');
    if (settingsOv && settingsOv.classList.contains('is-open')) { settingsOv.classList.remove('is-open'); return; }
    const aiSummOv = document.getElementById('weeklySummaryOverlay');
    if (aiSummOv && aiSummOv.classList.contains('is-open')) { aiSummOv.classList.remove('is-open'); return; }
    const calcOv = document.getElementById('calcOverlay');
    if (calcOv && calcOv.classList.contains('is-open')) { calcOv.classList.remove('is-open'); return; }
    const chatPanel = document.getElementById('aiChatPanel');
    if (chatPanel && chatPanel.style.display !== 'none') { chatPanel.style.display = 'none'; return; }
    const modal = document.getElementById('siteModal');
    if (modal && modal.classList.contains('is-open')) { closeSiteModal(); return; }
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
    e.preventDefault();
    loadSheet();
  }
});

setInterval(loadSheet, 5 * 60 * 1000);

// ─── Business toggle init ─────────────────────────────────────────────────────
(function initBizToggle() {
  const container = document.getElementById('bizToggle');
  if (!container) return;

  // Reflect persisted state
  container.querySelectorAll('.biz-toggle-btn').forEach(btn => {
    btn.classList.toggle('biz-toggle-btn--active', btn.dataset.biz === activeBiz);
  });

  container.addEventListener('click', e => {
    const btn = e.target.closest('.biz-toggle-btn');
    if (!btn) return;
    activeBiz = btn.dataset.biz;
    localStorage.setItem(BIZ_KEY, activeBiz);
    container.querySelectorAll('.biz-toggle-btn').forEach(b => {
      b.classList.toggle('biz-toggle-btn--active', b.dataset.biz === activeBiz);
    });
    // Re-render whichever SM8 tab is active
    if (jobsLoaded) renderSM8Tab(activeTab);
  });
})();

// ─── Settings modal (Change PIN) ─────────────────────────────────────────────
(function initSettings() {
  const btnSettings = document.getElementById('btnSettings');
  const overlay     = document.getElementById('settingsOverlay');
  const closeBtn    = document.getElementById('settingsClose');
  const saveBtn     = document.getElementById('settingsSave');
  const msgEl       = document.getElementById('settingsMsg');
  const currentInp  = document.getElementById('settingsCurrent');
  const newInp      = document.getElementById('settingsNew');
  const confirmInp  = document.getElementById('settingsConfirm');

  if (!btnSettings || !overlay) return;

  function openSettings() {
    currentInp.value = '';
    newInp.value     = '';
    confirmInp.value = '';
    msgEl.textContent = '';
    msgEl.className   = 'settings-msg';
    // Show clients section only for full-owner mode
    const clientsSection = document.getElementById('settingsClientsSection');
    if (clientsSection) clientsSection.hidden = !isFullMode();
    overlay.classList.add('is-open');
    setTimeout(() => currentInp.focus(), 50);
  }

  function closeSettings() {
    overlay.classList.remove('is-open');
  }

  function savePin() {
    const cur  = currentInp.value;
    const nw   = newInp.value;
    const conf = confirmInp.value;

    if (cur !== currentFullPin) {
      msgEl.textContent = 'Current PIN is incorrect.';
      msgEl.className   = 'settings-msg settings-msg--err';
      currentInp.value  = '';
      currentInp.focus();
      return;
    }
    if (nw.length < 4) {
      msgEl.textContent = 'New PIN must be 4 digits.';
      msgEl.className   = 'settings-msg settings-msg--err';
      newInp.focus();
      return;
    }
    if (nw !== conf) {
      msgEl.textContent = 'New PIN and confirmation do not match.';
      msgEl.className   = 'settings-msg settings-msg--err';
      confirmInp.value  = '';
      confirmInp.focus();
      return;
    }

    currentFullPin = nw;
    localStorage.setItem(PIN_KEY, nw);
    msgEl.textContent = 'PIN updated successfully!';
    msgEl.className   = 'settings-msg settings-msg--ok';
    newInp.value = confirmInp.value = currentInp.value = '';
    setTimeout(closeSettings, 1500);
  }

  // Share builder link
  const shareBtn = document.getElementById('btnShareBuilder');
  if (shareBtn) {
    shareBtn.addEventListener('click', () => {
      const msg = `Track your job progress live: ${location.href.split('?')[0]} — Builder PIN: ${BUILDER_PIN}`;
      navigator.clipboard.writeText(msg).then(
        () => showToast('Share link copied to clipboard!', 'success'),
        () => showToast('Could not copy — please copy manually.', 'error')
      );
    });
  }

  btnSettings.addEventListener('click', openSettings);
  closeBtn.addEventListener('click', closeSettings);
  saveBtn.addEventListener('click', savePin);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeSettings(); });
  [currentInp, newInp, confirmInp].forEach(inp =>
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') savePin(); })
  );

  const logoutBtn = document.getElementById('btnLogout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      sessionStorage.clear();
      closeSettings();
      const dashboard = document.getElementById('dashboardRoot');
      const loginScreen = document.getElementById('loginScreen');
      if (dashboard)   dashboard.hidden = true;
      if (loginScreen) loginScreen.style.display = '';
      // Reset pin input
      const pinInput = document.getElementById('pinInput');
      if (pinInput) { pinInput.value = ''; setTimeout(() => pinInput.focus(), 50); }
    });
  }
})();

// ─── Business Profile ─────────────────────────────────────────────────────────
const BP_KEY = 'dynasty-business-profile';

function loadBusinessProfile() {
  try { return JSON.parse(localStorage.getItem(BP_KEY) || '{}'); } catch { return {}; }
}
function saveBusinessProfile(obj) { localStorage.setItem(BP_KEY, JSON.stringify(obj)); }

(function initBusinessProfile() {
  const saveBtn    = document.getElementById('btnSaveProfile');
  const uploadBtn  = document.getElementById('btnUploadLogo');
  const logoFile   = document.getElementById('bp_logo_file');
  const logoStatus = document.getElementById('bp_logo_status');
  const logoCanvas = document.getElementById('bp_logo_preview');
  const profileMsg = document.getElementById('profileMsg');
  if (!saveBtn) return;

  // Populate fields from saved profile when settings opens
  const settingsBtn = document.getElementById('btnSettings');
  settingsBtn?.addEventListener('click', () => {
    const p = loadBusinessProfile();
    ['name','abn','phone','email','address','terms'].forEach(k => {
      const el = document.getElementById('bp_' + k);
      if (el) el.value = p[k] || '';
    });
    const ttEl = document.getElementById('bp_tradeType');
    if (ttEl) ttEl.value = p.tradeType || 'bricklayer';
    if (p.logo && logoCanvas) {
      showLogoPreview(p.logo);
    }
  }, { capture: true }); // runs before the overlay opens

  // Logo upload
  uploadBtn?.addEventListener('click', () => logoFile?.click());
  logoFile?.addEventListener('change', () => {
    const file = logoFile.files[0];
    if (!file) return;
    if (file.size > 500 * 1024) {
      if (logoStatus) logoStatus.textContent = 'Image too large — max 500 KB';
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      showLogoPreview(e.target.result);
      if (logoStatus) logoStatus.textContent = file.name;
    };
    reader.readAsDataURL(file);
  });

  function showLogoPreview(dataUrl) {
    if (!logoCanvas) return;
    const img = new Image();
    img.onload = () => {
      const maxW = 240, maxH = 96;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      logoCanvas.width  = Math.round(img.width  * scale);
      logoCanvas.height = Math.round(img.height * scale);
      logoCanvas.getContext('2d').drawImage(img, 0, 0, logoCanvas.width, logoCanvas.height);
      logoCanvas.style.display = '';
    };
    img.src = dataUrl;
    logoCanvas._dataUrl = dataUrl; // store for saving
  }

  saveBtn.addEventListener('click', () => {
    const p = {
      name:      document.getElementById('bp_name')?.value.trim()      || '',
      abn:       document.getElementById('bp_abn')?.value.trim()       || '',
      phone:     document.getElementById('bp_phone')?.value.trim()     || '',
      email:     document.getElementById('bp_email')?.value.trim()     || '',
      address:   document.getElementById('bp_address')?.value.trim()   || '',
      terms:     document.getElementById('bp_terms')?.value.trim()     || '',
      tradeType: document.getElementById('bp_tradeType')?.value        || 'bricklayer',
      logo:      logoCanvas?._dataUrl || loadBusinessProfile().logo    || '',
    };
    saveBusinessProfile(p);
    applyTradeLabels();
    if (profileMsg) {
      profileMsg.textContent = 'Profile saved!';
      profileMsg.className   = 'settings-msg settings-msg--ok';
      setTimeout(() => { profileMsg.textContent = ''; }, 2500);
    }
  });
})();

// ─── Export CSV button ────────────────────────────────────────────────────────
(function initExportCSV() {
  const btn = document.getElementById('btnExportCSV');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (!jobsLoaded) { showToast('Jobs not loaded yet — please wait.', 'error'); return; }
    exportCSV();
  });
})();

// ─── Show Profit toggle ───────────────────────────────────────────────────────
(function initShowProfit() {
  const btn = document.getElementById('btnShowProfit');
  if (!btn) return;
  btn.addEventListener('click', () => {
    showProfit = !showProfit;
    btn.classList.toggle('jobs-action-btn--active', showProfit);
    btn.textContent = showProfit ? '✕ Hide Profit' : '$ Show Profit';
    if (jobsLoaded) applyJobsFilters();
  });
})();

// ─── Invoice Chase — event delegation on jobs table ──────────────────────────
(function initChaseDelegate() {
  const tbody = document.getElementById('jobsTableBody');
  if (!tbody) return;
  tbody.addEventListener('click', e => {
    const btn = e.target.closest('[data-chase-uuid]');
    if (!btn) return;
    const job = activeJobsData.find(j => j.uuid === btn.dataset.chaseUuid);
    if (job) openChaseModal(job);
  });
})();

// ═══════════════════════════════════════════════════════════════════════════════
// FEATURE 2 — LIVE WEATHER PER SITE
// ═══════════════════════════════════════════════════════════════════════════════

// Goulburn NSW fallback coordinates (central to most Dynasty sites)
const GOULBURN_COORDS = { lat: -34.7540, lon: 149.7183 };

async function geocodeSite(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address + ', NSW, Australia')}&limit=1`;
  try {
    const res  = await fetch(url, { headers: { 'User-Agent': 'DynastyDashboard/1.0' } });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    const data = await res.json();
    if (data && data[0]) {
      console.log(`[Dynasty] Geocoded "${address}" → lat=${data[0].lat} lon=${data[0].lon}`);
      return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    }
    console.warn(`[Dynasty] Nominatim: no results for "${address}" — using Goulburn fallback`);
  } catch (err) {
    console.warn(`[Dynasty] Nominatim error for "${address}": ${err.message} — using Goulburn fallback`);
  }
  return GOULBURN_COORDS;
}

async function fetchSiteWeather(siteName) {
  const cached = siteWeatherCache.get(siteName);
  if (cached && (Date.now() - cached.fetched) < WEATHER_TTL) return cached;

  const coords = await geocodeSite(siteName);
  if (!coords) return null;

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}` +
      `&daily=weathercode,temperature_2m_max,precipitation_probability_max&timezone=Australia/Sydney&forecast_days=7`;
    const res  = await fetch(url);
    const json = await res.json();
    const daily = json.daily;
    if (!daily) return null;

    const days = daily.time.map((t, i) => ({
      date:      t,
      code:      daily.weathercode[i],
      maxTemp:   daily.temperature_2m_max[i],
      rainProb:  daily.precipitation_probability_max[i] || 0,
    }));

    // Rain risk: any of next 3 days >60% rain probability
    const rain3day = days.slice(0, 3).some(d => d.rainProb > 60);

    const result = { fetched: Date.now(), days, rain3day, lat: coords.lat, lon: coords.lon };
    siteWeatherCache.set(siteName, result);
    return result;
  } catch { return null; }
}

function weatherCodeIcon(code) {
  if (code <= 1)  return '☀';
  if (code <= 3)  return '⛅';
  if (code <= 49) return '🌫';
  if (code <= 67) return '🌧';
  if (code <= 79) return '❄';
  if (code <= 82) return '🌦';
  if (code <= 99) return '⛈';
  return '🌡';
}

// Fetch weather for all sites and inject badges on site cards
async function loadWeatherForAllSites(bySite) {
  for (const [siteName] of bySite) {
    fetchSiteWeather(siteName).then(weather => {
      if (!weather) return;
      // Update weather badge text
      document.querySelectorAll('[data-site-weather]').forEach(el => {
        if (el.dataset.siteWeather !== siteName) return;
        const today = weather.days[0];
        el.textContent = `${weatherCodeIcon(today.code)} ${Math.round(today.maxTemp)}°C`;
        el.title = weather.rain3day ? '⚠ Rain risk in next 3 days' : '';
        el.classList.toggle('site-weather--rain-risk', weather.rain3day);
      });
      // Add ⚠ Rain Risk badge to the site card header if rain risk detected
      if (weather.rain3day) {
        document.querySelectorAll(`.site-card[data-site="${CSS.escape(siteName)}"]`).forEach(card => {
          // Only add if no existing rain-risk badge
          if (!card.querySelector('.site-card-badge--rain')) {
            const rainDays = weather.days.slice(0, 3).filter(d => d.rainProb > 60).length;
            const badge = document.createElement('span');
            badge.className = 'site-card-badge site-card-badge--rain';
            badge.innerHTML = `&#9925; Rain Risk`;
            badge.title = `${rainDays} day${rainDays !== 1 ? 's' : ''} >60% rain in next 3 days`;
            card.querySelector('.site-card-header')?.appendChild(badge);
          }
        });
      }
    });
  }
}


// ═══════════════════════════════════════════════════════════════════════════════


// ─── Utility: get crew names from sheet data ─────────────────────────────────
function getCrewNames() {
  if (!currentBySite) return [];
  const names = new Set();
  for (const [, rows] of currentBySite) {
    for (const row of rows) {
      const raw = (row.crewName || '').trim();
      if (!raw || /^\d+(\.\d+)?$/.test(raw)) continue;
      raw.split(',')
        .map(n => n.trim())
        .filter(n => n.length > 1 && !/^\d+$/.test(n))
        .forEach(n => names.add(n.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())));
    }
  }
  return [...names].sort();
}

// ─── Start ────────────────────────────────────────────────────────────────────
_initModalOverlayClick();
loadSheet();

// ─── Trade label helpers (label-only, no data/rendering side effects) ────────
const TRADE_DISPLAY_NAMES = {
  bricklayer:       'Bricklaying',
  block_layer:      'Block Laying',
  plasterer:        'Plastering',
  painter:          'Painting',
  plumber:          'Plumbing',
  electrician:      'Electrical',
  carpenter:        'Carpentry',
  tiler:            'Tiling',
  landscaper:       'Landscaping',
  pressure_cleaner: 'Pressure Cleaning',
  builder:          'Building',
  other:            'Trade Work',
};

function applyTradeLabels() {
  try {
    const bp        = JSON.parse(localStorage.getItem('dynasty-business-profile') || '{}');
    const tradeType = bp.tradeType || 'bricklayer';
    const isBrick   = tradeType === 'bricklayer' || tradeType === 'block_layer';

    // Overview KPI label
    const kpiEl = document.getElementById('kpiLabelBricksOverview');
    if (kpiEl) kpiEl.textContent = isBrick ? 'Total Bricks Today' : 'Units Today';

    // Biz toggle button
    const bizBtn = document.querySelector('.biz-toggle-btn[data-biz="bricklaying"]');
    if (bizBtn) bizBtn.textContent = TRADE_DISPLAY_NAMES[tradeType] || 'Trade Work';

    // Site card stat labels — DOM scan only, no rendering logic touched
    if (!isBrick) {
      document.querySelectorAll('.site-card-stat-label').forEach(el => {
        if (el.textContent === 'Bricks today')  el.textContent = 'Units today';
        if (el.textContent === 'Total bricks')  el.textContent = 'Total units';
      });
    }
  } catch (_) {}
}

applyTradeLabels();
