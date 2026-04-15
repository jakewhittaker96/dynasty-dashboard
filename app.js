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
let currentFullPin        = localStorage.getItem(PIN_KEY)        || '1234';
const PORTAL_PIN          = localStorage.getItem(PORTAL_PIN_KEY) || '9999';

function isPortal()  { return sessionStorage.getItem('dynasty-mode') === 'portal'; }
function isBuilder() { return sessionStorage.getItem('dynasty-mode') === 'builder'; }
function isFullMode(){ return sessionStorage.getItem('dynasty-mode') === 'full'; }

// ─── PIN Authentication ───────────────────────────────────────────────────────
(function initAuth() {
  const AUTH_KEY    = 'dynasty-auth';
  const loginScreen = document.getElementById('loginScreen');
  const dashboard   = document.getElementById('dashboardRoot');
  const pinInput    = document.getElementById('pinInput');
  const loginBtn    = document.getElementById('loginBtn');
  const loginError  = document.getElementById('loginError');

  function unlock(mode) {
    sessionStorage.setItem(AUTH_KEY, '1');
    sessionStorage.setItem('dynasty-mode', mode);
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
  }

  // Already authenticated this session
  if (sessionStorage.getItem(AUTH_KEY) === '1') {
    loginScreen.style.display = 'none';
    dashboard.hidden = false;
    if (isPortal()) {
      const wm = document.getElementById('portalWatermark');
      if (wm) wm.hidden = false;
    }
    if (isBuilder()) {
      const wm = document.getElementById('builderWatermark');
      if (wm) wm.hidden = false;
    }
    return;
  }

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

  loginBtn.addEventListener('click', attempt);
  pinInput.addEventListener('keydown', e => { if (e.key === 'Enter') attempt(); });
})();

// ─── Sheet URL ────────────────────────────────────────────────────────────────
const SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vTvsSIicwnMasEr8OQIilHtmjC0PAAgGh4WHxB3yJMNPv8feICE5MM97xFz6G0OTkpjWs7EZheqtB8G/pub?output=csv';

// ServiceM8 API
const SM8_URL     = 'https://api.servicem8.com/api_1.0/job.json';
const SM8_API_KEY = 'smk-aa87cc-9a9a0a802a22e535-394394c0f2a1d836';

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
    if (dom.viewRisk)    dom.viewRisk.hidden    = id !== 'risk';
    if (dom.viewSubbies) dom.viewSubbies.hidden = id !== 'subbies';
    if (dom.viewSafety)  dom.viewSafety.hidden  = id !== 'safety';
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

// ─── ServiceM8 Jobs ───────────────────────────────────────────────────────────

// SM8-specific proxy order: corsproxy.io forwards custom headers (incl. X-API-Key)
const SM8_PROXIES = [
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

async function fetchSM8(path) {
  const url     = `https://api.servicem8.com/api_1.0/${path}`;
  const headers = { 'X-API-Key': SM8_API_KEY, 'Accept': 'application/json' };

  // Try direct (works if running on a server with CORS headers)
  try {
    const res = await fetch(url, { headers });
    if (res.ok) return res.json();
  } catch (e) { /* CORS on file:// expected */ }

  for (const proxyFn of SM8_PROXIES) {
    const proxyUrl = proxyFn(url);
    try {
      const res  = await fetch(proxyUrl, { headers });
      const text = await res.text();
      console.log(`[Dynasty] SM8 ${path} via ${proxyUrl.slice(0, 40)}… — HTTP ${res.status}, raw[0-300]:`, text.slice(0, 300));
      if (!res.ok) continue;
      if (text.trimStart().startsWith('<')) continue;
      return JSON.parse(text);
    } catch (e) {
      console.warn(`[Dynasty] SM8 proxy failed (${path}):`, e.message);
    }
  }

  throw new Error(`ServiceM8 fetch failed for ${path}`);
}

const STATUS_CLASS = {
  'Quote':        'job-status--quote',
  'Work Order':   'job-status--work-order',
  'Completed':    'job-status--completed',
  'Unsuccessful': 'job-status--unsuccessful',
};

function fmtCurrency(n) {
  return '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function sumAmount(jobs) {
  return jobs.reduce((s, j) => s + parseFloat(j.total_invoice_amount || 0), 0);
}

// ─── Shared revenue data calculator ──────────────────────────────────────────
function calcJobsRevenue(jobs) {
  const total       = sumAmount(jobs);
  const completed   = sumAmount(jobs.filter(j => j.status === 'Completed'));
  const quoted      = sumAmount(jobs.filter(j => j.status === 'Quote'));
  const outstanding = sumAmount(jobs.filter(j => j.status === 'Work Order'));
  const paid        = sumAmount(jobs.filter(j => isPaid(j)));
  const unpaid      = sumAmount(jobs.filter(j => !isPaid(j) && parseFloat(j.total_invoice_amount || 0) > 0));

  const now  = new Date();
  const yr   = now.getFullYear();
  const mo   = now.getMonth();

  const thisMonthStart = new Date(yr, mo,     1);
  const lastMonthStart = new Date(yr, mo - 1, 1);
  const lastMonthEnd   = thisMonthStart;
  const ytdStart       = new Date(yr, 0, 1);
  const fyStart        = now >= new Date(yr, 6, 1) ? new Date(yr, 6, 1) : new Date(yr - 1, 6, 1);

  const jobDate = j => {
    const s = (j.date || '').substring(0, 10);
    return s ? new Date(s + 'T00:00:00') : null;
  };
  const doneJobs = jobs.filter(j => j.status === 'Completed');
  const inRange  = (j, start, end) => { const d = jobDate(j); return d && d >= start && (!end || d < end); };

  const thisMonth = sumAmount(doneJobs.filter(j => inRange(j, thisMonthStart)));
  const lastMonth = sumAmount(doneJobs.filter(j => inRange(j, lastMonthStart, lastMonthEnd)));
  const ytd       = sumAmount(doneJobs.filter(j => inRange(j, ytdStart)));
  const fytd      = sumAmount(doneJobs.filter(j => inRange(j, fyStart)));

  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  const projYTD    = (ytd  / Math.max(1, (now - ytdStart) / MS_PER_DAY)) * 365;
  const projFYTD   = (fytd / Math.max(1, (now - fyStart)  / MS_PER_DAY)) * 365;

  const yrLabel  = String(yr);
  const fyEndYr  = fyStart.getFullYear() + 1;
  const fyLabel  = `FY${String(fyStart.getFullYear()).slice(2)}/${String(fyEndYr).slice(2)}`;

  const fyJobUUIDs = new Set(doneJobs.filter(j => inRange(j, fyStart)).map(j => j.uuid));

  const LABOUR_RATE = 85; // $/hr default

  const matRevenue = sm8Materials === null ? null
    : sm8Materials
        .filter(m => m.active !== 0 && fyJobUUIDs.has(m.job_uuid))
        .reduce((s, m) => {
          const price = parseFloat(m.price || 0);
          const qty   = parseFloat(m.quantity || 1);
          return s + price * qty;
        }, 0);

  const labRevenue = sm8Activities === null ? null
    : sm8Activities
        .filter(a => a.active !== 0 && fyJobUUIDs.has(a.job_uuid))
        .reduce((s, a) => {
          // Derive hours from start_date / end_date; fall back to explicit fields
          const start = a.start_date ? new Date(a.start_date) : null;
          const end   = a.end_date   ? new Date(a.end_date)   : null;
          let hours = 0;
          if (start && end && end > start) {
            hours = (end - start) / (1000 * 60 * 60);
          } else {
            hours = parseFloat(a.total_hours || a.hours || a.duration_hours || 0);
          }
          return s + hours * LABOUR_RATE;
        }, 0);

  return { total, completed, quoted, outstanding, paid, unpaid,
           thisMonth, lastMonth, ytd, fytd,
           projYTD, projFYTD, yrLabel, fyLabel, matRevenue, labRevenue };
}

// Shared card builder for revenue-style cards
function revenueCard(value, label, valueCls = '', subtitle = '', cardCls = '') {
  return `
    <div class="jobs-revenue-card${cardCls ? ' ' + cardCls : ''}">
      <div class="jobs-revenue-value${valueCls ? ' ' + valueCls : ''}">${value === null ? '—' : fmtCurrency(value)}</div>
      <div class="jobs-revenue-label">${label}</div>
      ${subtitle ? `<div class="jobs-revenue-subtitle">${subtitle}</div>` : ''}
    </div>`;
}

// ─── Jobs tab rendering ───────────────────────────────────────────────────────
function renderJobsRevenue(jobs) {
  const { total, completed, quoted, outstanding, paid, unpaid,
          thisMonth, lastMonth, ytd, fytd, fyLabel } = calcJobsRevenue(jobs);

  dom.jobsRevenue.innerHTML =
    revenueCard(total,       'Total Invoiced') +
    revenueCard(completed,   'Completed Value',          'jobs-revenue-value--completed') +
    revenueCard(quoted,      'Total Quoted',              'jobs-revenue-value--quote') +
    revenueCard(outstanding, 'Outstanding (Work Orders)', 'jobs-revenue-value--outstanding') +
    revenueCard(paid,        'Total Paid',               'jobs-revenue-value--paid') +
    revenueCard(unpaid,      'Total Unpaid',             'jobs-revenue-value--unpaid') +
    revenueCard(thisMonth,   'This Month',                'jobs-revenue-value--completed') +
    revenueCard(lastMonth,   'Last Month',                'jobs-revenue-value--completed') +
    revenueCard(ytd,         'Year to Date',              'jobs-revenue-value--completed') +
    revenueCard(fytd,        `${fyLabel} to Date`,        'jobs-revenue-value--completed');
}

function renderJobsTabContent() {
  const bizJobs = filterByBiz(activeJobsData);
  renderJobsRevenue(bizJobs);
  renderJobsFilterPills();
  dom.jobsSearch.value = jobsSearchText;
  dom.jobsSearch.oninput = () => {
    jobsSearchText = dom.jobsSearch.value.toLowerCase();
    applyJobsFilters();
  };
  applyJobsFilters();
}

// ─── Pipeline tab rendering ───────────────────────────────────────────────────
function renderPipelineTabContent() {
  const bizJobs = filterByBiz(activeJobsData);
  const { projYTD, projFYTD, yrLabel, fyLabel } = calcJobsRevenue(bizJobs);

  dom.pipelineProjected.innerHTML =
    revenueCard(projYTD,  `${yrLabel} Projected`, 'jobs-revenue-value--projected', 'based on current pace', 'jobs-revenue-card--projected') +
    revenueCard(projFYTD, `${fyLabel} Projected`, 'jobs-revenue-value--projected', 'based on current pace', 'jobs-revenue-card--projected');

  renderJobsConversion(bizJobs, dom.pipelineConversion);
  renderJobsOverdue(bizJobs, dom.pipelineOverdue);
  renderStaleQuotes(bizJobs, dom.pipelineStaleQuotes);
}

// ─── Finance tab rendering ────────────────────────────────────────────────────
function renderFinanceTabContent() {
  const bizJobs = filterByBiz(activeJobsData);
  const { projYTD, projFYTD, yrLabel, fyLabel } = calcJobsRevenue(bizJobs);

  dom.financeProjected.innerHTML =
    revenueCard(projYTD,  `${yrLabel} Projected`, 'jobs-revenue-value--projected', 'based on current pace', 'jobs-revenue-card--projected') +
    revenueCard(projFYTD, `${fyLabel} Projected`, 'jobs-revenue-value--projected', 'based on current pace', 'jobs-revenue-card--projected');

  renderRevenueChart(bizJobs);
  renderTopClients(bizJobs);
  renderClientHealth(bizJobs);
  renderCashFlowForecast(bizJobs);
  renderBrickPriceTracker();
  renderProfitIntelligence(bizJobs);
  renderPayrollCalculator(bizJobs);
}

// ─── Revenue trend chart (Finance tab) ───────────────────────────────────────
let _chartRevenueInst = null;

function renderRevenueChart(jobs) {
  const canvas = document.getElementById('chartRevenue');
  if (!canvas) return;

  const completed = jobs.filter(j => j.status === 'Completed');
  const now = new Date();
  const labels = [];
  const data   = [];

  for (let i = 11; i >= 0; i--) {
    const d     = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const start = d;
    const end   = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    labels.push(d.toLocaleDateString('en-AU', { month: 'short', year: '2-digit' }));
    const amount = completed
      .filter(j => {
        const jd = new Date((j.date || '').substring(0, 10) + 'T00:00:00');
        return !isNaN(jd) && jd >= start && jd < end;
      })
      .reduce((s, j) => s + parseFloat(j.total_invoice_amount || 0), 0);
    data.push(Math.round(amount));
  }

  if (_chartRevenueInst) { _chartRevenueInst.destroy(); _chartRevenueInst = null; }

  _chartRevenueInst = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Revenue',
        data,
        borderColor: '#c9a84c',
        backgroundColor: 'rgba(201,168,76,0.07)',
        borderWidth: 2.5,
        pointBackgroundColor: '#c9a84c',
        pointBorderColor: '#c9a84c',
        pointRadius: 4,
        pointHoverRadius: 6,
        tension: 0.4,
        fill: true,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1e1e1e',
          borderColor: 'rgba(201,168,76,0.3)',
          borderWidth: 1,
          titleColor: '#8a8070',
          bodyColor: '#f0ead8',
          callbacks: { label: ctx => ' ' + fmtCurrency(ctx.raw) }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#8a8070', font: { size: 11 } }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: {
            color: '#8a8070',
            font: { size: 11 },
            callback: v => '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v)
          }
        }
      }
    }
  });
}

// ─── Top Clients panel (Finance tab) ─────────────────────────────────────────
function renderTopClients(jobs) {
  const el = document.getElementById('financeTopClients');
  if (!el) return;

  const completed = jobs.filter(j => j.status === 'Completed');
  const clientMap = new Map();

  for (const j of completed) {
    const uuid = j.company_uuid || '__unknown__';
    const name = sm8CompanyMap.get(uuid) || (uuid === '__unknown__' ? '(Unknown Client)' : uuid.slice(0, 8));
    if (!clientMap.has(uuid)) clientMap.set(uuid, { name, total: 0, paid: 0, unpaid: 0, count: 0 });
    const entry = clientMap.get(uuid);
    const amt   = parseFloat(j.total_invoice_amount || 0);
    entry.total += amt;
    entry.count++;
    if (isPaid(j)) entry.paid += amt; else entry.unpaid += amt;
  }

  const sorted = [...clientMap.values()].sort((a, b) => b.total - a.total).slice(0, 10);

  const labelEl = document.getElementById('financeTopClientsLabel');
  if (labelEl) labelEl.textContent = `(top ${sorted.length} completed jobs)`;

  if (!sorted.length) {
    el.innerHTML = '<p class="finance-loading">No completed job data available</p>';
    return;
  }

  el.innerHTML = `
    <div class="top-clients-wrap">
      <table class="top-clients-table">
        <thead><tr>
          <th>#</th>
          <th>Client</th>
          <th style="text-align:right">Jobs</th>
          <th style="text-align:right">Total</th>
          <th style="text-align:right">Paid</th>
          <th style="text-align:right">Unpaid</th>
        </tr></thead>
        <tbody>
          ${sorted.map((c, i) => `<tr>
            <td class="top-clients-rank">${i + 1}</td>
            <td class="top-clients-name">${escHtml(c.name)}</td>
            <td class="top-clients-jobs">${c.count}</td>
            <td class="top-clients-amount">${fmtCurrency(c.total)}</td>
            <td class="top-clients-paid">${fmtCurrency(c.paid)}</td>
            <td class="top-clients-unpaid${c.unpaid > 0 ? ' top-clients-unpaid--red' : ''}">${fmtCurrency(c.unpaid)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// ─── Shared SM8 sub-renders ───────────────────────────────────────────────────
function renderJobsConversion(jobs, container) {
  const quoteCount = jobs.filter(j => j.status === 'Quote').length;
  const wonCount   = jobs.filter(j => j.status === 'Work Order' || j.status === 'Completed').length;
  const eligible   = quoteCount + wonCount;
  const rate       = eligible > 0 ? Math.round((wonCount / eligible) * 100) : 0;
  const pipeline   = sumAmount(jobs.filter(j => j.status === 'Quote'));
  const rateCls    = rate >= 50 ? 'jobs-conversion-rate--good' : 'jobs-conversion-rate--poor';

  const c = (val, label, cls = '') => `
    <div class="jobs-conversion-card">
      <div class="jobs-conversion-value${cls ? ' ' + cls : ''}">${val}</div>
      <div class="jobs-conversion-label">${label}</div>
    </div>`;

  container.innerHTML =
    c(quoteCount,            'Total Quotes') +
    c(wonCount,              'Total Won') +
    c(rate + '%',            'Conversion Rate', rateCls) +
    c(fmtCurrency(pipeline), 'Quotes Pipeline Value');
}

function renderJobsOverdue(jobs, container) {
  const now        = new Date();
  const MS_PER_DAY = 1000 * 60 * 60 * 24;

  const aged = jobs
    .filter(j => j.status === 'Work Order')
    .map(j => {
      const d = new Date((j.date || '').substring(0, 10) + 'T00:00:00');
      return { ...j, _d: d, _age: Math.floor((now - d) / MS_PER_DAY) };
    })
    .filter(j => !isNaN(j._d) && j._age > 30);

  // Apply toggle: when showOldWorkOrders is off, hide those >90 days
  const overdue = aged
    .filter(j => showOldWorkOrders || j._age <= 90)
    .sort((a, b) => b._age - a._age);

  const uid = container.id;

  // Build toggle checkbox HTML
  const checkboxHtml = `
    <label class="overdue-filter-label">
      <input type="checkbox" id="${uid}ShowOld" class="overdue-filter-check" ${showOldWorkOrders ? 'checked' : ''} />
      Show Work Orders older than 90 days
    </label>`;

  if (!overdue.length) {
    container.innerHTML = `<div class="overdue-filter-wrap">${checkboxHtml}</div>`;
    document.getElementById(`${uid}ShowOld`).addEventListener('change', e => {
      showOldWorkOrders = e.target.checked;
      renderPipelineTabContent();
    });
    return;
  }

  const overdueRowsHtml = overdue.map(j => {
    const desc   = (j.job_description || '').split('\n')[0].trim() || '—';
    const addr   = (j.job_address     || '').split('\n')[0].trim() || '—';
    const amt    = parseFloat(j.total_invoice_amount || 0);
    const date   = (j.date || '').substring(0, 10).split('-').reverse().join('/');
    const ageCls = j._age > 60 ? 'jobs-overdue-days--critical' : 'jobs-overdue-days--warning';
    return `
      <div class="jobs-overdue-item">
        <div class="jobs-overdue-item-main">
          <span class="jobs-overdue-job-id">#${escHtml(j.generated_job_id || '—')}</span>
          <span class="jobs-overdue-desc">${escHtml(desc)}</span>
        </div>
        <div class="jobs-overdue-item-meta">
          <span class="jobs-overdue-addr">${escHtml(addr)}</span>
          <span class="jobs-overdue-amount">${amt > 0 ? fmtCurrency(amt) : '—'}</span>
          <span class="jobs-overdue-date">${date}</span>
          <span class="jobs-overdue-days ${ageCls}">${j._age} days old</span>
        </div>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="overdue-filter-wrap">${checkboxHtml}</div>
    <div class="jobs-overdue-card">
      <button class="jobs-overdue-toggle" id="${uid}Toggle" aria-expanded="true">
        <span class="jobs-overdue-icon">&#9888;</span>
        <span class="jobs-overdue-title">Overdue / Stale Work Orders — ${overdue.length} job${overdue.length !== 1 ? 's' : ''}</span>
        <span class="jobs-overdue-chevron" id="${uid}Chevron">&#9650;</span>
      </button>
      <div class="jobs-overdue-list" id="${uid}List">${overdueRowsHtml}</div>
    </div>`;

  document.getElementById(`${uid}ShowOld`).addEventListener('change', e => {
    showOldWorkOrders = e.target.checked;
    renderPipelineTabContent();
  });

  const toggleBtn = document.getElementById(`${uid}Toggle`);
  const list      = document.getElementById(`${uid}List`);
  const chevron   = document.getElementById(`${uid}Chevron`);
  if (toggleBtn && list) {
    toggleBtn.addEventListener('click', () => {
      const opening = list.hidden;
      list.hidden   = !opening;
      chevron.innerHTML = opening ? '&#9650;' : '&#9660;';
      toggleBtn.setAttribute('aria-expanded', String(opening));
    });
  }
}

// ─── Stale Quotes panel (Pipeline tab) ───────────────────────────────────────
function renderStaleQuotes(jobs, container) {
  if (!container) return;
  const now        = new Date();
  const MS_PER_DAY = 1000 * 60 * 60 * 24;

  const stale = jobs
    .filter(j => j.status === 'Quote')
    .map(j => {
      const d = new Date((j.date || '').substring(0, 10) + 'T00:00:00');
      return { ...j, _d: d, _age: Math.floor((now - d) / MS_PER_DAY) };
    })
    .filter(j => !isNaN(j._d) && j._age >= 90)
    .sort((a, b) => b._age - a._age);

  if (!stale.length) { container.innerHTML = ''; return; }

  const uid = 'staleQuotes';
  const rowsHtml = stale.map(j => {
    const desc   = (j.job_description || '').split('\n')[0].trim() || '—';
    const client = sm8CompanyMap.get(j.company_uuid || '') || '—';
    const addr   = (j.job_address    || '').split('\n')[0].trim() || '—';
    const amt    = parseFloat(j.total_invoice_amount || 0);
    const date   = (j.date || '').substring(0, 10).split('-').reverse().join('/');
    return `
      <div class="jobs-overdue-item stale-quote-item">
        <div class="jobs-overdue-item-main">
          <span class="jobs-overdue-job-id">#${escHtml(j.generated_job_id || '—')}</span>
          <span class="jobs-overdue-desc">${escHtml(desc)}</span>
          <span class="stale-quote-client">${escHtml(client)}</span>
        </div>
        <div class="jobs-overdue-item-meta">
          <span class="jobs-overdue-addr">${escHtml(addr)}</span>
          <span class="jobs-overdue-amount">${amt > 0 ? fmtCurrency(amt) : '—'}</span>
          <span class="jobs-overdue-date">${date}</span>
          <span class="jobs-overdue-days jobs-overdue-days--critical">${j._age} days old</span>
          <span class="stale-quote-hint">Consider marking Unsuccessful in ServiceM8</span>
        </div>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="jobs-overdue-card stale-quotes-card">
      <button class="jobs-overdue-toggle" id="${uid}Toggle" aria-expanded="false">
        <span class="jobs-overdue-icon stale-quotes-icon">&#128065;</span>
        <span class="jobs-overdue-title">Stale Quotes (90+ days) — ${stale.length} quote${stale.length !== 1 ? 's' : ''}</span>
        <span class="jobs-overdue-chevron" id="${uid}Chevron">&#9660;</span>
      </button>
      <div class="jobs-overdue-list" id="${uid}List" hidden>${rowsHtml}</div>
    </div>`;

  const toggleBtn = document.getElementById(`${uid}Toggle`);
  const list      = document.getElementById(`${uid}List`);
  const chevron   = document.getElementById(`${uid}Chevron`);
  if (toggleBtn && list) {
    toggleBtn.addEventListener('click', () => {
      const opening = list.hidden;
      list.hidden   = !opening;
      chevron.innerHTML = opening ? '&#9650;' : '&#9660;';
      toggleBtn.setAttribute('aria-expanded', String(opening));
    });
  }
}

function renderJobsFilterPills() {
  const options = [
    { label: 'All',          key: '__all__'      },
    { label: 'Quote',        key: 'Quote'        },
    { label: 'Work Order',   key: 'Work Order'   },
    { label: 'Completed',    key: 'Completed'    },
    { label: 'Unsuccessful', key: 'Unsuccessful' },
  ];
  dom.jobsFilterPills.innerHTML = options.map(o =>
    `<button class="jobs-filter-pill${jobsStatusFilter === o.key ? ' jobs-filter-pill--active' : ''}"
             data-status="${escHtml(o.key)}">${escHtml(o.label)}</button>`
  ).join('');

  dom.jobsFilterPills.querySelectorAll('.jobs-filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      jobsStatusFilter = btn.dataset.status;
      renderJobsFilterPills();
      applyJobsFilters();
    });
  });
}

function applyJobsFilters() {
  let filtered = filterByBiz(activeJobsData);

  if (jobsStatusFilter !== '__all__') {
    filtered = filtered.filter(j => j.status === jobsStatusFilter);
  }
  if (jobsSearchText) {
    filtered = filtered.filter(j =>
      (j.job_description || '').toLowerCase().includes(jobsSearchText) ||
      (j.job_address     || '').toLowerCase().includes(jobsSearchText)
    );
  }

  dom.jobsCount.textContent = `${filtered.length} job${filtered.length !== 1 ? 's' : ''}`;

  // Toggle show-profit class on the table
  const jobsTable = document.getElementById('jobsTable');
  if (jobsTable) jobsTable.classList.toggle('show-profit', showProfit);

  const colSpan = showProfit ? 9 : 8;

  if (!filtered.length) {
    dom.jobsTableBody.innerHTML =
      `<tr><td colspan="${colSpan}" class="table-empty">No jobs match the current filters</td></tr>`;
    return;
  }

  const profitMap  = showProfit ? buildJobProfitMap() : null;
  const DAILY_COST = 800;
  const chaseLog   = loadChaseLog();

  dom.jobsTableBody.innerHTML = filtered.map(job => {
    const desc      = (job.job_description || '').split('\n')[0].trim() || '—';
    const client    = sm8CompanyMap.get(job.company_uuid || '') || '—';
    const address   = (job.job_address    || '').split('\n')[0].trim() || '—';
    const status    = job.status || '—';
    const amount    = parseFloat(job.total_invoice_amount || 0);
    const amountStr = amount > 0 ? fmtCurrency(amount) : '—';
    const rawDate   = (job.date || '').substring(0, 10);
    const dateStr   = rawDate ? rawDate.split('-').reverse().join('/') : '—';
    const paid      = isPaid(job);
    const payBadge  = paid
      ? '<span class="payment-badge payment-badge--paid">Paid</span>'
      : '<span class="payment-badge payment-badge--unpaid">Unpaid</span>';

    // Chase button cell
    let chaseTd = '<td class="jobs-col-chase"></td>';
    if (status === 'Completed' && !paid && amount > 0) {
      const chased = chaseLog[job.uuid];
      if (chased) {
        const daysAgo = Math.max(0, Math.floor((Date.now() - chased.ts) / (1000 * 60 * 60 * 24)));
        chaseTd = `<td class="jobs-col-chase"><span class="chase-done">Chased ${daysAgo}d ago</span></td>`;
      } else {
        chaseTd = `<td class="jobs-col-chase"><button class="chase-btn" data-chase-uuid="${escHtml(job.uuid)}">&#128394; Chase</button></td>`;
      }
    }

    let profitTd = '';
    if (showProfit) {
      const hours  = profitMap ? (profitMap.get(job.uuid) || 0) : 0;
      if (amount > 0) {
        const profit = amount - (hours / 8) * DAILY_COST;
        const cls    = profit >= 0 ? 'profit-positive' : 'profit-negative';
        profitTd = `<td class="jobs-col-profit"><span class="${cls}">${fmtCurrency(profit)}</span></td>`;
      } else {
        profitTd = `<td class="jobs-col-profit"><span class="profit-neutral">—</span></td>`;
      }
    }

    return `<tr>
      <td class="jobs-col-desc">${escHtml(desc)}</td>
      <td class="jobs-col-client">${escHtml(client)}</td>
      <td class="jobs-col-addr">${escHtml(address)}</td>
      <td><span class="job-status-badge ${STATUS_CLASS[status] || ''}">${escHtml(status)}</span></td>
      <td class="jobs-col-amount">${escHtml(amountStr)}</td>
      <td>${payBadge}</td>
      <td class="jobs-col-date">${escHtml(dateStr)}</td>
      ${chaseTd}
      ${profitTd}
    </tr>`;
  }).join('');
}

// ─── Job profit map (job_uuid → estimated total hours) ───────────────────────
function buildJobProfitMap() {
  if (!sm8Activities) return new Map();
  const map = new Map();
  for (const a of sm8Activities) {
    if (a.active === 0) continue;
    const uuid = a.job_uuid;
    if (!uuid) continue;
    const start = a.start_date ? new Date(a.start_date) : null;
    const end   = a.end_date   ? new Date(a.end_date)   : null;
    let hours = 0;
    if (start && end && end > start) {
      hours = (end - start) / (1000 * 60 * 60);
    } else {
      hours = parseFloat(a.total_hours || a.hours || a.duration_hours || 0);
    }
    map.set(uuid, (map.get(uuid) || 0) + hours);
  }
  return map;
}

// ─── Export CSV ───────────────────────────────────────────────────────────────
function exportCSV() {
  let filtered = filterByBiz(activeJobsData);
  if (jobsStatusFilter !== '__all__') {
    filtered = filtered.filter(j => j.status === jobsStatusFilter);
  }
  if (jobsSearchText) {
    filtered = filtered.filter(j =>
      (j.job_description || '').toLowerCase().includes(jobsSearchText) ||
      (j.job_address     || '').toLowerCase().includes(jobsSearchText)
    );
  }

  const headers = ['Description', 'Client', 'Address', 'Status', 'Invoice', 'Payment', 'Date'];
  if (showProfit) headers.push('Profit Est.');

  const profitMap = showProfit ? buildJobProfitMap() : null;
  const DAILY_COST = 800;

  const csvRows = [headers];
  for (const job of filtered) {
    const desc    = (job.job_description || '').split('\n')[0].trim() || '';
    const client  = sm8CompanyMap.get(job.company_uuid || '') || '';
    const address = (job.job_address || '').split('\n')[0].trim() || '';
    const status  = job.status || '';
    const amount  = parseFloat(job.total_invoice_amount || 0);
    const dateStr = (job.date || '').substring(0, 10).split('-').reverse().join('/');
    const paid    = isPaid(job) ? 'Paid' : 'Unpaid';
    const row = [desc, client, address, status, amount > 0 ? amount.toFixed(2) : '', paid, dateStr];
    if (showProfit) {
      const hours  = profitMap ? (profitMap.get(job.uuid) || 0) : 0;
      const profit = amount > 0 ? amount - (hours / 8) * DAILY_COST : '';
      row.push(profit !== '' ? profit.toFixed(2) : '');
    }
    csvRows.push(row);
  }

  const csv = csvRows.map(r =>
    r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
  ).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'dynasty-jobs.csv'; a.click();
  URL.revokeObjectURL(url);
}

// Render the correct SM8 tab based on tabKey
function renderSM8Tab(tabKey) {
  if (tabKey === '__jobs__')     renderJobsTabContent();
  else if (tabKey === '__pipeline__') renderPipelineTabContent();
  else if (tabKey === '__finance__')  renderFinanceTabContent();
}

async function loadServiceM8Data(tabKey) {
  if (jobsLoaded) {
    renderSM8Tab(tabKey);
    return;
  }

  // Show loading placeholder in whichever tab is opening
  if (tabKey === '__jobs__') {
    dom.jobsTableBody.innerHTML   = '<tr><td colspan="7" class="table-empty">Loading jobs…</td></tr>';
    dom.jobsCount.textContent     = '';
    dom.jobsRevenue.innerHTML     = '';
    dom.jobsFilterPills.innerHTML = '';
  } else if (tabKey === '__pipeline__') {
    dom.pipelineProjected.innerHTML  = '';
    dom.pipelineConversion.innerHTML = '';
    dom.pipelineOverdue.innerHTML    = '';
  } else if (tabKey === '__finance__') {
    dom.financeProjected.innerHTML = '';
  }

  jobsStatusFilter = '__all__';
  jobsSearchText   = '';
  sm8Materials     = null;
  sm8Activities    = null;

  sm8CompanyMap = new Map();

  try {
    const [jobsRes, matsRes, actsRes, coRes] = await Promise.allSettled([
      fetchSM8('job.json'),
      fetchSM8('jobmaterial.json'),
      fetchSM8('jobactivity.json'),
      fetchSM8('company.json'),
    ]);

    if (jobsRes.status === 'rejected') throw jobsRes.reason;

    if (matsRes.status === 'fulfilled') {
      sm8Materials = matsRes.value;
      console.log('[Dynasty] Materials loaded:', sm8Materials.length, 'entries. First entry:', JSON.stringify(sm8Materials[0], null, 2));
    } else {
      console.warn('[Dynasty] Materials fetch failed:', matsRes.reason?.message);
    }

    if (actsRes.status === 'fulfilled') {
      sm8Activities = actsRes.value;
      console.log('[Dynasty] Activities loaded:', sm8Activities.length, 'entries. First entry:', JSON.stringify(sm8Activities[0], null, 2));
    } else {
      console.warn('[Dynasty] Activities fetch failed:', actsRes.reason?.message);
    }

    if (coRes.status === 'fulfilled') {
      for (const co of coRes.value) {
        if (co.uuid) sm8CompanyMap.set(co.uuid, co.name || co.company_name || '');
      }
      console.log('[Dynasty] Companies loaded:', sm8CompanyMap.size, 'entries');
    } else {
      console.warn('[Dynasty] Companies fetch failed:', coRes.reason?.message);
    }

    const allJobs = jobsRes.value;
    if (allJobs.length) {
      const sample = allJobs[0];
      console.log('[Dynasty] Job fields available:', Object.keys(sample).sort().join(', '));
      console.log('[Dynasty] Payment-related fields:', Object.entries(sample)
        .filter(([k]) => /pay|paid|invoice|amount|status/i.test(k))
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', '));
    }

    activeJobsData = allJobs
      .filter(j => j.active === 1)
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    jobsLoaded = true;
    updateTabBadges(filterByBiz(activeJobsData));
    renderSM8Tab(tabKey);

  } catch (err) {
    if (tabKey === '__jobs__') {
      dom.jobsTableBody.innerHTML =
        `<tr><td colspan="7" class="table-empty">Failed to load jobs — ${escHtml(err.message)}</td></tr>`;
    } else {
      const errEl = tabKey === '__pipeline__' ? dom.pipelineProjected : dom.financeProjected;
      if (errEl) errEl.innerHTML = `<p class="finance-loading finance-loading--error">Failed to load data — ${escHtml(err.message)}</p>`;
    }
    console.error('[Dynasty] ServiceM8 fetch failed:', err);
  }
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
// FEATURE 3 — BUILDER PORTAL VIEW (renderAllJobs override when isBuilder())
// ═══════════════════════════════════════════════════════════════════════════════

function renderBuilderView(bySite) {
  const grid = dom.siteCardsGrid;
  if (!grid) return;

  // Hide sections not relevant to builders
  ['weeklyTrendSection', 'allMaterialsPanel', 'weeklySummary', 'alertsBanner',
   'completedSitesPanel', 'crewLeaderboardPanel', 'completionCountdown'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  });
  // Hide header action buttons not for builders
  ['btnWeeklySummary', 'btnCalculate', 'btnSettings', 'bizToggle'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  // Hide overview KPIs row
  const kpiGrid = document.querySelector('#viewAll .kpi-grid');
  if (kpiGrid) kpiGrid.hidden = true;

  let html = '';
  for (const [siteName, rows] of bySite) {
    const latest  = rows[rows.length - 1];
    const prog    = Math.min(100, Math.max(0, latest.progress || 0));
    const daysLeft= (latest.daysLeft || 0) + (latest.weatherDelay === 'Yes' ? 1 : 0);
    const status  = getSiteStatus(siteName, rows);
    const isWeather = latest.weatherDelay === 'Yes';
    const badgeLbl  = isWeather ? '☁ Weather Day'
      : status === 'problem' ? '⚠ Problem'
      : status === 'behind'  ? '▲ Behind'
      : '✓ On Track';
    const badgeCls = isWeather ? 'site-card-badge--weather'
      : status === 'problem' ? 'site-card-badge--problem'
      : status === 'behind'  ? 'site-card-badge--behind'
      : 'site-card-badge--ok';

    const rawPhoto = latest.photoUrl || '';
    let photoThumb = '';
    if (rawPhoto) {
      const m = rawPhoto.match(/\/file\/d\/([^/]+)/);
      const src = m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w400` : rawPhoto;
      photoThumb = `<div class="builder-card-photo"><img src="${escHtml(src)}" alt="Progress" loading="lazy" /></div>`;
    }

    const weatherEl = `<span class="site-weather-badge" data-site-weather="${escHtml(siteName)}">…</span>`;

    html += `
      <div class="builder-card">
        <div class="builder-card-header">
          <span class="builder-card-name">${escHtml(siteName)}</span>
          <span class="site-card-badge ${badgeCls}">${badgeLbl}</span>
        </div>
        ${photoThumb}
        <div class="builder-card-progress-wrap">
          <div class="builder-card-progress-bar" style="width:${prog}%"></div>
        </div>
        <div class="builder-card-stats">
          <div class="builder-stat"><div class="builder-stat-val">${prog}%</div><div class="builder-stat-lbl">Complete</div></div>
          <div class="builder-stat"><div class="builder-stat-val">${daysLeft > 0 ? daysLeft + 'd' : '—'}</div><div class="builder-stat-lbl">Est. Days Left</div></div>
          <div class="builder-stat">${weatherEl}<div class="builder-stat-lbl">Today</div></div>
        </div>
        ${latest.doneToday ? `<div class="builder-card-done"><strong>Today:</strong> ${escHtml(latest.doneToday)}</div>` : ''}
      </div>`;
  }

  grid.innerHTML = html || '<p class="table-empty">No active sites</p>';

  // Load weather async
  loadWeatherForAllSites(bySite);
}


// ═══════════════════════════════════════════════════════════════════════════════
// FEATURE 5 — PREDICTIVE DELAY ENGINE (Risk Report Tab)
// ═══════════════════════════════════════════════════════════════════════════════

function calcRiskScore(siteName, rows, weather) {
  const latest   = rows[rows.length - 1];
  let score      = 0;
  const factors  = [];

  // Progress behind schedule
  const prog = latest.progress || 0;
  const daysL = latest.daysLeft || 0;
  if (prog < 50 && daysL < 5)  { score += 40; factors.push('Less than 50% done with few days left'); }
  else if (prog < 30)           { score += 20; factors.push('Low progress percentage'); }

  // Days left increasing
  const firstDays = rows[0].daysLeft;
  if (firstDays > 0 && daysL > firstDays * 1.3) {
    score += 25;
    factors.push(`Estimated days left grew from ${firstDays} to ${daysL}`);
  }

  // Active problem
  if (latest.problems && latest.problems.trim()) {
    score += 25;
    factors.push(`Active problem: "${latest.problems.trim()}"`);
  }

  // Weather delay flag
  if (latest.weatherDelay === 'Yes') {
    score += 10;
    factors.push('Current weather delay');
  }

  // Forecasted rain risk
  if (weather && weather.rain3day) {
    score += 15;
    factors.push('Rain forecast in next 3 days (>60% probability)');
  }

  score = Math.min(100, score);
  const level = score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';

  const recs = [];
  if (level === 'high') {
    recs.push('Review completion timeline with foreman immediately');
    recs.push('Consider adding crew resources');
    if (weather && weather.rain3day) recs.push('Schedule weather-sensitive work for later in the week');
  } else if (level === 'medium') {
    recs.push('Monitor daily progress closely');
    if (latest.problems) recs.push('Resolve flagged problem to prevent further delays');
  } else {
    recs.push('No immediate action required');
  }

  return { score, level, factors, recs };
}

function renderRiskTab() {
  const el = document.getElementById('riskReportContent');
  if (!el) return;

  if (!currentBySite || currentBySite.size === 0) {
    el.innerHTML = '<p class="table-empty">No site data loaded — refresh first.</p>';
    return;
  }

  el.innerHTML = '<p class="risk-loading">Analysing sites…</p>';

  const siteList = [...currentBySite.entries()];

  Promise.all(siteList.map(async ([siteName, rows]) => {
    const weather = await fetchSiteWeather(siteName).catch(() => null);
    return { siteName, rows, weather };
  })).then(results => {
    const scored = results.map(({ siteName, rows, weather }) => ({
      siteName,
      rows,
      weather,
      ...calcRiskScore(siteName, rows, weather),
    })).sort((a, b) => b.score - a.score);

    const levelLabel = { high: '🔴 High Risk', medium: '🟡 Medium Risk', low: '🟢 Low Risk' };
    const levelCls   = { high: 'risk-card--high', medium: 'risk-card--medium', low: 'risk-card--low' };

    el.innerHTML = scored.map(s => {
      const today = s.weather && s.weather.days[0];
      const weatherSnip = today
        ? `<span class="risk-weather">${weatherCodeIcon(today.code)} ${Math.round(today.maxTemp)}°C${s.weather.rain3day ? ' ⚠ Rain risk' : ''}</span>`
        : '';

      return `
        <div class="risk-card ${levelCls[s.level]}">
          <div class="risk-card-header">
            <span class="risk-card-name">${escHtml(s.siteName)}</span>
            <div class="risk-card-meta">
              ${weatherSnip}
              <span class="risk-badge risk-badge--${s.level}">${levelLabel[s.level]} (${s.score}/100)</span>
            </div>
          </div>
          <div class="risk-card-body">
            <div class="risk-col">
              <div class="risk-col-title">Risk Factors</div>
              <ul class="risk-list">${s.factors.map(f => `<li>${escHtml(f)}</li>`).join('') || '<li>None identified</li>'}</ul>
            </div>
            <div class="risk-col">
              <div class="risk-col-title">Recommendations</div>
              <ul class="risk-list risk-list--recs">${s.recs.map(r => `<li>${escHtml(r)}</li>`).join('')}</ul>
            </div>
          </div>
        </div>`;
    }).join('');
  });
}


// ═══════════════════════════════════════════════════════════════════════════════
// FEATURE 6 — CLIENT HEALTH SCORE (Finance Tab)
// ═══════════════════════════════════════════════════════════════════════════════

function renderClientHealth(jobs) {
  const el = document.getElementById('financeClientHealth');
  if (!el) return;

  const completed = jobs.filter(j => j.status === 'Completed');
  const clientMap = new Map();

  for (const j of completed) {
    const uuid = j.company_uuid || '__unknown__';
    const name = sm8CompanyMap.get(uuid) || (uuid === '__unknown__' ? '(Unknown)' : uuid.slice(0, 8));
    if (!clientMap.has(uuid)) clientMap.set(uuid, { name, jobs: [], totalRevenue: 0 });
    clientMap.get(uuid).jobs.push(j);
    clientMap.get(uuid).totalRevenue += parseFloat(j.total_invoice_amount || 0);
  }

  if (!clientMap.size) {
    el.innerHTML = '<p class="finance-loading">No completed job data available</p>';
    return;
  }

  const now = Date.now();
  const MS  = 1000 * 60 * 60 * 24;

  const clients = [...clientMap.values()].map(c => {
    const jobCount   = c.jobs.length;
    const avgValue   = c.totalRevenue / jobCount;
    const paidCount  = c.jobs.filter(isPaid).length;
    const payRate    = jobCount > 0 ? paidCount / jobCount : 0;

    // Avg days to payment (paid jobs only)
    const paidTimes = c.jobs.filter(isPaid).map(j => {
      const d = new Date((j.date || '').substring(0, 10) + 'T00:00:00');
      return isNaN(d) ? 30 : Math.min((now - d) / MS, 90);
    });
    const avgPayDays = paidTimes.length > 0
      ? paidTimes.reduce((a, b) => a + b, 0) / paidTimes.length
      : 60;

    // Score components (0–100 each)
    const paySpeedScore  = Math.max(0, 100 - avgPayDays);        // faster = higher
    const payRateScore   = payRate * 100;
    const repeatScore    = Math.min(100, (jobCount - 1) * 20);   // 5+ jobs = max
    const valueScore     = Math.min(100, (avgValue / 500) * 20); // $2500 avg = max

    const score = Math.round(0.35 * paySpeedScore + 0.30 * payRateScore + 0.20 * repeatScore + 0.15 * valueScore);

    return { ...c, score, jobCount, avgValue, payRate };
  }).sort((a, b) => b.score - a.score);

  const badge = score => {
    if (score >= 80) return '<span class="health-badge health-badge--green">⭐ Best Client</span>';
    if (score >= 50) return '<span class="health-badge health-badge--gold">✓ Good</span>';
    return '<span class="health-badge health-badge--red">⚠ Review Relationship</span>';
  };

  el.innerHTML = `
    <div class="health-wrap">
      <table class="health-table">
        <thead><tr>
          <th>Client</th>
          <th style="text-align:right">Score</th>
          <th style="text-align:right">Jobs</th>
          <th style="text-align:right">Avg Value</th>
          <th style="text-align:right">Pay Rate</th>
          <th>Status</th>
        </tr></thead>
        <tbody>
          ${clients.map(c => `<tr>
            <td class="health-name">${escHtml(c.name)}</td>
            <td style="text-align:right"><span class="health-score health-score--${c.score >= 80 ? 'green' : c.score >= 50 ? 'gold' : 'red'}">${c.score}</span></td>
            <td style="text-align:right">${c.jobCount}</td>
            <td style="text-align:right">${fmtCurrency(c.avgValue)}</td>
            <td style="text-align:right">${Math.round(c.payRate * 100)}%</td>
            <td>${badge(c.score)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}


// ═══════════════════════════════════════════════════════════════════════════════
// FEATURE 7 — CASH FLOW FORECAST (Finance Tab)
// ═══════════════════════════════════════════════════════════════════════════════

const CASH_FLOW_WAGES_KEY = 'dynasty-weekly-wages';

function renderCashFlowForecast(jobs) {
  const el = document.getElementById('financeCashFlow');
  if (!el) return;

  const weeklyWages = parseFloat(localStorage.getItem(CASH_FLOW_WAGES_KEY) || '8000');

  const now    = Date.now();
  const MS     = 1000 * 60 * 60 * 24;

  // Unpaid completed invoices — expected income
  const unpaidCompleted = jobs.filter(j => j.status === 'Completed' && !isPaid(j)).map(j => {
    const amt  = parseFloat(j.total_invoice_amount || 0);
    const d    = new Date((j.date || '').substring(0, 10) + 'T00:00:00');
    const age  = isNaN(d) ? 30 : (now - d) / MS;
    return { amt, age };
  });

  // Pipeline quotes (potential income)
  const quoteIncome = jobs.filter(j => j.status === 'Quote')
    .reduce((s, j) => s + parseFloat(j.total_invoice_amount || 0), 0);

  const expectedIn30 = unpaidCompleted.filter(j => j.age <= 30).reduce((s, j) => s + j.amt, 0);
  const expectedIn60 = unpaidCompleted.filter(j => j.age <= 60).reduce((s, j) => s + j.amt, 0);
  const expectedIn90 = unpaidCompleted.reduce((s, j) => s + j.amt, 0);

  const wagesPerPeriod = { d30: weeklyWages * 4.3, d60: weeklyWages * 8.6, d90: weeklyWages * 13 };

  const net30 = expectedIn30 - wagesPerPeriod.d30;
  const net60 = expectedIn60 - wagesPerPeriod.d60;
  const net90 = expectedIn90 - wagesPerPeriod.d90;

  const cashCard = (label, income, wages, net) => {
    const cls = net < 0 ? 'cashflow-card--red' : 'cashflow-card--ok';
    return `
      <div class="cashflow-card ${cls}">
        <div class="cashflow-period">${label}</div>
        <div class="cashflow-row"><span>Expected in</span><span class="cashflow-in">${fmtCurrency(income)}</span></div>
        <div class="cashflow-row"><span>Wages out</span><span class="cashflow-out">-${fmtCurrency(wages)}</span></div>
        <div class="cashflow-row cashflow-net"><span>Net</span><span class="${net < 0 ? 'cashflow-neg' : 'cashflow-pos'}">${net < 0 ? '-' : '+'}${fmtCurrency(Math.abs(net))}</span></div>
      </div>`;
  };

  el.innerHTML = `
    <div class="cashflow-wrap">
      <div class="cashflow-config">
        <label class="cashflow-wages-label">Weekly Wages ($)</label>
        <input type="number" id="cashFlowWages" class="cashflow-wages-input" value="${weeklyWages}" min="0" step="500" />
        <button class="cashflow-wages-save" id="btnSaveWages">Update</button>
        <span class="cashflow-pipeline-note">Pipeline (quotes): ${fmtCurrency(quoteIncome)}</span>
      </div>
      <div class="cashflow-cards-grid">
        ${cashCard('30 Days', expectedIn30, wagesPerPeriod.d30, net30)}
        ${cashCard('60 Days', expectedIn60, wagesPerPeriod.d60, net60)}
        ${cashCard('90 Days', expectedIn90, wagesPerPeriod.d90, net90)}
      </div>
    </div>`;

  document.getElementById('btnSaveWages')?.addEventListener('click', () => {
    const v = parseFloat(document.getElementById('cashFlowWages')?.value || '8000');
    if (!isNaN(v) && v >= 0) {
      localStorage.setItem(CASH_FLOW_WAGES_KEY, String(v));
      renderCashFlowForecast(jobs);
      showToast('Wages updated', 'success', 2000);
    }
  });
}


// ═══════════════════════════════════════════════════════════════════════════════
// FEATURE 8 — SUBCONTRACTOR TRACKER (Subbies Tab)
// ═══════════════════════════════════════════════════════════════════════════════

let subbieEditId = null; // null = add mode, string = edit mode (subbie uuid)

function renderSubbiesTab() {
  const el = document.getElementById('subbiesContent');
  if (!el) return;

  const subbies = loadSubbies().sort((a, b) => (b.reliability || 0) - (a.reliability || 0));

  if (!subbies.length) {
    el.innerHTML = '<p class="table-empty" style="padding:24px 0">No subcontractors added yet. Click "+ Add Subbie" to get started.</p>';
    return;
  }

  const stars = n => '★'.repeat(n || 0) + '☆'.repeat(5 - (n || 0));

  el.innerHTML = `
    <div class="subbies-grid">
      ${subbies.map(s => `
        <div class="subbie-card" data-id="${escHtml(s.id)}">
          <div class="subbie-card-header">
            <span class="subbie-name">${escHtml(s.name)}</span>
            <span class="subbie-trade">${escHtml(s.trade || '—')}</span>
          </div>
          <div class="subbie-stats">
            <div class="subbie-stat"><span class="subbie-stat-lbl">Day Rate</span><span class="subbie-stat-val">$${escHtml(String(s.dayRate || '—'))}</span></div>
            <div class="subbie-stat"><span class="subbie-stat-lbl">Phone</span><span class="subbie-stat-val">${escHtml(s.phone || '—')}</span></div>
            <div class="subbie-stat"><span class="subbie-stat-lbl">Jobs</span><span class="subbie-stat-val">${escHtml(String(s.jobsWorked || 0))}</span></div>
          </div>
          <div class="subbie-ratings">
            <span class="subbie-rating-lbl">Reliability</span>
            <span class="subbie-stars subbie-stars--gold" title="${s.reliability || 0}/5">${stars(s.reliability)}</span>
            <span class="subbie-rating-lbl">Quality</span>
            <span class="subbie-stars subbie-stars--gold" title="${s.quality || 0}/5">${stars(s.quality)}</span>
          </div>
          ${s.notes ? `<div class="subbie-notes">${escHtml(s.notes)}</div>` : ''}
          <div class="subbie-actions">
            <button class="subbie-btn subbie-btn--edit" data-edit="${escHtml(s.id)}">Edit</button>
            <button class="subbie-btn subbie-btn--delete" data-delete="${escHtml(s.id)}">Delete</button>
          </div>
        </div>`).join('')}
    </div>`;

  el.querySelectorAll('[data-edit]').forEach(btn =>
    btn.addEventListener('click', () => openSubbieForm(btn.dataset.edit))
  );
  el.querySelectorAll('[data-delete]').forEach(btn =>
    btn.addEventListener('click', () => {
      if (!confirm('Delete this subcontractor?')) return;
      const arr = loadSubbies().filter(s => s.id !== btn.dataset.delete);
      saveSubbies(arr);
      renderSubbiesTab();
      showToast('Subcontractor deleted', 'info', 2000);
    })
  );
}

function openSubbieForm(editId = null) {
  subbieEditId = editId;
  const existing = editId ? loadSubbies().find(s => s.id === editId) : null;
  const v = existing || { name: '', trade: '', dayRate: '', phone: '', jobsWorked: 0, reliability: 3, quality: 3, notes: '' };

  let overlay = document.getElementById('subbieFormOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'subbieFormOverlay';
    overlay.className = 'ai-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = `
    <div class="ai-modal">
      <div class="ai-modal-header">
        <span class="ai-modal-title">${editId ? 'Edit' : 'Add'} Subcontractor</span>
        <button class="btn-modal-close" id="subbieFormClose">&#10005;</button>
      </div>
      <div class="ai-modal-body">
        <div class="subbie-form">
          <div class="subbie-form-row">
            <label class="calc-label">Name *</label>
            <input id="sf_name" class="calc-input" value="${escHtml(v.name)}" placeholder="Full name" />
          </div>
          <div class="subbie-form-row">
            <label class="calc-label">Trade</label>
            <input id="sf_trade" class="calc-input" value="${escHtml(v.trade || '')}" placeholder="e.g. Bricklayer, Plasterer" />
          </div>
          <div class="subbie-form-row">
            <label class="calc-label">Day Rate ($)</label>
            <input id="sf_rate" class="calc-input" type="number" value="${escHtml(String(v.dayRate || ''))}" min="0" />
          </div>
          <div class="subbie-form-row">
            <label class="calc-label">Phone</label>
            <input id="sf_phone" class="calc-input" value="${escHtml(v.phone || '')}" placeholder="04XX XXX XXX" />
          </div>
          <div class="subbie-form-row">
            <label class="calc-label">Jobs Worked</label>
            <input id="sf_jobs" class="calc-input" type="number" value="${escHtml(String(v.jobsWorked || 0))}" min="0" />
          </div>
          <div class="subbie-form-row">
            <label class="calc-label">Reliability (1–5)</label>
            <input id="sf_rely" class="calc-input" type="number" value="${v.reliability || 3}" min="1" max="5" />
          </div>
          <div class="subbie-form-row">
            <label class="calc-label">Quality (1–5)</label>
            <input id="sf_qual" class="calc-input" type="number" value="${v.quality || 3}" min="1" max="5" />
          </div>
          <div class="subbie-form-row">
            <label class="calc-label">Notes</label>
            <textarea id="sf_notes" class="calc-input" rows="2" placeholder="Any notes…">${escHtml(v.notes || '')}</textarea>
          </div>
          <button class="calc-run-btn" id="subbieFormSave">${editId ? 'Save Changes' : 'Add Subcontractor'}</button>
        </div>
      </div>
    </div>`;

  overlay.classList.add('is-open');

  document.getElementById('subbieFormClose')?.addEventListener('click', () => overlay.classList.remove('is-open'));
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('is-open'); });

  document.getElementById('subbieFormSave')?.addEventListener('click', () => {
    const name = document.getElementById('sf_name')?.value.trim();
    if (!name) { showToast('Name is required', 'error'); return; }

    const arr = loadSubbies();
    const entry = {
      id:          editId || ('s' + Date.now()),
      name,
      trade:       document.getElementById('sf_trade')?.value.trim() || '',
      dayRate:     parseFloat(document.getElementById('sf_rate')?.value || 0) || 0,
      phone:       document.getElementById('sf_phone')?.value.trim() || '',
      jobsWorked:  parseInt(document.getElementById('sf_jobs')?.value || 0, 10) || 0,
      reliability: Math.min(5, Math.max(1, parseInt(document.getElementById('sf_rely')?.value || 3, 10))),
      quality:     Math.min(5, Math.max(1, parseInt(document.getElementById('sf_qual')?.value || 3, 10))),
      notes:       document.getElementById('sf_notes')?.value.trim() || '',
    };

    if (editId) {
      const idx = arr.findIndex(s => s.id === editId);
      if (idx !== -1) arr[idx] = entry; else arr.push(entry);
    } else {
      arr.push(entry);
    }

    saveSubbies(arr);
    overlay.classList.remove('is-open');
    renderSubbiesTab();
    showToast(editId ? 'Subcontractor updated' : 'Subcontractor added', 'success', 2000);
  });
}

// Wire up Add Subbie button
(function initSubbies() {
  const btn = document.getElementById('btnAddSubbie');
  if (btn) btn.addEventListener('click', () => openSubbieForm(null));
})();


// ═══════════════════════════════════════════════════════════════════════════════
// FEATURE 9 & 10 — MATERIALS CALCULATOR + BRICK PRICE TRACKER
// ═══════════════════════════════════════════════════════════════════════════════

function renderBrickPriceTracker() {
  const el = document.getElementById('financeBrickPrices');
  if (!el) return;

  const prices = loadBrickPrices();

  el.innerHTML = `
    <div class="brick-prices-wrap">
      <table class="brick-prices-table">
        <thead><tr>
          <th>Material</th>
          <th>Unit</th>
          <th style="text-align:right">Price</th>
          <th>Last Updated</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${prices.map((p, i) => `<tr>
            <td>${escHtml(p.name)}</td>
            <td class="brick-prices-unit">${escHtml(p.unit)}</td>
            <td style="text-align:right" class="brick-prices-price">
              $<input type="number" class="brick-price-input" data-idx="${i}" value="${p.price}" min="0" step="1" />
            </td>
            <td class="brick-prices-date">${p.updated ? new Date(p.updated).toLocaleDateString('en-GB') : '—'}</td>
            <td><button class="brick-price-save-btn" data-save="${i}">&#10003; Update</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  el.querySelectorAll('[data-save]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i   = parseInt(btn.dataset.save, 10);
      const inp = el.querySelector(`[data-idx="${i}"]`);
      const val = parseFloat(inp?.value || 0);
      if (isNaN(val) || val < 0) { showToast('Invalid price', 'error'); return; }
      prices[i].price   = val;
      prices[i].updated = Date.now();
      saveBrickPrices(prices);
      renderBrickPriceTracker();
      showToast(`${prices[i].name} price updated`, 'success', 2000);
    });
  });
}

// ─── Materials Calculator Logic ───────────────────────────────────────────────

const BRICK_CONFIGS = {
  standard: { l: 0.230, h: 0.076, perM2Single: null },  // calculated
  block:    { l: 0.390, h: 0.190, perM2Single: null },
  jumbo:    { l: 0.290, h: 0.090, perM2Single: null },
};

function calcBricksPerM2(type, joint) {
  const cfg = BRICK_CONFIGS[type] || BRICK_CONFIGS.standard;
  const j   = (joint || 10) / 1000;
  return 1 / ((cfg.l + j) * (cfg.h + j));
}

function runMaterialsCalc() {
  const length   = parseFloat(document.getElementById('calcLength')?.value  || 0);
  const height   = parseFloat(document.getElementById('calcHeight')?.value  || 0);
  const thick    = document.getElementById('calcThickness')?.value || 'double';
  const brickType= document.getElementById('calcBrickType')?.value || 'standard';
  const bond     = document.getElementById('calcBond')?.value     || 'stretcher';
  const joint    = parseFloat(document.getElementById('calcJoint')?.value   || 10);
  const openings = parseFloat(document.getElementById('calcOpenings')?.value|| 0);

  if (!length || !height) {
    showToast('Please enter valid dimensions', 'error');
    return;
  }

  const wallArea  = Math.max(0, (length * height) - openings);
  const skins     = thick === 'single' ? 1 : thick === 'block' ? 1 : 2;
  const bondMult  = bond === 'english' ? 1.1 : bond === 'flemish' ? 1.05 : 1.0;
  const perM2     = calcBricksPerM2(brickType, joint);
  const bricksNet = wallArea * perM2 * skins * bondMult;
  const bricksWaste = Math.ceil(bricksNet * 1.10); // +10% wastage

  // Mortar: approx 1 bag per 50 standard bricks (0.02 bags/brick)
  const mortarBags = Math.ceil(bricksWaste * 0.022);

  // Weight: standard brick ≈ 3.5kg, block ≈ 12kg
  const brickWeight = brickType === 'block' ? 12 : brickType === 'jumbo' ? 4.5 : 3.5;
  const totalWeightKg = Math.round(bricksWaste * brickWeight);

  // Cost from price tracker
  const prices = loadBrickPrices();
  const brickPriceEntry = brickType === 'block' ? prices[2] : brickType === 'jumbo' ? prices[0] : prices[0];
  const mortarPriceEntry = prices[3];
  const brickCostPer1000 = brickPriceEntry ? brickPriceEntry.price : 1000;
  const mortarCostPerBag = mortarPriceEntry ? mortarPriceEntry.price : 14;
  const brickCost   = (bricksWaste / 1000) * brickCostPer1000;
  const mortarCost  = mortarBags * mortarCostPerBag;
  const totalCost   = brickCost + mortarCost;

  const resultsEl  = document.getElementById('calcResults');
  const copyBtn    = document.getElementById('btnCopyCalc');
  if (!resultsEl) return;

  const resultText = `
Wall: ${length}m × ${height}m = ${wallArea.toFixed(1)} m² (net)
Bricks required: ${bricksWaste.toLocaleString()} (incl. 10% wastage)
Mortar bags: ${mortarBags}
Total weight: ${(totalWeightKg / 1000).toFixed(1)} tonnes
Estimated brick cost: ${fmtCurrency(brickCost)}
Estimated mortar cost: ${fmtCurrency(mortarCost)}
TOTAL ESTIMATE: ${fmtCurrency(totalCost)}`;

  resultsEl.innerHTML = `
    <div class="calc-result-row"><span>Wall area (net)</span><strong>${wallArea.toFixed(1)} m²</strong></div>
    <div class="calc-result-row"><span>Bricks (+ 10% wastage)</span><strong>${bricksWaste.toLocaleString()}</strong></div>
    <div class="calc-result-row"><span>Mortar bags (40kg)</span><strong>${mortarBags}</strong></div>
    <div class="calc-result-row"><span>Total weight</span><strong>${(totalWeightKg / 1000).toFixed(1)} t</strong></div>
    <div class="calc-result-divider"></div>
    <div class="calc-result-row"><span>Brick cost est.</span><strong>${fmtCurrency(brickCost)}</strong></div>
    <div class="calc-result-row"><span>Mortar cost est.</span><strong>${fmtCurrency(mortarCost)}</strong></div>
    <div class="calc-result-row calc-result-total"><span>TOTAL ESTIMATE</span><strong>${fmtCurrency(totalCost)}</strong></div>`;

  if (copyBtn) {
    copyBtn.hidden = false;
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(resultText).then(
        () => showToast('Quote copied to clipboard!', 'success'),
        () => showToast('Copy failed', 'error')
      );
    };
  }
}

(function initCalculator() {
  const btnOpen  = document.getElementById('btnCalculate');
  const overlay  = document.getElementById('calcOverlay');
  const closeBtn = document.getElementById('calcClose');
  const runBtn   = document.getElementById('btnRunCalc');
  if (!overlay) return;

  if (btnOpen)  btnOpen.addEventListener('click',  () => overlay.classList.add('is-open'));
  if (closeBtn) closeBtn.addEventListener('click', () => overlay.classList.remove('is-open'));
  if (runBtn)   runBtn.addEventListener('click',   runMaterialsCalc);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('is-open'); });
})();


// ═══════════════════════════════════════════════════════════════════════════════
// FEATURE 1 & 4 — AI CHAT ASSISTANT + AI WEEKLY SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════

function buildBusinessContext() {
  const today = new Date().toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const parts = [`Date: ${today}`, `Business: Dynasty Bricklaying & Pressure Cleaning (Australia)`];

  // ── Google Sheets site data ─────────────────────────────────────────────────
  if (currentBySite && currentBySite.size > 0) {
    const completedSet = new Set(loadCompletedSites().map(s => s.name));
    const activeSites  = [...currentBySite.entries()].filter(([n]) => !completedSet.has(n));
    const doneSites    = [...currentBySite.entries()].filter(([n]) =>  completedSet.has(n));

    parts.push(`\nACTIVE SITES (${activeSites.length}):`);
    for (const [site, rows] of activeSites) {
      const latest   = rows[rows.length - 1];
      const total    = latest.calcRunningTotal || rows.reduce((s, r) => s + (r.bricks || 0), 0);
      const weather  = latest.weatherDelay === 'Yes' ? ' [WEATHER DELAY]' : '';
      const problem  = latest.problems ? ` [PROBLEM: ${latest.problems}]` : '';
      const doneNote = latest.doneToday ? ` Done today: ${latest.doneToday}.` : '';
      parts.push(`  • ${site}: ${latest.progress || 0}% complete, ${latest.daysLeft || 0} days left, ${latest.bricks || 0} bricks today (${total.toLocaleString()} total), crew: ${latest.crewName || latest.crew || '?'}${weather}${problem}${doneNote}`);
    }

    if (doneSites.length) {
      parts.push(`\nCOMPLETED SITES: ${doneSites.map(([n]) => n).join(', ')}`);
    }
  } else {
    parts.push('\nSITE DATA: Not yet loaded (user has not refreshed the dashboard).');
  }

  // ── ServiceM8 jobs data ─────────────────────────────────────────────────────
  if (jobsLoaded && activeJobsData.length) {
    const completed  = activeJobsData.filter(j => j.status === 'Completed');
    const unpaid     = completed.filter(j => !isPaid(j));
    const paid       = completed.filter(j =>  isPaid(j));
    const quotes     = activeJobsData.filter(j => j.status === 'Quote');
    const workOrders = activeJobsData.filter(j => j.status === 'Work Order');

    const totalInvoiced = completed.reduce((s, j) => s + parseFloat(j.total_invoice_amount || 0), 0);
    const totalUnpaid   = unpaid.reduce((s, j) => s + parseFloat(j.total_invoice_amount || 0), 0);
    const totalPaid     = paid.reduce((s, j) => s + parseFloat(j.total_invoice_amount || 0), 0);
    const totalQuotes   = quotes.reduce((s, j) => s + parseFloat(j.total_invoice_amount || 0), 0);

    parts.push(`\nSERVICEM8 JOBS SUMMARY:`);
    parts.push(`  Completed jobs: ${completed.length} (${fmtCurrency(totalInvoiced)} invoiced)`);
    parts.push(`  Paid: ${fmtCurrency(totalPaid)} | Outstanding: ${fmtCurrency(totalUnpaid)} (${unpaid.length} unpaid invoices)`);
    parts.push(`  Active work orders: ${workOrders.length}`);
    parts.push(`  Quotes in pipeline: ${quotes.length} (${fmtCurrency(totalQuotes)} potential revenue)`);

    // List unpaid invoices individually (up to 10) so AI can discuss them
    if (unpaid.length) {
      parts.push(`\nUNPAID INVOICES (${unpaid.length} total):`);
      unpaid.slice(0, 10).forEach(j => {
        const client = sm8CompanyMap.get(j.company_uuid || '') || 'Unknown client';
        const amt    = parseFloat(j.total_invoice_amount || 0);
        const desc   = (j.job_description || '').split('\n')[0].trim().slice(0, 60) || 'No description';
        const date   = (j.date || '').substring(0, 10);
        parts.push(`  • ${client} — ${fmtCurrency(amt)} — "${desc}" (${date})`);
      });
      if (unpaid.length > 10) parts.push(`  … and ${unpaid.length - 10} more`);
    }

    // Recent completed jobs
    const recent = completed.slice(0, 5);
    if (recent.length) {
      parts.push(`\nMOST RECENT COMPLETED JOBS:`);
      recent.forEach(j => {
        const client = sm8CompanyMap.get(j.company_uuid || '') || 'Unknown client';
        const amt    = parseFloat(j.total_invoice_amount || 0);
        const desc   = (j.job_description || '').split('\n')[0].trim().slice(0, 60) || 'No description';
        parts.push(`  • ${client} — ${fmtCurrency(amt)} — "${desc}" — ${isPaid(j) ? 'PAID' : 'UNPAID'}`);
      });
    }
  } else {
    parts.push('\nSERVICEM8 DATA: Not yet loaded (user needs to open the Jobs or Finance tab first).');
  }

  return parts.join('\n');
}

const AI_PROXY_URL = '/api/chat';

// context = plain-text business data string; role = 'chat' | 'summary'
async function callClaudeAPI(messages, context, role = 'chat', extras = {}) {
  let res;
  try {
    res = await fetch(AI_PROXY_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ messages, context, role, ...extras }),
    });
  } catch (networkErr) {
    throw new Error('Could not reach AI endpoint — check your connection or Netlify deployment.');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `AI error ${res.status}`);
  }
  return data.text || '(No response)';
}

// ─── AI Chat Panel ────────────────────────────────────────────────────────────

const aiChatHistory = []; // { role: 'user'|'assistant', content: string }

function appendChatMsg(role, text) {
  const msgs = document.getElementById('aiChatMessages');
  if (!msgs) return;
  const div = document.createElement('div');
  div.className = `ai-chat-msg ai-chat-msg--${role === 'user' ? 'user' : 'ai'}`;
  div.innerHTML = `<div class="ai-chat-msg-text">${escHtml(text).replace(/\n/g, '<br>')}</div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

async function sendChatMessage() {
  const inp  = document.getElementById('aiChatInput');
  const sendBtn = document.getElementById('aiChatSend');
  const text = inp?.value.trim();
  if (!text) return;

  inp.value = '';
  appendChatMsg('user', text);
  aiChatHistory.push({ role: 'user', content: text });

  if (sendBtn) sendBtn.disabled = true;
  appendChatMsg('assistant', '…');

  try {
    const context = buildBusinessContext();
    const reply = await callClaudeAPI(aiChatHistory, context);
    aiChatHistory.push({ role: 'assistant', content: reply });

    // Replace the loading message
    const msgs   = document.getElementById('aiChatMessages');
    const last   = msgs?.lastElementChild;
    if (last) last.querySelector('.ai-chat-msg-text').innerHTML = escHtml(reply).replace(/\n/g, '<br>');
  } catch (err) {
    const msgs = document.getElementById('aiChatMessages');
    const last = msgs?.lastElementChild;
    if (last) last.querySelector('.ai-chat-msg-text').textContent = '⚠ ' + err.message;
    aiChatHistory.pop();
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

(function initAIChat() {
  // Open/close is handled by inline onclick on the bubble and close button in HTML.
  // This IIFE only wires the send button and Enter key.
  const sendBtn = document.getElementById('aiChatSend');
  const inp     = document.getElementById('aiChatInput');

  sendBtn?.addEventListener('click', sendChatMessage);
  inp?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } });

  // Click outside the panel closes it
  document.addEventListener('click', e => {
    const panel  = document.getElementById('aiChatPanel');
    const bubble = document.getElementById('aiChatBubble');
    if (!panel || panel.style.display === 'none') return;
    if (!panel.contains(e.target) && !bubble.contains(e.target)) {
      panel.style.display = 'none';
    }
  });
})();

// ─── AI Weekly Summary ────────────────────────────────────────────────────────

async function generateWeeklySummary() {
  const overlay  = document.getElementById('weeklySummaryOverlay');
  const bodyEl   = document.getElementById('weeklySummaryBody');
  if (!overlay || !bodyEl) return;

  overlay.classList.add('is-open');
  bodyEl.innerHTML = '<div class="ai-loading">Generating weekly summary…</div>';

  try {
    const context = buildBusinessContext();
    const prompt  = 'Write a plain-English weekly business summary for Dynasty Bricklaying. Include: overall performance, key sites, revenue/cash position, any risks or problems, and 3 recommended actions for next week. Use clear headings and bullet points.';

    const reply = await callClaudeAPI(
      [{ role: 'user', content: prompt }],
      context,
      'summary'
    );

    bodyEl.innerHTML = `<div class="ai-summary-text">${escHtml(reply).replace(/\n/g, '<br>').replace(/#{1,3} (.+?)(<br>|$)/g, '<strong>$1</strong>$2')}</div>`;

    document.getElementById('btnCopySummary')?.addEventListener('click', () => {
      navigator.clipboard.writeText(reply).then(
        () => showToast('Summary copied!', 'success'),
        () => showToast('Copy failed', 'error')
      );
    }, { once: true });

  } catch (err) {
    bodyEl.innerHTML = `<p class="ai-error">⚠ ${escHtml(err.message)}</p>`;
  }
}

(function initWeeklySummary() {
  const btn      = document.getElementById('btnWeeklySummary');
  const overlay  = document.getElementById('weeklySummaryOverlay');
  const closeBtn = document.getElementById('weeklySummaryClose');
  if (!btn || !overlay) return;

  btn.addEventListener('click', generateWeeklySummary);
  closeBtn?.addEventListener('click', () => overlay.classList.remove('is-open'));
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('is-open'); });
})();




// ═══════════════════════════════════════════════════════════════════════════════
// FEATURE: INVOICE CHASE MODAL
// ═══════════════════════════════════════════════════════════════════════════════

function openChaseModal(job) {
  const clientName = sm8CompanyMap.get(job.company_uuid || '') || 'Client';
  const amount     = parseFloat(job.total_invoice_amount || 0);
  const jobRef     = job.job_number ? `#${job.job_number}` : `#${(job.uuid || '').slice(0, 8).toUpperCase()}`;
  const msg        = `Hi ${clientName}, this is a reminder that invoice ${jobRef} for ${fmtCurrency(amount)} is outstanding. Please arrange payment at your earliest convenience. Thank you — Whittaker Bricklaying`;

  let overlay = document.getElementById('chaseOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'chaseOverlay';
    overlay.className = 'ai-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    document.body.appendChild(overlay);
  }

  const chased = loadChaseLog()[job.uuid];

  overlay.innerHTML = `
    <div class="ai-modal">
      <div class="ai-modal-header">
        <span class="ai-modal-title">&#128394; Chase Invoice</span>
        <button class="btn-modal-close" id="chaseClose">&#10005;</button>
      </div>
      <div class="ai-modal-body">
        <div class="chase-header">
          <div class="chase-client">${escHtml(clientName)}</div>
          <div class="chase-amount">${fmtCurrency(amount)}</div>
        </div>
        ${chased ? `<div class="chase-already-note">&#10003; Previously chased ${Math.floor((Date.now() - chased.ts) / 86400000)} days ago</div>` : ''}
        <label class="calc-label" style="margin-top:0.75rem;display:block">Message (edit as needed):</label>
        <textarea id="chaseMsgText" class="chase-textarea">${escHtml(msg)}</textarea>
        <div class="chase-actions">
          <button class="calc-run-btn" id="btnCopyChaseMsg">&#128203; Copy Message</button>
          <button class="chase-mark-btn" id="btnMarkChased">&#10003; Mark as Chased</button>
        </div>
      </div>
    </div>`;

  overlay.classList.add('is-open');

  document.getElementById('chaseClose')?.addEventListener('click', () => overlay.classList.remove('is-open'));
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('is-open'); });

  document.getElementById('btnCopyChaseMsg')?.addEventListener('click', () => {
    const text = document.getElementById('chaseMsgText')?.value || msg;
    navigator.clipboard.writeText(text).then(
      () => showToast('Message copied!', 'success'),
      () => showToast('Copy failed — select the text manually', 'error')
    );
  });

  document.getElementById('btnMarkChased')?.addEventListener('click', () => {
    const log = loadChaseLog();
    log[job.uuid] = { ts: Date.now(), clientName, amount };
    saveChaseLog(log);
    overlay.classList.remove('is-open');
    applyJobsFilters();
    updateTabBadges(filterByBiz(activeJobsData));
    showToast(`${clientName} marked as chased`, 'success', 2000);
  });
}


// ═══════════════════════════════════════════════════════════════════════════════
// FEATURE: PROFIT INTELLIGENCE (Finance tab)
// ═══════════════════════════════════════════════════════════════════════════════

function renderProfitIntelligence(jobs) {
  const el = document.getElementById('financeProfitIntel');
  if (!el) return;

  const DAILY_RATE = 800; // $/day assumed
  const completed  = jobs.filter(j => j.status === 'Completed' && parseFloat(j.total_invoice_amount || 0) > 0);

  if (!completed.length) {
    el.innerHTML = '<p class="table-empty" style="padding:1rem 0">No completed jobs with invoices yet.</p>';
    return;
  }

  // ── Helper: ranked list HTML ────────────────────────────────────────────────
  function rankedList(rows, title, icon) {
    if (!rows.length) return '';
    return `
      <div class="pi-section">
        <div class="pi-section-title">${icon} ${escHtml(title)}</div>
        <div class="pi-list">
          ${rows.map((r, i) => `
            <div class="pi-row ${i === 0 ? 'pi-row--gold' : ''}">
              <span class="pi-rank">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}</span>
              <span class="pi-label">${escHtml(r.label)}</span>
              <span class="pi-meta">${escHtml(r.meta)}</span>
              <span class="pi-value">${escHtml(r.value)}</span>
            </div>`).join('')}
        </div>
      </div>`;
  }

  // 1. Top 10 most profitable clients (avg invoice value per job)
  const clientMap = new Map();
  for (const j of completed) {
    const client = sm8CompanyMap.get(j.company_uuid || '') || 'Unknown';
    const amt    = parseFloat(j.total_invoice_amount || 0);
    if (!clientMap.has(client)) clientMap.set(client, { total: 0, count: 0 });
    const e = clientMap.get(client);
    e.total += amt; e.count++;
  }
  const topClients = [...clientMap.entries()]
    .map(([label, { total, count }]) => ({
      label,
      meta:  `${count} job${count !== 1 ? 's' : ''}`,
      value: fmtCurrency(total / count) + ' avg',
      avg:   total / count,
    }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 10);

  // 2. Most profitable job types (keyword groups)
  const JOB_KEYWORDS = [
    { key: 'brick veneer',   pat: /brick veneer/i },
    { key: 'double brick',   pat: /double brick/i },
    { key: 'footing',        pat: /footing|footings/i },
    { key: 'fence',          pat: /fence|fencing/i },
    { key: 'pressure clean', pat: /pressure clean|high pressure/i },
    { key: 'block work',     pat: /block work|blockwork|besser/i },
    { key: 'retaining wall', pat: /retaining wall/i },
    { key: 'extension',      pat: /extension|addition/i },
    { key: 'new home',       pat: /new home|new house|new build/i },
    { key: 'repair',         pat: /repair|repoint|tuckpoint/i },
  ];
  const typeMap = new Map();
  for (const j of completed) {
    const desc = (j.job_description || '').toLowerCase();
    const amt  = parseFloat(j.total_invoice_amount || 0);
    let matched = false;
    for (const { key, pat } of JOB_KEYWORDS) {
      if (pat.test(desc)) {
        if (!typeMap.has(key)) typeMap.set(key, { total: 0, count: 0 });
        const e = typeMap.get(key); e.total += amt; e.count++;
        matched = true; break;
      }
    }
    if (!matched) {
      const k = 'Other';
      if (!typeMap.has(k)) typeMap.set(k, { total: 0, count: 0 });
      const e = typeMap.get(k); e.total += amt; e.count++;
    }
  }
  const topTypes = [...typeMap.entries()]
    .map(([label, { total, count }]) => ({
      label: label.replace(/\b\w/g, c => c.toUpperCase()),
      meta:  `${count} job${count !== 1 ? 's' : ''}`,
      value: fmtCurrency(total / count) + ' avg',
      avg:   total / count,
    }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 8);

  // 3. Most profitable suburbs
  function extractSuburb(address) {
    if (!address) return null;
    // "123 Main St, Goulburn NSW 2580" → "Goulburn"
    const parts = address.split(',');
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i].trim();
      // Strip postcode/state
      const m = part.replace(/\b\d{4}\b/, '').replace(/\b(NSW|VIC|QLD|SA|WA|ACT|TAS|NT)\b/i, '').trim();
      if (m.length > 2) return m.replace(/\b\w/g, c => c.toUpperCase());
    }
    return null;
  }
  const suburbMap = new Map();
  for (const j of completed) {
    const suburb = extractSuburb(j.job_address || '');
    if (!suburb) continue;
    const amt = parseFloat(j.total_invoice_amount || 0);
    if (!suburbMap.has(suburb)) suburbMap.set(suburb, { total: 0, count: 0 });
    const e = suburbMap.get(suburb); e.total += amt; e.count++;
  }
  const topSuburbs = [...suburbMap.entries()]
    .map(([label, { total, count }]) => ({
      label,
      meta:  `${count} job${count !== 1 ? 's' : ''}`,
      value: fmtCurrency(total / count) + ' avg',
      avg:   total / count,
    }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 8);

  // 4. Best performing months (total revenue)
  const monthMap = new Map();
  for (const j of completed) {
    const d = new Date((j.date || '').substring(0, 10) + 'T00:00:00');
    if (isNaN(d)) continue;
    const key = d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
    const amt = parseFloat(j.total_invoice_amount || 0);
    if (!monthMap.has(key)) monthMap.set(key, 0);
    monthMap.set(key, monthMap.get(key) + amt);
  }
  const topMonths = [...monthMap.entries()]
    .map(([label, total]) => ({ label, meta: '', value: fmtCurrency(total), total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);

  // 5. Revenue per day on site
  const revPerDay = completed
    .map(j => {
      const amt  = parseFloat(j.total_invoice_amount || 0);
      const days = Math.max(1, Math.round(amt / DAILY_RATE));
      return { label: (j.job_description || 'Unnamed').split('\n')[0].slice(0, 45),
               meta: `~${days} days est.`, value: fmtCurrency(amt / days) + '/day', rpd: amt / days };
    })
    .sort((a, b) => b.rpd - a.rpd)
    .slice(0, 8);

  el.innerHTML = `
    <div class="pi-wrap">
      ${rankedList(topClients, 'Top Clients by Avg Invoice',    '&#128101;')}
      ${rankedList(topTypes,   'Most Profitable Job Types',     '&#127959;')}
      ${rankedList(topSuburbs, 'Most Profitable Suburbs',       '&#128205;')}
      ${rankedList(topMonths,  'Best Revenue Months',           '&#128197;')}
      ${rankedList(revPerDay,  'Best Revenue per Day on Site',  '&#9200;')}
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FEATURE: WAGE & SUPER CALCULATOR (Finance tab — Payroll Estimator)
// ═══════════════════════════════════════════════════════════════════════════════

function renderPayrollCalculator(jobs) {
  const el = document.getElementById('financePayroll');
  if (!el) return;

  el.innerHTML = `
    <div class="payroll-wrap">
      <div class="payroll-inputs">
        <div class="payroll-input-group">
          <label class="calc-label">Crew members</label>
          <input type="number" id="pc_crew"  class="payroll-input" value="3"    min="1"  max="50"  step="1" />
        </div>
        <div class="payroll-input-group">
          <label class="calc-label">Hours this week</label>
          <input type="number" id="pc_hours" class="payroll-input" value="38"   min="0"  max="80"  step="0.5" />
        </div>
        <div class="payroll-input-group">
          <label class="calc-label">Hourly rate ($/hr)</label>
          <input type="number" id="pc_rate"  class="payroll-input" value="45"   min="0"  step="0.50" />
        </div>
        <div class="payroll-input-group">
          <label class="calc-label">Super rate (%)</label>
          <input type="number" id="pc_super" class="payroll-input" value="11.5" min="0"  max="30"  step="0.1" />
        </div>
      </div>
      <div class="payroll-outputs" id="payrollOutputs"></div>
    </div>`;

  function updatePayroll() {
    const crew      = Math.max(0, parseFloat(document.getElementById('pc_crew')?.value  || 3));
    const hours     = Math.max(0, parseFloat(document.getElementById('pc_hours')?.value || 38));
    const rate      = Math.max(0, parseFloat(document.getElementById('pc_rate')?.value  || 45));
    const superPct  = Math.max(0, parseFloat(document.getElementById('pc_super')?.value || 11.5)) / 100;

    const grossWeek     = crew * hours * rate;
    const superWeek     = grossWeek * superPct;
    const totalWeek     = grossWeek + superWeek;
    const totalMonth    = totalWeek * 4.333;
    const totalAnnual   = totalWeek * 52;

    // FYTD revenue for % calculation
    let fytdRevenue = 0;
    if (jobs && jobs.length) {
      const fyMo = 6; // July = month index 6
      const now  = new Date();
      const fyYear = now.getMonth() >= fyMo ? now.getFullYear() : now.getFullYear() - 1;
      const fyStart = new Date(fyYear, fyMo, 1);
      fytdRevenue = jobs
        .filter(j => j.status === 'Completed' && new Date(j.date || 0) >= fyStart)
        .reduce((s, j) => s + parseFloat(j.total_invoice_amount || 0), 0);
    }

    const payrollPct = fytdRevenue > 0
      ? ((totalAnnual / fytdRevenue) * 100).toFixed(1) + '%'
      : '—';

    const row = (label, value, cls = '') =>
      `<div class="payroll-output-row${cls ? ' ' + cls : ''}"><span>${label}</span><strong>${value}</strong></div>`;

    const out = document.getElementById('payrollOutputs');
    if (!out) return;
    out.innerHTML =
      row('Gross wages this week',      fmtCurrency(grossWeek)) +
      row('Super liability this week',  fmtCurrency(superWeek)) +
      row('Total payroll cost (week)',   fmtCurrency(totalWeek),  ' payroll-row--total') +
      row('Estimated monthly payroll',  fmtCurrency(totalMonth)) +
      row('Estimated annual payroll',   fmtCurrency(totalAnnual)) +
      row('% of current FYTD revenue',  payrollPct, fytdRevenue > 0 && (totalAnnual / fytdRevenue) > 0.5 ? ' payroll-row--warn' : '');
  }

  ['pc_crew', 'pc_hours', 'pc_rate', 'pc_super'].forEach(id =>
    document.getElementById(id)?.addEventListener('input', updatePayroll)
  );
  updatePayroll();
}


// ═══════════════════════════════════════════════════════════════════════════════
// FEATURE: AI PLAN READER
// ═══════════════════════════════════════════════════════════════════════════════

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

// Returns sorted unique crew name strings extracted from the Google Sheets data
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

(function initPlanReader() {
  const btnOpen    = document.getElementById('btnReadPlan');
  const overlay    = document.getElementById('planReaderOverlay');
  const closeBtn   = document.getElementById('planReaderClose');
  const dropZone   = document.getElementById('planDropZone');
  const fileInput  = document.getElementById('planFileInput');
  const fileInfo   = document.getElementById('planFileInfo');
  const analyseBtn = document.getElementById('btnAnalysePlan');
  const resultsEl  = document.getElementById('planResults');
  const copyBtn    = document.getElementById('btnCopyPlanQuote');
  if (!overlay) return;

  let currentFile = null;

  btnOpen?.addEventListener('click',  () => overlay.classList.add('is-open'));
  closeBtn?.addEventListener('click', () => overlay.classList.remove('is-open'));
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('is-open'); });

  // Drag-and-drop
  dropZone?.addEventListener('click', () => fileInput?.click());
  dropZone?.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('plan-drop--over'); });
  dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('plan-drop--over'));
  dropZone?.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('plan-drop--over');
    const f = e.dataTransfer.files[0];
    if (f && f.type === 'application/pdf') setFile(f);
    else showToast('Please upload a PDF file', 'error');
  });
  fileInput?.addEventListener('change', () => {
    if (fileInput.files[0]) setFile(fileInput.files[0]);
  });

  function setFile(file) {
    currentFile = file;
    if (fileInfo) {
      fileInfo.hidden = false;
      fileInfo.innerHTML = `&#128196; <strong>${escHtml(file.name)}</strong> &nbsp;(${(file.size / 1024).toFixed(0)} KB)
        <button class="plan-change-btn" id="btnChangePlan">Change file</button>`;
      document.getElementById('btnChangePlan')?.addEventListener('click', () => {
        currentFile = null;
        fileInfo.hidden = true;
        dropZone.hidden = false;
        if (resultsEl) { resultsEl.hidden = true; resultsEl.innerHTML = ''; }
        if (copyBtn)   copyBtn.hidden = true;
        if (analyseBtn) analyseBtn.disabled = true;
        fileInput.value = '';
      });
    }
    if (dropZone) dropZone.hidden = true;
    if (analyseBtn) analyseBtn.disabled = false;
    if (resultsEl)  { resultsEl.hidden = true; resultsEl.innerHTML = ''; }
    if (copyBtn)    copyBtn.hidden = true;
  }

  analyseBtn?.addEventListener('click', async () => {
    if (!currentFile) return;
    analyseBtn.disabled = true;
    analyseBtn.textContent = '⏳ Uploading plan…';
    if (resultsEl) { resultsEl.hidden = false; resultsEl.innerHTML = '<div class="ai-loading">Sending PDF to Dynasty AI for analysis…</div>'; }
    if (copyBtn) copyBtn.hidden = true;

    try {
      // Guard: Netlify function body limit ~6 MB; base64 adds ~33% so cap source at 4 MB
      if (currentFile.size > 4 * 1024 * 1024) {
        throw new Error(
          `PDF is ${(currentFile.size / (1024 * 1024)).toFixed(1)} MB — max allowed is 4 MB. ` +
          'Try reducing the PDF file size (print to PDF at lower quality) and upload again.'
        );
      }

      const base64Pdf = await readFileAsBase64(currentFile);
      const reply     = await callClaudeAPI(
        [{ role: 'user', content: 'Analyse this building plan and provide a complete bricklaying materials and quote estimate.' }],
        null,
        'plan',
        { base64Pdf, pdfName: currentFile.name }
      );

      if (resultsEl) {
        resultsEl.innerHTML =
          `<div class="plan-results-text">${escHtml(reply)
            .replace(/\n/g, '<br>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/#{1,3} (.+?)(<br>|$)/g, '<strong class="plan-heading">$1</strong>$2')
          }</div>`;
      }
      if (copyBtn) {
        copyBtn.hidden = false;
        copyBtn.onclick = () => {
          navigator.clipboard.writeText(reply).then(
            () => showToast('Quote copied to clipboard!', 'success'),
            () => showToast('Copy failed', 'error')
          );
        };
      }

    } catch (err) {
      if (resultsEl) resultsEl.innerHTML = `<p class="ai-error">&#9888; ${escHtml(err.message)}</p>`;
    } finally {
      analyseBtn.disabled = false;
      analyseBtn.textContent = '▶ Analyse Plan';
    }
  });
})();


// ═══════════════════════════════════════════════════════════════════════════════
// FEATURE: COMPLIANCE & SAFETY LOGGER
// ═══════════════════════════════════════════════════════════════════════════════

function renderSafetyTab() {
  const now        = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const data       = loadSafetyData();

  const talksMonth = data.talks.filter(t => new Date(t.date) >= monthStart);
  const incsMonth  = data.incidents.filter(i => new Date(i.date) >= monthStart);

  // Days since last incident
  const sortedInc = [...data.incidents].sort((a, b) => new Date(b.date) - new Date(a.date));
  let daysSinceInc = sortedInc.length === 0 ? '30+' :
    Math.floor((now - new Date(sortedInc[0].date)) / 86400000);

  const kpiEl = document.getElementById('safetyKPIs');
  if (kpiEl) {
    kpiEl.innerHTML = `
      <div class="safety-kpi-grid">
        <div class="safety-kpi">
          <div class="safety-kpi-val">${talksMonth.length}</div>
          <div class="safety-kpi-lbl">Toolbox talks this month</div>
        </div>
        <div class="safety-kpi">
          <div class="safety-kpi-val safety-kpi-val--${incsMonth.length > 0 ? 'warn' : 'ok'}">${incsMonth.length}</div>
          <div class="safety-kpi-lbl">Incidents this month</div>
        </div>
        <div class="safety-kpi">
          <div class="safety-kpi-val safety-kpi-val--ok">${daysSinceInc}</div>
          <div class="safety-kpi-lbl">Days since last incident</div>
        </div>
      </div>`;
  }

  // Toolbox talks list
  const talksEl = document.getElementById('safetyTalks');
  if (talksEl) {
    if (!data.talks.length) {
      talksEl.innerHTML = '<p class="table-empty" style="padding:1rem 0">No toolbox talks logged yet.</p>';
    } else {
      const sorted = [...data.talks].sort((a, b) => new Date(b.date) - new Date(a.date));
      talksEl.innerHTML = `<div class="safety-list">
        ${sorted.map(t => `
          <div class="safety-item safety-item--talk">
            <div class="safety-item-header">
              <span class="safety-item-date">${escHtml(t.date)}</span>
              <span class="safety-item-site">${escHtml(t.site || '—')}</span>
              <span class="safety-item-type">&#128483; Toolbox Talk</span>
              <button class="safety-delete-btn" data-delete-talk="${escHtml(t.id)}">&#10005;</button>
            </div>
            <div class="safety-item-topic"><strong>Topic:</strong> ${escHtml(t.topic || '—')}</div>
            <div class="safety-item-att"><strong>Attendees:</strong> ${escHtml(t.attendees || '—')}</div>
            ${t.signOff ? '<div class="safety-signoff">&#10003; Signed off</div>' : ''}
          </div>`).join('')}
      </div>`;
    }
  }

  // Incidents list
  const incsEl = document.getElementById('safetyIncidents');
  if (incsEl) {
    if (!data.incidents.length) {
      incsEl.innerHTML = '<p class="table-empty" style="padding:1rem 0">No incidents recorded.</p>';
    } else {
      const sorted = [...data.incidents].sort((a, b) => new Date(b.date) - new Date(a.date));
      const typeCls = { 'Near Miss': 'near-miss', 'First Aid': 'first-aid', 'Lost Time': 'lost-time', 'Property Damage': 'prop-dmg' };
      incsEl.innerHTML = `<div class="safety-list">
        ${sorted.map(i => `
          <div class="safety-item safety-item--incident">
            <div class="safety-item-header">
              <span class="safety-item-date">${escHtml(i.date)}</span>
              <span class="safety-item-site">${escHtml(i.site || '—')}</span>
              <span class="safety-inc-badge safety-inc-badge--${typeCls[i.type] || 'near-miss'}">${escHtml(i.type)}</span>
              <button class="safety-delete-btn" data-delete-inc="${escHtml(i.id)}">&#10005;</button>
            </div>
            <div class="safety-item-topic"><strong>Description:</strong> ${escHtml(i.description || '—')}</div>
            ${i.correctiveAction ? `<div class="safety-item-att"><strong>Corrective action:</strong> ${escHtml(i.correctiveAction)}</div>` : ''}
          </div>`).join('')}
      </div>`;
    }
  }

  // Wire delete buttons
  document.querySelectorAll('[data-delete-talk]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Delete this toolbox talk?')) return;
      const d = loadSafetyData();
      d.talks = d.talks.filter(t => t.id !== btn.dataset.deleteTalk);
      saveSafetyData(d);
      renderSafetyTab();
    });
  });
  document.querySelectorAll('[data-delete-inc]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Delete this incident?')) return;
      const d = loadSafetyData();
      d.incidents = d.incidents.filter(i => i.id !== btn.dataset.deleteInc);
      saveSafetyData(d);
      renderSafetyTab();
    });
  });
}

function openSafetyForm(type) {
  // type: 'talk' | 'incident'
  const isTalk = type === 'talk';
  const sites  = currentBySite ? [...currentBySite.keys()] : [];

  let overlay = document.getElementById('safetyFormOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'safetyFormOverlay';
    overlay.className = 'ai-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    document.body.appendChild(overlay);
  }

  const todayStr  = new Date().toISOString().slice(0, 10);
  const siteOpts  = ['', ...sites].map(s => `<option value="${escHtml(s)}">${escHtml(s || '— Select site —')}</option>`).join('');
  const crewNames = getCrewNames();

  // Attendees field: checkboxes from dashboard crew data, or free-text fallback
  const attendeesField = crewNames.length > 0
    ? `<div class="subbie-form-row">
        <label class="calc-label">Attendees</label>
        <div id="sf_att_checks" class="sf-crew-checks">
          ${crewNames.map(n => `<label class="sf-crew-check-lbl"><input type="checkbox" class="sf-att-check" value="${escHtml(n)}" style="accent-color:var(--gold)" /> ${escHtml(n)}</label>`).join('')}
        </div>
        <input id="sf_att_extra" class="calc-input" style="margin-top:0.4rem" placeholder="Additional attendees (comma separated, optional)" />
      </div>`
    : `<div class="subbie-form-row"><label class="calc-label">Attendees (comma separated)</label>
        <input id="sf_att" class="calc-input" placeholder="Henry, Tommy, Jhy" /></div>`;

  overlay.innerHTML = isTalk ? `
    <div class="ai-modal">
      <div class="ai-modal-header">
        <span class="ai-modal-title">&#128483; Log Toolbox Talk</span>
        <button class="btn-modal-close" id="sfClose">&#10005;</button>
      </div>
      <div class="ai-modal-body">
        <div class="subbie-form">
          <div class="subbie-form-row"><label class="calc-label">Date</label>
            <input id="sf_date" class="calc-input" type="date" value="${todayStr}" /></div>
          <div class="subbie-form-row"><label class="calc-label">Site</label>
            <select id="sf_site" class="calc-input">${siteOpts}</select></div>
          <div class="subbie-form-row"><label class="calc-label">Topic discussed *</label>
            <input id="sf_topic" class="calc-input" placeholder="e.g. Working at heights, PPE, Manual handling" /></div>
          ${attendeesField}
          <div class="subbie-form-row" style="flex-direction:row;align-items:center;gap:0.5rem">
            <input type="checkbox" id="sf_signoff" style="width:auto;accent-color:var(--gold)" />
            <label for="sf_signoff" class="calc-label" style="margin:0">I confirm this toolbox talk was conducted</label>
          </div>
          <button class="calc-run-btn" id="sfSave">Save Talk</button>
        </div>
      </div>
    </div>` : `
    <div class="ai-modal">
      <div class="ai-modal-header">
        <span class="ai-modal-title">&#9888; Log Incident</span>
        <button class="btn-modal-close" id="sfClose">&#10005;</button>
      </div>
      <div class="ai-modal-body">
        <div class="subbie-form">
          <div class="subbie-form-row"><label class="calc-label">Date</label>
            <input id="sf_date" class="calc-input" type="date" value="${todayStr}" /></div>
          <div class="subbie-form-row"><label class="calc-label">Site</label>
            <select id="sf_site" class="calc-input">${siteOpts}</select></div>
          <div class="subbie-form-row"><label class="calc-label">Incident type *</label>
            <select id="sf_inctype" class="calc-input">
              <option>Near Miss</option><option>First Aid</option>
              <option>Lost Time</option><option>Property Damage</option>
            </select></div>
          <div class="subbie-form-row"><label class="calc-label">Description *</label>
            <textarea id="sf_desc" class="calc-input" rows="3" placeholder="What happened?"></textarea></div>
          <div class="subbie-form-row"><label class="calc-label">Corrective action taken</label>
            <textarea id="sf_action" class="calc-input" rows="2" placeholder="What was done to prevent recurrence?"></textarea></div>
          <button class="calc-run-btn" id="sfSave">Save Incident</button>
        </div>
      </div>
    </div>`;

  overlay.classList.add('is-open');

  document.getElementById('sfClose')?.addEventListener('click', () => overlay.classList.remove('is-open'));
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('is-open'); });

  document.getElementById('sfSave')?.addEventListener('click', () => {
    const d = loadSafetyData();

    if (isTalk) {
      const topic = document.getElementById('sf_topic')?.value.trim();
      if (!topic) { showToast('Topic is required', 'error'); return; }
      // Attendees: from checkboxes (if rendered) + optional extra free-text field
      const checked = [...document.querySelectorAll('.sf-att-check:checked')].map(c => c.value);
      const extra   = (document.getElementById('sf_att_extra')?.value || document.getElementById('sf_att')?.value || '').trim();
      const attendeesList = [...checked, ...extra.split(',').map(s => s.trim()).filter(Boolean)];
      d.talks.push({
        id:        'tk_' + Date.now(),
        date:      document.getElementById('sf_date')?.value || todayStr,
        site:      document.getElementById('sf_site')?.value || '',
        topic,
        attendees: attendeesList.join(', '),
        signOff:   document.getElementById('sf_signoff')?.checked || false,
      });
    } else {
      const desc = document.getElementById('sf_desc')?.value.trim();
      if (!desc) { showToast('Description is required', 'error'); return; }
      d.incidents.push({
        id:              'inc_' + Date.now(),
        date:            document.getElementById('sf_date')?.value || todayStr,
        site:            document.getElementById('sf_site')?.value || '',
        type:            document.getElementById('sf_inctype')?.value || 'Near Miss',
        description:     desc,
        correctiveAction: document.getElementById('sf_action')?.value.trim() || '',
      });
    }

    saveSafetyData(d);
    overlay.classList.remove('is-open');
    renderSafetyTab();
    showToast(isTalk ? 'Toolbox talk saved' : 'Incident logged', 'success', 2000);
  });
}

function exportSafetyReport() {
  const data      = loadSafetyData();
  const now       = new Date();
  const monthName = now.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
  const monthStart= new Date(now.getFullYear(), now.getMonth(), 1);

  const talksMonth = data.talks.filter(t => new Date(t.date) >= monthStart);
  const incsMonth  = data.incidents.filter(i => new Date(i.date) >= monthStart);
  const sortedInc  = [...data.incidents].sort((a, b) => new Date(b.date) - new Date(a.date));
  const daysSince  = sortedInc.length === 0 ? '30+' :
    Math.floor((now - new Date(sortedInc[0].date)) / 86400000);

  let report = `DYNASTY BRICKLAYING — SAFETY & COMPLIANCE REPORT\n`;
  report    += `Period: ${monthName}\n`;
  report    += `Generated: ${now.toLocaleDateString('en-AU')}\n`;
  report    += `${'─'.repeat(50)}\n\n`;
  report    += `SUMMARY\n`;
  report    += `Toolbox talks this month: ${talksMonth.length}\n`;
  report    += `Incidents this month: ${incsMonth.length}\n`;
  report    += `Days since last incident: ${daysSince}\n\n`;

  report += `${'─'.repeat(50)}\nTOOLBOX TALKS (${talksMonth.length})\n\n`;
  if (talksMonth.length === 0) {
    report += 'No toolbox talks recorded this month.\n\n';
  } else {
    talksMonth.forEach(t => {
      report += `Date: ${t.date}  |  Site: ${t.site || 'Not specified'}\n`;
      report += `Topic: ${t.topic}\n`;
      report += `Attendees: ${t.attendees || 'Not recorded'}\n`;
      report += `Signed off: ${t.signOff ? 'Yes' : 'No'}\n\n`;
    });
  }

  report += `${'─'.repeat(50)}\nINCIDENT LOG (${incsMonth.length})\n\n`;
  if (incsMonth.length === 0) {
    report += 'No incidents recorded this month.\n\n';
  } else {
    incsMonth.forEach(i => {
      report += `Date: ${i.date}  |  Site: ${i.site || 'Not specified'}  |  Type: ${i.type}\n`;
      report += `Description: ${i.description}\n`;
      if (i.correctiveAction) report += `Corrective action: ${i.correctiveAction}\n`;
      report += '\n';
    });
  }

  report += `${'─'.repeat(50)}\nEnd of report\n`;

  navigator.clipboard.writeText(report).then(
    () => showToast('Safety report copied to clipboard!', 'success', 3000),
    () => showToast('Could not copy — try a different browser', 'error')
  );
}

(function initSafetyButtons() {
  document.getElementById('btnLogTalk')?.addEventListener('click',     () => openSafetyForm('talk'));
  document.getElementById('btnLogIncident')?.addEventListener('click', () => openSafetyForm('incident'));
  document.getElementById('btnExportSafety')?.addEventListener('click', exportSafetyReport);
})();


// ─── Start ────────────────────────────────────────────────────────────────────
_initModalOverlayClick();
loadSheet();
