'use strict';

// ── AI Chat, Weekly Summary, Chase Modal, Profit Intelligence, Payroll, Plan Reader
// ── Extracted from app.js ─────────────────────────────────────────────────────
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
