'use strict';

// ── Builder / Risk / Client Health / Cash Flow — extracted from app.js ─────────
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

