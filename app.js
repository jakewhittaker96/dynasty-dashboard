/* =============================================
   DYNASTY DASHBOARD — app.js
   Multi-site Google Sheets integration
   ============================================= */

'use strict';

// ─── Sheet URL ────────────────────────────────────────────────────────────────
const SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vTvsSIicwnMasEr8OQIilHtmjC0PAAgGh4WHxB3yJMNPv8feICE5MM97xFz6G0OTkpjWs7EZheqtB8G/pub?output=csv';

const CORS_PROXY = 'https://api.allorigins.win/raw?url=';

// Column mapping (0-indexed):
// A[0]=Timestamp, B[1]=Date, C[2]=Job Site, D[3]=Crew, E[4]=Bricks Today,
// F[5]=Running Total, G[6]=Progress%, H[7]=Est Days, I[8]=Done Today,
// J[9]=Problems, K[10]=Materials Tomorrow, L[11]=Boss Note

// ─── Module state ─────────────────────────────────────────────────────────────
let chartBricks   = null;
let chartProgress = null;
let chartCrew     = null;
let currentBySite = null; // Map<siteName, rows[]>
let activeTab     = '__all__';

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const dom = {
  btnRefresh:      $('btnRefresh'),
  lastUpdated:     $('lastUpdated'),
  tabBar:          $('tabBar'),
  // Views
  viewAll:         $('viewAll'),
  viewSite:        $('viewSite'),
  // All Jobs KPIs
  ovTotalBricks:   $('ovTotalBricks'),
  ovTotalCrew:     $('ovTotalCrew'),
  ovActiveSites:   $('ovActiveSites'),
  ovTotalProblems: $('ovTotalProblems'),
  ovProblemsCard:  $('ovProblemsCard'),
  siteCardsGrid:   $('siteCardsGrid'),
  weeklySummary:   $('weeklySummary'),
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

function formatDateShort(dateStr) {
  if (!dateStr) return '—';
  try {
    let d;
    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(dateStr)) {
      const [day, month, year] = dateStr.split('/');
      d = new Date(`${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}T12:00:00`);
    } else {
      d = new Date(dateStr + (dateStr.includes('T') ? '' : 'T12:00:00'));
    }
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  } catch { return dateStr; }
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
function parseDate(dateStr) {
  if (!dateStr) return null;
  try {
    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(dateStr)) {
      const [day, month, year] = dateStr.split('/');
      const d = new Date(`${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}T12:00:00`);
      return isNaN(d) ? null : d;
    }
    const d = new Date(dateStr + (dateStr.includes('T') ? '' : 'T12:00:00'));
    return isNaN(d) ? null : d;
  } catch { return null; }
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
  // 1. Try direct — works when served from a real web server
  try {
    console.log('[Dynasty] Trying direct fetch…');
    const res = await fetch(SHEET_CSV_URL);
    if (res.ok) {
      console.log('[Dynasty] Direct fetch succeeded.');
      return res.text();
    }
    console.warn(`[Dynasty] Direct fetch returned HTTP ${res.status} — falling back to proxy.`);
  } catch (err) {
    console.warn('[Dynasty] Direct fetch threw (likely CORS on file://):', err.message, '— falling back to proxy.');
  }

  // 2. Fall back to CORS proxy (needed when opening as a local file)
  const proxyUrl = CORS_PROXY + encodeURIComponent(SHEET_CSV_URL);
  console.log('[Dynasty] Fetching via proxy:', proxyUrl);
  const res = await fetch(proxyUrl);
  if (!res.ok) throw new Error(`Proxy fetch failed: HTTP ${res.status}`);
  console.log('[Dynasty] Proxy fetch succeeded.');
  return res.text();
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
  return lines.slice(1).map(line => {
    const c = splitCSVLine(line);
    return {
      timestamp:    c[0]  || '',
      date:         c[1]  || '',
      jobSite:      c[2]  || '',
      crew:         parseFloat(c[3])  || 0,
      bricks:       parseFloat(c[4])  || 0,
      runningTotal: parseFloat(c[5])  || 0,
      progress:     parseFloat(c[6])  || 0,
      daysLeft:     parseFloat(c[7])  || 0,
      doneToday:    c[8]  || '',
      problems:     c[9]  || '',
      materials:    c[10] || '',
      bossNote:     c[11] || '',
    };
  }).filter(r => r.date || r.timestamp);
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
  return map;
}

// ─── Tab management ───────────────────────────────────────────────────────────
function buildTabs(bySite) {
  dom.tabBar.innerHTML = '';

  const makeTab = (key, label, count) => {
    const btn = document.createElement('button');
    btn.className = 'tab' + (key === activeTab ? ' tab--active' : '');
    btn.dataset.site = key;
    btn.innerHTML = escHtml(label) +
      (count != null ? `<span class="tab-count">${count}</span>` : '');
    btn.addEventListener('click', () => switchTab(key));
    dom.tabBar.appendChild(btn);
  };

  makeTab('__all__', 'All Jobs', bySite.size);
  for (const [site, rows] of bySite) {
    const latest = rows[rows.length - 1];
    // Show a red dot on the tab if the latest entry has a problem
    const hasProb = latest.problems && latest.problems.trim();
    const btn = document.createElement('button');
    btn.className = 'tab' + (site === activeTab ? ' tab--active' : '');
    btn.dataset.site = site;
    btn.innerHTML = escHtml(site) +
      (hasProb ? '<span class="tab-dot tab-dot--problem"></span>' : '');
    btn.addEventListener('click', () => switchTab(site));
    dom.tabBar.appendChild(btn);
  }
}

function switchTab(siteKey) {
  activeTab = siteKey;
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('tab--active', t.dataset.site === siteKey);
  });

  if (siteKey === '__all__') {
    dom.viewAll.hidden = false;
    dom.viewSite.hidden = true;
    renderAllJobs(currentBySite);
  } else {
    dom.viewAll.hidden = true;
    dom.viewSite.hidden = false;
    renderSite(currentBySite.get(siteKey), siteKey);
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

  // Prefer the running total from the latest row; fall back to summing daily bricks
  const latest      = rows[rows.length - 1];
  const totalBricks = latest.runningTotal || rows.reduce((s, r) => s + (r.bricks || 0), 0);

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

// ─── All Jobs overview ────────────────────────────────────────────────────────
function renderAllJobs(bySite) {
  let totalBricks   = 0;
  let totalCrew     = 0;
  let totalProblems = 0;

  for (const [, rows] of bySite) {
    const latest = rows[rows.length - 1];
    totalBricks   += latest.bricks || 0;
    totalCrew     += latest.crew   || 0;
    totalProblems += rows.filter(r => r.problems && r.problems.trim()).length;
  }

  dom.ovTotalBricks.textContent   = totalBricks.toLocaleString();
  dom.ovTotalCrew.textContent     = totalCrew;
  dom.ovActiveSites.textContent   = bySite.size;
  dom.ovTotalProblems.textContent = totalProblems || '0';

  if (totalProblems > 0) dom.ovProblemsCard.classList.add('has-problems');
  else                   dom.ovProblemsCard.classList.remove('has-problems');

  // Site summary cards
  const cards = [...bySite.entries()].map(([siteName, rows]) => {
    const latest     = rows[rows.length - 1];
    const problems   = rows.filter(r => r.problems && r.problems.trim());
    const latestProb = problems.length ? problems[problems.length - 1].problems : null;
    const latestMats = [...rows].reverse().find(r => r.materials && r.materials.trim());
    const latestDone = [...rows].reverse().find(r => r.doneToday && r.doneToday.trim());
    const prog       = Math.min(100, Math.max(0, latest.progress || 0));
    const hasProb    = latest.problems && latest.problems.trim();

    return `
      <div class="site-card" data-site="${escHtml(siteName)}" role="button" tabindex="0"
           aria-label="View ${escHtml(siteName)} details">
        <div class="site-card-header">
          <span class="site-card-name">${escHtml(siteName)}</span>
          ${hasProb
            ? `<span class="site-card-badge site-card-badge--problem">&#9888; Problem</span>`
            : `<span class="site-card-badge site-card-badge--ok">&#10003; On track</span>`}
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
            <div class="site-card-stat-value">${latest.crew || '—'}</div>
            <div class="site-card-stat-label">Crew</div>
          </div>
          <div class="site-card-stat">
            <div class="site-card-stat-value">${latest.daysLeft || '—'}</div>
            <div class="site-card-stat-label">Days left</div>
          </div>
        </div>

        ${latestDone
          ? `<div class="site-card-done">&#10003; ${escHtml(latestDone.doneToday)}</div>`
          : ''}
        ${latestProb
          ? `<div class="site-card-problem">&#9888; ${escHtml(latestProb)}</div>`
          : ''}
        ${latestMats
          ? `<div class="site-card-materials">&#128230; ${escHtml(latestMats.materials)}</div>`
          : ''}
      </div>`;
  });

  dom.siteCardsGrid.innerHTML = cards.join('');

  renderWeeklySummary(bySite);

  // Click / keyboard nav on site cards → jump to that site's tab
  dom.siteCardsGrid.querySelectorAll('.site-card').forEach(card => {
    const go = () => switchTab(card.dataset.site);
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

  if (chartBricks)   chartBricks.destroy();
  if (chartProgress) chartProgress.destroy();
  if (chartCrew)     chartCrew.destroy();

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
  dom.kpiTotal.textContent    = latest.runningTotal ? latest.runningTotal.toLocaleString() : '—';
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
    const isLatest = i === 0;
    const hasProb  = r.problems && r.problems.trim();
    const prog     = Math.min(100, r.progress || 0);
    return `<tr class="${isLatest ? 'row-latest' : ''} ${hasProb ? 'row-problem' : ''}">
      <td>${formatDateShort(r.date)}</td>
      <td>${r.bricks ? r.bricks.toLocaleString() : '—'}</td>
      <td>${r.runningTotal ? r.runningTotal.toLocaleString() : '—'}</td>
      <td>${r.crew || '—'}</td>
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

  // If the previously active tab no longer exists, fall back to All Jobs
  if (activeTab !== '__all__' && !currentBySite.has(activeTab)) {
    activeTab = '__all__';
  }
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
  if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
    e.preventDefault();
    loadSheet();
  }
});

setInterval(loadSheet, 5 * 60 * 1000);

// ─── Start ────────────────────────────────────────────────────────────────────
loadSheet();
