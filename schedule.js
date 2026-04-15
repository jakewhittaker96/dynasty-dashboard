'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEDULE TAB — Simple Weekly Calendar
// 7 columns (Mon–Sun), job cards per day, localStorage + SM8 auto-populate
// ═══════════════════════════════════════════════════════════════════════════════

// ── localStorage helpers ──────────────────────────────────────────────────────
function loadSchedJobs()   { try { return JSON.parse(localStorage.getItem('dynasty-sched-jobs')   || '[]'); } catch { return []; } }
function saveSchedJobs(a)  { localStorage.setItem('dynasty-sched-jobs',   JSON.stringify(a)); }
function loadSchedCrew()   { try { return JSON.parse(localStorage.getItem('dynasty-sched-crew')   || '[]'); } catch { return []; } }
function saveSchedCrew(a)  { localStorage.setItem('dynasty-sched-crew',   JSON.stringify(a)); }

// ── Date helpers ──────────────────────────────────────────────────────────────
function schedDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function schedAddDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return schedDateStr(d);
}

function schedFmtDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

function schedMonWeek(dateStr) {
  // Returns YYYY-MM-DD of Monday for the week containing dateStr
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay(); // 0 = Sun
  const diff = day === 0 ? -6 : 1 - day; // Mon = 1
  d.setDate(d.getDate() + diff);
  return schedDateStr(d);
}

function schedJobColor(job) {
  const colors = ['#c9a84c', '#4c8bc9', '#4cc97a', '#c94c4c', '#9b4cc9', '#c9874c', '#4cc9c9'];
  let hash = 0;
  for (const ch of (job.site || job.title || '')) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

// ── State ─────────────────────────────────────────────────────────────────────
let schedWeekStart = schedMonWeek(schedDateStr(new Date())); // YYYY-MM-DD of current Monday

// ── Main render ───────────────────────────────────────────────────────────────
function renderScheduleTab() {
  const container = document.getElementById('viewSchedule');
  if (!container) return;

  const jobs  = loadSchedJobs();
  const today = schedDateStr(new Date());

  // Build week days array (Mon–Sun)
  const days = [];
  for (let i = 0; i < 7; i++) {
    days.push(schedAddDays(schedWeekStart, i));
  }

  const prevWeek = schedAddDays(schedWeekStart, -7);
  const nextWeek = schedAddDays(schedWeekStart, 7);

  // Week label
  const weekEnd = days[6];
  const weekLabel = `${new Date(schedWeekStart + 'T12:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} – ${new Date(weekEnd + 'T12:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  // Build columns
  const colsHtml = days.map(date => {
    const isToday = date === today;
    const dayJobs = jobs.filter(j => {
      if (!j.startDate || !j.endDate) return j.startDate === date;
      return date >= j.startDate && date <= j.endDate;
    });

    const cardsHtml = dayJobs.map(j => {
      const color = schedJobColor(j);
      const crew  = j.crew ? `<div class="scal-card-crew">👷 ${escHtml(j.crew)}</div>` : '';
      const note  = j.note ? `<div class="scal-card-note">${escHtml(j.note)}</div>` : '';
      const multi = j.startDate && j.endDate && j.startDate !== j.endDate
        ? `<div class="scal-card-multi">${schedFmtDate(j.startDate)} → ${schedFmtDate(j.endDate)}</div>` : '';
      return `
        <div class="scal-card" style="border-left-color:${color}" onclick="openSchedJobForm('${escHtml(j.id)}')">
          <div class="scal-card-title">${escHtml(j.site || j.title || 'Job')}</div>
          ${crew}${note}${multi}
          <button class="scal-card-del" title="Delete" onclick="event.stopPropagation();deleteSchedJob('${escHtml(j.id)}')">✕</button>
        </div>`;
    }).join('');

    const dayName = new Date(date + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'short' });
    const dayNum  = new Date(date + 'T12:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });

    return `
      <div class="scal-col${isToday ? ' scal-col--today' : ''}">
        <div class="scal-col-header">
          <span class="scal-day-name">${dayName}</span>
          <span class="scal-day-date">${dayNum}</span>
          ${isToday ? '<span class="scal-today-badge">Today</span>' : ''}
        </div>
        <div class="scal-col-body">
          ${cardsHtml}
          <button class="scal-add-btn" onclick="openSchedJobForm(null, '${date}')">+ Add</button>
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
        <button class="scal-add-all-btn" onclick="openSchedJobForm(null, null)">+ New Job</button>
        <button class="scal-crew-btn" onclick="openSchedCrewSettings()">&#128101; Crew</button>
      </div>
      <div class="scal-grid">
        ${colsHtml}
      </div>
    </div>`;
}

// ── Navigation ────────────────────────────────────────────────────────────────
function schedNavWeek(dir) {
  schedWeekStart = schedAddDays(schedWeekStart, dir * 7);
  renderScheduleTab();
}

function schedGoToday() {
  schedWeekStart = schedMonWeek(schedDateStr(new Date()));
  renderScheduleTab();
}

// ── Job form (add / edit) ─────────────────────────────────────────────────────
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

  const todayStr  = defaultDate || schedDateStr(new Date());
  const v = existing || { site: '', note: '', crew: '', startDate: todayStr, endDate: todayStr };

  // Populate site options from loaded sheet data
  const siteOpts = currentBySite
    ? ['', ...[...currentBySite.keys()]].map(s => `<option value="${escHtml(s)}"${(v.site || '') === s ? ' selected' : ''}>${escHtml(s || '— Select site —')}</option>`).join('')
    : `<option value="">— Select site —</option>`;

  const crewOpts = crew.length
    ? `<div class="sf-crew-checks">${crew.map(n => `<label class="sf-crew-check-lbl"><input type="checkbox" class="sched-crew-check" value="${escHtml(n)}"${(v.crew || '').includes(n) ? ' checked' : ''} style="accent-color:var(--gold)"> ${escHtml(n)}</label>`).join('')}</div><input id="sj_crew_extra" class="calc-input" style="margin-top:0.4rem" placeholder="Other crew (optional)" value="${escHtml((v.crew || '').split(',').filter(n => !crew.includes(n.trim())).join(', '))}" />`
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
    const dropdown   = document.getElementById('sj_site')?.value || '';
    const custom     = (document.getElementById('sj_site_custom')?.value || '').trim();
    const site       = custom || dropdown;
    const startDate  = document.getElementById('sj_start')?.value || todayStr;
    const endDate    = document.getElementById('sj_end')?.value   || startDate;

    if (!site) { showToast('Site name is required', 'error'); return; }
    if (endDate < startDate) { showToast('End date must be on or after start date', 'error'); return; }

    // Crew: checkboxes + extra field
    let crewVal;
    const checks = [...document.querySelectorAll('.sched-crew-check:checked')].map(c => c.value);
    const extra  = (document.getElementById('sj_crew_extra')?.value || document.getElementById('sj_crew')?.value || '').trim();
    const extraNames = extra.split(',').map(s => s.trim()).filter(Boolean);
    crewVal = [...checks, ...extraNames].join(', ');

    const entry = {
      id:        editId || ('sj_' + Date.now()),
      site,
      startDate,
      endDate,
      crew:      crewVal,
      note:      (document.getElementById('sj_note')?.value || '').trim(),
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

// ── Delete job ────────────────────────────────────────────────────────────────
function deleteSchedJob(id) {
  if (!id) return;
  const arr = loadSchedJobs().filter(j => j.id !== id);
  saveSchedJobs(arr);
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
  const body = document.getElementById('schedCrewBody');
  const ol   = document.getElementById('schedCrewOverlay');
  if (body && ol && ol._renderCrewBody) body.innerHTML = ol._renderCrewBody();
};

window.schedAddCrew = function() {
  const inp  = document.getElementById('schedNewCrewName');
  const name = (inp?.value || '').trim();
  if (!name) return;
  const crew = loadSchedCrew();
  if (!crew.includes(name)) { crew.push(name); saveSchedCrew(crew); }
  inp.value = '';
  const body = document.getElementById('schedCrewBody');
  const ol   = document.getElementById('schedCrewOverlay');
  if (body && ol && ol._renderCrewBody) body.innerHTML = ol._renderCrewBody();
};

// ── Expose functions for inline onclick ──────────────────────────────────────
window.openSchedJobForm       = openSchedJobForm;
window.deleteSchedJob         = deleteSchedJob;
window.openSchedCrewSettings  = openSchedCrewSettings;
window.schedNavWeek           = schedNavWeek;
window.schedGoToday           = schedGoToday;
