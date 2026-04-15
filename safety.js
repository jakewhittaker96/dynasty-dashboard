'use strict';

// ── Safety Logger — extracted from app.js ─────────────────────────────────────
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
