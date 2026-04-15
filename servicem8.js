'use strict';

// ── ServiceM8 section — extracted from app.js ──────────────────────────────
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

