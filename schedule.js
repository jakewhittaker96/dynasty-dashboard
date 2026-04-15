'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEDULE TAB — Weekly Calendar with SM8 integration
// ═══════════════════════════════════════════════════════════════════════════════

// ── localStorage helpers ──────────────────────────────────────────────────────
function loadSchedJobs()  { try { return JSON.parse(localStorage.getItem('dynasty-sched-jobs') || '[]'); } catch { return []; } }
function saveSchedJobs(a) { localStorage.setItem('dynasty-sched-jobs', JSON.stringify(a)); }
function loadSchedCrew()  { try { return JSON.parse(localStorage.getItem('dynasty-sched-crew') || '[]'); } catch { return []; } }
function saveSchedCrew(a) { localStorage.setItem('dynasty-sched-crew', JSON.stringify(a)); }

// ── SM8 state for schedule tab ────────────────────────────────────────────────
let schedSM8Loaded      = false;   // true once fetch attempted
let schedSM8Jobs        = [];      // active Work Order + Quote jobs
let schedSM8Activities  = [];      // all jobactivity records
let schedSM8CompanyMap  = new Map(); // uuid → company name

// ── Date helpers ──────────────────────────────────────────────────────────────
function schedDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function schedAddDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return schedDateStr(d);
}

function schedFmtDate(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

function schedMonWeek(dateStr) {
  const d   = new Date(dateStr + 'T12:00:00');
  const dow = d.getDay(); // 0=Sun
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return schedDateStr(d);
}

// ── State ─────────────────────────────────────────────────────────────────────
let schedWeekStart = schedMonWeek(schedDateStr(new Date()));

// ── Fetch SM8 data for schedule ───────────────────────────────────────────────
async function loadSchedSM8() {
  // Reuse already-loaded SM8 data from the Jobs/Finance tab if available
  if (typeof jobsLoaded !== 'undefined' && jobsLoaded && activeJobsData && activeJobsData.length) {
    schedSM8Jobs       = activeJobsData.filter(j => j.status === 'Work Order' || j.status === 'Quote');
    schedSM8Activities = (typeof sm8Activities !== 'undefined' && sm8Activities) ? sm8Activities : [];
    schedSM8CompanyMap = (typeof sm8CompanyMap !== 'undefined') ? sm8CompanyMap : new Map();
    schedSM8Loaded = true;
    return;
  }

  // Independent fetch (Jobs tab not yet opened)
  try {
    const [jobsRes, actsRes, coRes] = await Promise.allSettled([
      fetchSM8('job.json'),
      fetchSM8('jobactivity.json'),
      fetchSM8('company.json'),
    ]);

    if (jobsRes.status === 'fulfilled') {
      schedSM8Jobs = jobsRes.value
        .filter(j => j.active === 1 && (j.status === 'Work Order' || j.status === 'Quote'));
    }
    if (actsRes.status === 'fulfilled') {
      schedSM8Activities = actsRes.value;
      console.log('[Schedule] SM8 activities loaded:', schedSM8Activities.length);
    }
    if (coRes.status === 'fulfilled') {
      schedSM8CompanyMap = new Map();
      for (const co of coRes.value) {
        if (co.uuid) schedSM8CompanyMap.set(co.uuid, co.name || co.company_name || '');
      }
    }
  } catch (err) {
    console.warn('[Schedule] SM8 fetch failed:', err.message);
  }
  schedSM8Loaded = true;
}

// ── Build SM8 card data keyed by date ─────────────────────────────────────────
// Returns Map<YYYY-MM-DD, [{uuid, client, desc, addr, amt, status, time}]>
function buildSM8CardsByDate() {
  const byDate  = new Map();
  const jobMap  = new Map(schedSM8Jobs.map(j => [j.uuid, j]));
  const seen    = new Set(); // uuid+date to avoid duplicate cards for same job/day

  const push = (date, card) => {
    const key = `${card.uuid}::${date}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(card);
  };

  const makeCard = (job, timeStr) => ({
    uuid:   job.uuid,
    client: schedSM8CompanyMap.get(job.company_uuid || '') || '—',
    desc:   (job.job_description || '').split('\n')[0].trim().slice(0, 55) || 'No description',
    addr:   (job.job_address || '').trim().slice(0, 45) || '',
    amt:    parseFloat(job.total_invoice_amount || 0),
    status: job.status,
    time:   timeStr || '',
  });

  // 1. Place jobs that have scheduled activity records
  const jobsWithActivity = new Set();
  for (const act of schedSM8Activities) {
    if (!act.job_uuid || !act.date) continue;
    const job = jobMap.get(act.job_uuid);
    if (!job) continue;
    const date = (act.date || '').substring(0, 10);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const timeStr = act.start_time ? act.start_time.substring(0, 5) : '';
    push(date, makeCard(job, timeStr));
    jobsWithActivity.add(job.uuid);
  }

  // 2. Fallback: jobs with no activity entries → use job.date field
  for (const job of schedSM8Jobs) {
    if (jobsWithActivity.has(job.uuid)) continue;
    const raw  = (job.date || '').substring(0, 10);
    if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) continue;
    push(raw, makeCard(job, ''));
  }

  return byDate;
}

// ── Main render ───────────────────────────────────────────────────────────────
async function renderScheduleTab() {
  const container = document.getElementById('viewSchedule');
  if (!container) return;

  // Fetch SM8 on first visit
  if (!schedSM8Loaded) {
    container.innerHTML = '<div class="scal-loading">&#128197; Loading schedule from ServiceM8…</div>';
    await loadSchedSM8();
  }

  const manualJobs = loadSchedJobs();
  const sm8ByDate  = buildSM8CardsByDate();
  const today      = schedDateStr(new Date());

  // Week days Mon–Sun
  const days = Array.from({ length: 7 }, (_, i) => schedAddDays(schedWeekStart, i));
  const weekEnd = days[6];
  const weekLabel = `${new Date(schedWeekStart + 'T12:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} – ${new Date(weekEnd + 'T12:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  const sm8TotalThisWeek = days.reduce((n, d) => n + (sm8ByDate.get(d)?.length || 0), 0);
  const sm8Badge = schedSM8Loaded
    ? `<span class="scal-sm8-badge" title="${sm8TotalThisWeek} SM8 job${sm8TotalThisWeek !== 1 ? 's' : ''} this week">&#9679; SM8 ${sm8TotalThisWeek > 0 ? `(${sm8TotalThisWeek})` : 'connected'}</span>`
    : '';

  const colsHtml = days.map(date => {
    const isToday  = date === today;
    const dayName  = new Date(date + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'short' });
    const dayNum   = new Date(date + 'T12:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });

    // SM8 job cards (read-only)
    const sm8Cards = (sm8ByDate.get(date) || []).map(j => {
      const color  = j.status === 'Quote' ? '#c9a84c' : '#4c8bc9';
      const badge  = `<span class="scal-sm8-card-badge scal-sm8-card-badge--${j.status === 'Quote' ? 'quote' : 'wo'}">${j.status === 'Quote' ? 'Quote' : 'Work Order'}</span>`;
      const time   = j.time ? `<div class="scal-card-time">&#128336; ${escHtml(j.time)}</div>` : '';
      const addr   = j.addr ? `<div class="scal-card-addr">&#128205; ${escHtml(j.addr)}</div>` : '';
      const amt    = j.amt > 0 ? `<div class="scal-card-amt">${fmtCurrency(j.amt)}</div>` : '';
      return `
        <div class="scal-card scal-card--sm8" style="border-left-color:${color}" title="${escHtml(j.client)} — ${escHtml(j.desc)}">
          <div class="scal-card-sm8-header">${badge}${amt}</div>
          <div class="scal-card-title">${escHtml(j.client)}</div>
          <div class="scal-card-desc">${escHtml(j.desc)}</div>
          ${addr}${time}
        </div>`;
    }).join('');

    // Manual job cards (editable)
    const manualCards = manualJobs.filter(j => {
      const s = j.startDate, e = j.endDate || s;
      return date >= s && date <= e;
    }).map(j => {
      const color = schedJobColor(j);
      const crew  = j.crew ? `<div class="scal-card-crew">&#128119; ${escHtml(j.crew)}</div>` : '';
      const note  = j.note ? `<div class="scal-card-note">${escHtml(j.note)}</div>` : '';
      const multi = j.endDate && j.endDate !== j.startDate
        ? `<div class="scal-card-multi">${schedFmtDate(j.startDate)} → ${schedFmtDate(j.endDate)}</div>` : '';
      return `
        <div class="scal-card scal-card--manual" style="border-left-color:${color}" onclick="openSchedJobForm('${escHtml(j.id)}')">
          <div class="scal-card-title">${escHtml(j.site || 'Job')}</div>
          ${crew}${note}${multi}
          <button class="scal-card-del" title="Delete" onclick="event.stopPropagation();deleteSchedJob('${escHtml(j.id)}')">&#10005;</button>
        </div>`;
    }).join('');

    return `
      <div class="scal-col${isToday ? ' scal-col--today' : ''}">
        <div class="scal-col-header">
          <span class="scal-day-name">${dayName}</span>
          <span class="scal-day-date">${dayNum}</span>
          ${isToday ? '<span class="scal-today-badge">Today</span>' : ''}
        </div>
        <div class="scal-col-body">
          ${sm8Cards}${manualCards}
          <button class="scal-add-btn" onclick="openSchedJobForm(null,'${date}')">+ Add</button>
        </div>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="scal-wrap">
      <div class="scal-toolbar">
        <button class="scal-nav-btn" onclick="schedNavWeek(-1)">&#9664; Prev</button>
        <span class="scal-week-label">${weekLabel}</span>
        <button class="scal-nav-btn" onclick="schedNavWeek(1)">Next &#9654;</button>
        <button class="scal-today-btn" onclick="schedGoToday()">Today</button>
        ${sm8Badge}
        <button class="scal-refresh-btn" onclick="schedRefreshSM8()" title="Re-fetch from ServiceM8">&#8635; Refresh SM8</button>
        <button class="scal-add-all-btn" onclick="openSchedJobForm(null,null)">+ New Job</button>
        <button class="scal-crew-btn" onclick="openSchedCrewSettings()">&#128101; Crew</button>
      </div>
      <div class="scal-legend">
        <span class="scal-legend-item scal-legend-item--wo">&#9679; Work Order</span>
        <span class="scal-legend-item scal-legend-item--quote">&#9679; Quote</span>
        <span class="scal-legend-item scal-legend-item--manual">&#9679; Manual</span>
      </div>
      <div class="scal-grid">
        ${colsHtml}
      </div>
    </div>`;
}

// ── Refresh SM8 data ──────────────────────────────────────────────────────────
window.schedRefreshSM8 = async function() {
  schedSM8Loaded = false;
  schedSM8Jobs   = [];
  schedSM8Activities = [];
  await renderScheduleTab();
  showToast('Schedule refreshed from ServiceM8', 'success', 2000);
};

// ── Navigation ────────────────────────────────────────────────────────────────
function schedNavWeek(dir) {
  schedWeekStart = schedAddDays(schedWeekStart, dir * 7);
  renderScheduleTab();
}

function schedGoToday() {
  schedWeekStart = schedMonWeek(schedDateStr(new Date()));
  renderScheduleTab();
}

// ── Job colour for manual cards ───────────────────────────────────────────────
function schedJobColor(job) {
  const palette = ['#c9a84c','#4c8bc9','#4cc97a','#c94c4c','#9b4cc9','#c9874c','#4cc9c9'];
  let h = 0;
  for (const ch of (job.site || '')) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return palette[Math.abs(h) % palette.length];
}

// ── Job form (add / edit manual jobs) ────────────────────────────────────────
function openSchedJobForm(editId, defaultDate) {
  const jobs     = loadSchedJobs();
  const existing = editId ? jobs.find(j => j.id === editId) : null;
  const crew     = loadSchedCrew();

  let overlay = document.getElementById('schedJobOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'schedJobOverlay';
    overlay.className = 'ai-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    document.body.appendChild(overlay);
  }

  const todayStr = defaultDate || schedDateStr(new Date());
  const v = existing || { site: '', note: '', crew: '', startDate: todayStr, endDate: todayStr };

  const siteOpts = currentBySite
    ? ['', ...[...currentBySite.keys()]].map(s =>
        `<option value="${escHtml(s)}"${(v.site || '') === s ? ' selected' : ''}>${escHtml(s || '— Select site —')}</option>`
      ).join('')
    : '<option value="">— Select site —</option>';

  const crewOpts = crew.length
    ? `<div class="sf-crew-checks">${crew.map(n => `<label class="sf-crew-check-lbl"><input type="checkbox" class="sched-crew-check" value="${escHtml(n)}"${(v.crew || '').includes(n) ? ' checked' : ''} style="accent-color:var(--gold)"> ${escHtml(n)}</label>`).join('')}</div><input id="sj_crew_extra" class="calc-input" style="margin-top:0.4rem" placeholder="Other crew (optional)" value="${escHtml((v.crew || '').split(',').map(s=>s.trim()).filter(n => !crew.includes(n)).join(', '))}" />`
    : `<input id="sj_crew" class="calc-input" placeholder="e.g. Henry, Tommy" value="${escHtml(v.crew || '')}" />`;

  overlay.innerHTML = `
    <div class="ai-modal">
      <div class="ai-modal-header">
        <span class="ai-modal-title">${editId ? 'Edit Job' : 'Add Job to Schedule'}</span>
        <button class="btn-modal-close" id="sjClose">&#10005;</button>
      </div>
      <div class="ai-modal-body">
        <div class="subbie-form">
          <div class="subbie-form-row">
            <label class="calc-label">Site *</label>
            <select id="sj_site" class="calc-input">${siteOpts}</select>
            <input id="sj_site_custom" class="calc-input" style="margin-top:0.35rem" placeholder="Or type a custom site name…" value="${escHtml(currentBySite && [...currentBySite.keys()].includes(v.site) ? '' : v.site || '')}" />
          </div>
          <div class="subbie-form-row">
            <label class="calc-label">Start Date</label>
            <input id="sj_start" class="calc-input" type="date" value="${escHtml(v.startDate || todayStr)}" />
          </div>
          <div class="subbie-form-row">
            <label class="calc-label">End Date</label>
            <input id="sj_end" class="calc-input" type="date" value="${escHtml(v.endDate || todayStr)}" />
          </div>
          <div class="subbie-form-row">
            <label class="calc-label">Crew</label>
            ${crewOpts}
          </div>
          <div class="subbie-form-row">
            <label class="calc-label">Note</label>
            <input id="sj_note" class="calc-input" placeholder="Optional note…" value="${escHtml(v.note || '')}" />
          </div>
          <button class="calc-run-btn" id="sjSave">${editId ? 'Save Changes' : 'Add to Schedule'}</button>
          ${editId ? `<button class="subbie-btn subbie-btn--delete" id="sjDelete" style="margin-top:0.5rem;width:100%">Delete Job</button>` : ''}
        </div>
      </div>
    </div>`;

  overlay.classList.add('is-open');
  document.getElementById('sjClose')?.addEventListener('click', () => overlay.classList.remove('is-open'));
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('is-open'); });

  document.getElementById('sjDelete')?.addEventListener('click', () => {
    if (!confirm('Delete this job?')) return;
    deleteSchedJob(editId);
    overlay.classList.remove('is-open');
  });

  document.getElementById('sjSave')?.addEventListener('click', () => {
    const dropdown  = document.getElementById('sj_site')?.value || '';
    const custom    = (document.getElementById('sj_site_custom')?.value || '').trim();
    const site      = custom || dropdown;
    const startDate = document.getElementById('sj_start')?.value || todayStr;
    const endDate   = document.getElementById('sj_end')?.value   || startDate;

    if (!site) { showToast('Site name is required', 'error'); return; }
    if (endDate < startDate) { showToast('End date must be on or after start date', 'error'); return; }

    const checks     = [...document.querySelectorAll('.sched-crew-check:checked')].map(c => c.value);
    const extra      = (document.getElementById('sj_crew_extra')?.value || document.getElementById('sj_crew')?.value || '').trim();
    const extraNames = extra.split(',').map(s => s.trim()).filter(Boolean);
    const crewVal    = [...checks, ...extraNames].join(', ');

    const entry = {
      id:        editId || ('sj_' + Date.now()),
      site, startDate, endDate,
      crew:  crewVal,
      note:  (document.getElementById('sj_note')?.value || '').trim(),
    };

    const arr = loadSchedJobs();
    if (editId) {
      const idx = arr.findIndex(j => j.id === editId);
      if (idx !== -1) arr[idx] = entry; else arr.push(entry);
    } else {
      arr.push(entry);
    }

    saveSchedJobs(arr);
    overlay.classList.remove('is-open');
    renderScheduleTab();
    showToast(editId ? 'Job updated' : 'Job added to schedule', 'success', 2000);
  });
}

// ── Delete manual job ─────────────────────────────────────────────────────────
function deleteSchedJob(id) {
  if (!id) return;
  saveSchedJobs(loadSchedJobs().filter(j => j.id !== id));
  renderScheduleTab();
}

// ── Crew settings modal ───────────────────────────────────────────────────────
function openSchedCrewSettings() {
  let overlay = document.getElementById('schedCrewOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'schedCrewOverlay';
    overlay.className = 'ai-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    document.body.appendChild(overlay);
  }

  function renderCrewBody() {
    const crew = loadSchedCrew();
    return `
      <div class="sched-crew-list" id="schedCrewList">
        ${crew.length === 0 ? '<p class="sched-empty">No crew members added yet.</p>' : ''}
        ${crew.map((name, i) => `
          <div class="sched-crew-item">
            <span>${escHtml(name)}</span>
            <button class="sched-icon-btn sched-icon-btn--del" onclick="schedDeleteCrew(${i})">&#10005;</button>
          </div>`).join('')}
      </div>
      <div style="display:flex;gap:0.5rem;margin-top:0.8rem">
        <input id="schedNewCrewName" class="calc-input" placeholder="Crew member name" style="flex:1" />
        <button class="calc-run-btn" style="white-space:nowrap" onclick="schedAddCrew()">+ Add</button>
      </div>`;
  }

  overlay.innerHTML = `
    <div class="ai-modal">
      <div class="ai-modal-header">
        <span class="ai-modal-title">&#128101; Crew Members</span>
        <button class="btn-modal-close" onclick="document.getElementById('schedCrewOverlay').classList.remove('is-open')">&#10005;</button>
      </div>
      <div class="ai-modal-body" id="schedCrewBody">
        ${renderCrewBody()}
      </div>
    </div>`;

  overlay.classList.add('is-open');
  overlay._renderCrewBody = renderCrewBody;
}

window.schedDeleteCrew = function(idx) {
  const crew = loadSchedCrew();
  crew.splice(idx, 1);
  saveSchedCrew(crew);
  const ol = document.getElementById('schedCrewOverlay');
  const body = document.getElementById('schedCrewBody');
  if (body && ol?._renderCrewBody) body.innerHTML = ol._renderCrewBody();
};

window.schedAddCrew = function() {
  const inp  = document.getElementById('schedNewCrewName');
  const name = (inp?.value || '').trim();
  if (!name) return;
  const crew = loadSchedCrew();
  if (!crew.includes(name)) { crew.push(name); saveSchedCrew(crew); }
  inp.value = '';
  const ol = document.getElementById('schedCrewOverlay');
  const body = document.getElementById('schedCrewBody');
  if (body && ol?._renderCrewBody) body.innerHTML = ol._renderCrewBody();
};

// ── Expose globals for inline onclick ────────────────────────────────────────
window.openSchedJobForm      = openSchedJobForm;
window.deleteSchedJob        = deleteSchedJob;
window.openSchedCrewSettings = openSchedCrewSettings;
window.schedNavWeek          = schedNavWeek;
window.schedGoToday          = schedGoToday;
