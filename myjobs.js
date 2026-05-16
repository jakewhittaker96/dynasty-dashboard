'use strict';

// ── My Jobs — built-in localStorage job database ──────────────────────────────
// Powers the new Pipeline kanban, Finance money-owed sections, Quick Add Job
// modal, Job Detail modal, and a localStorage-backed view in the Jobs tab.
// Independent of ServiceM8.

(function () {

  const STORAGE_KEY = 'dynastyJobs';

  const STATUSES = [
    'Quote Sent',
    'Deposit Received',
    'In Progress',
    'Invoice Sent',
    'Paid',
    'Lost',
  ];

  // Maps status → CSS slug (used by kanban columns & badges)
  const STATUS_SLUG = {
    'Quote Sent':       'quotes',
    'Deposit Received': 'deposit',
    'In Progress':      'progress',
    'Invoice Sent':     'invoice',
    'Paid':             'paid',
    'Lost':             'lost',
  };

  const JOB_TYPES = [
    'Brick Veneer',
    'Double Brick',
    'Retaining Wall',
    'Block Work',
    'Footing',
    'Fence',
    'Pressure Clean',
    'Other',
  ];

  // ─── Tiny utility helpers ──────────────────────────────────────────────────
  const esc = s => (typeof escHtml === 'function')
    ? escHtml(s)
    : String(s == null ? '' : s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const money = n => '$' + Number(n || 0).toLocaleString('en-AU',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function daysSince(iso) {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    if (isNaN(t)) return null;
    return Math.floor((Date.now() - t) / 86400000);
  }

  function fmtDateInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  function fmtDateDisplay(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function todayIso() { return new Date().toISOString(); }

  // ─── Storage CRUD ──────────────────────────────────────────────────────────
  function loadAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }

  function saveAll(jobs) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
  }

  function get(id) {
    return loadAll().find(j => j.id === id) || null;
  }

  function nextRef(all, prefix) {
    const max = all.reduce((m, j) => {
      const ref = prefix === 'Q-' ? j.quoteRef : j.invoiceRef;
      const n = parseInt(String(ref || '').replace(prefix, ''), 10);
      return Number.isFinite(n) && n > m ? n : m;
    }, 1000);
    return prefix + (max + 1);
  }

  function upsert(job) {
    const all = loadAll();
    if (!job.id) {
      job.id = 'j_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      job.dateCreated = job.dateCreated || todayIso();
      if (!job.quoteRef) job.quoteRef = nextRef(all, 'Q-');
      all.push(job);
    } else {
      const idx = all.findIndex(j => j.id === job.id);
      if (idx >= 0) all[idx] = job; else all.push(job);
    }
    saveAll(all);
    return job;
  }

  function remove(id) {
    saveAll(loadAll().filter(j => j.id !== id));
  }

  // Recalculate deposit/balance amounts when quoteAmount changes
  function recalcSplit(job) {
    const q = Number(job.quoteAmount || 0);
    // Only auto-recompute if amounts look like the 30/70 default
    const expectedDeposit = +(q * 0.30).toFixed(2);
    const expectedBalance = +(q * 0.70).toFixed(2);
    if (job.depositAmount == null || job.depositAmount === '' ||
        Math.abs(Number(job.depositAmount) + Number(job.balanceAmount || 0) - q) > 0.5) {
      job.depositAmount = expectedDeposit;
      job.balanceAmount = expectedBalance;
    }
  }

  // ─── Aggregate helpers used by Finance + KPIs ──────────────────────────────
  function depositsOutstanding() {
    return loadAll().filter(j => j.status === 'Deposit Received'
      ? false
      : (j.status === 'Quote Sent' && false) // explicit: depositPaid means received
    );
  }

  // "Deposit Due" = quote accepted, deposit not yet paid.
  // We represent that as status === 'Deposit Received' with depositPaid=false initially.
  // Simpler: any job with depositPaid=false AND status in [Deposit Received, In Progress, Invoice Sent, Paid]
  function rowsDepositOutstanding() {
    return loadAll().filter(j =>
      !j.depositPaid &&
      (j.status === 'Deposit Received' || j.status === 'In Progress' ||
       j.status === 'Invoice Sent'    || j.status === 'Paid')
    );
  }

  function rowsInvoiceOutstanding() {
    return loadAll().filter(j =>
      !j.balancePaid &&
      (j.status === 'Invoice Sent' || j.status === 'Paid')
    ).filter(j => !(j.status === 'Paid' && j.balancePaid));
    // Defensive — anything with status Invoice Sent and balance unpaid.
  }

  function rowsQuotesInPipeline() {
    return loadAll().filter(j => j.status === 'Quote Sent');
  }

  function rowsPaidThisMonth() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return loadAll().filter(j => {
      if (j.status !== 'Paid') return false;
      const t = new Date(j.dateCompleted || j.dateCreated || 0).getTime();
      return !isNaN(t) && t >= start;
    });
  }

  function sumDeposits(rows) {
    return rows.reduce((s, j) => s + Number(j.depositAmount || 0), 0);
  }
  function sumBalances(rows) {
    return rows.reduce((s, j) => s + Number(j.balanceAmount || j.quoteAmount || 0), 0);
  }
  function sumQuotes(rows) {
    return rows.reduce((s, j) => s + Number(j.quoteAmount || 0), 0);
  }

  // ─── Pipeline kanban ───────────────────────────────────────────────────────
  function renderPipeline() {
    const root = document.getElementById('viewPipeline');
    if (!root) return;
    const jobs = loadAll();

    const cols = STATUSES.map(status => {
      const colJobs = jobs.filter(j => j.status === status);
      const slug    = STATUS_SLUG[status];
      const cards   = colJobs.length
        ? colJobs.map(jobCardHtml).join('')
        : '<div class="kanban-empty">No jobs</div>';
      return `
        <div class="kanban-col kanban-col--${slug}">
          <div class="kanban-col-header">
            <span class="kanban-col-title">${esc(status.toUpperCase())}</span>
            <span class="kanban-col-count">${colJobs.length}</span>
          </div>
          <div class="kanban-col-body">${cards}</div>
        </div>`;
    }).join('');

    root.innerHTML = `
      <section class="jobs-section">
        <div class="myjobs-header-row">
          <div class="sm8-section-label" style="margin:0">My Jobs Pipeline</div>
          <button class="btn-quick-add" id="btnQuickAddPipeline">+ Quick Add Job</button>
        </div>
        ${jobs.length === 0
          ? '<div class="myjobs-empty">No jobs yet. Click <strong>Quick Add Job</strong> to create your first one.</div>'
          : ''}
        <div class="kanban-board">${cols}</div>
      </section>`;

    bindCardClicks(root);
    const qa = document.getElementById('btnQuickAddPipeline');
    if (qa) qa.addEventListener('click', openQuickAddModal);
  }

  function jobCardHtml(j) {
    const slug = STATUS_SLUG[j.status] || 'quotes';
    return `
      <div class="job-card job-card--${slug}" data-job-id="${esc(j.id)}" role="button" tabindex="0">
        <div class="job-card-name">${esc(j.clientName || '—')}</div>
        <div class="job-card-meta">${esc(j.jobAddress || '')}</div>
        <div class="job-card-meta job-card-meta--type">${esc(j.jobType || '')}</div>
        <div class="job-card-foot">
          <span class="job-card-amount">${money(j.quoteAmount)}</span>
          <span class="job-card-badge job-card-badge--${slug}">${esc(j.status)}</span>
        </div>
      </div>`;
  }

  function bindCardClicks(root) {
    root.querySelectorAll('.job-card[data-job-id]').forEach(el => {
      const open = () => openDetailModal(el.dataset.jobId);
      el.addEventListener('click', open);
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
    });
  }

  // ─── Finance: Money Owed / Quotes In Pipeline / Paid This Month ────────────
  function renderFinanceSections() {
    const finance = document.getElementById('viewFinance');
    if (!finance) return;

    // Insert / replace a dedicated container at the top of #viewFinance
    let host = document.getElementById('myjobsFinanceHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'myjobsFinanceHost';
      const section = finance.querySelector('.jobs-section') || finance;
      section.insertBefore(host, section.firstChild);
    }

    const depRows = rowsDepositOutstanding();
    const invRows = rowsInvoiceOutstanding();
    const quoteRows = rowsQuotesInPipeline();
    const paidRows  = rowsPaidThisMonth();

    const depTotal = sumDeposits(depRows);
    const invTotal = sumBalances(invRows);
    const owedTotal = depTotal + invTotal;
    const quotesTotal = sumQuotes(quoteRows);
    const paidTotal = paidRows.reduce((s, j) => s + Number(j.quoteAmount || 0), 0);

    host.innerHTML = `
      <div class="myjobs-finance">
        <div class="myjobs-header-row">
          <div class="sm8-section-label" style="margin:0">&#128176; Money Owed to Me</div>
          <button class="btn-quick-add" id="btnQuickAddFinance">+ Quick Add Job</button>
        </div>

        <div class="owed-summary">
          <div class="owed-summary-card owed-summary-card--deposit">
            <div class="owed-summary-label">Deposits Outstanding</div>
            <div class="owed-summary-value">${money(depTotal)}</div>
            <div class="owed-summary-sub">${depRows.length} job${depRows.length===1?'':'s'}</div>
          </div>
          <div class="owed-summary-card owed-summary-card--invoice">
            <div class="owed-summary-label">Invoices Outstanding</div>
            <div class="owed-summary-value">${money(invTotal)}</div>
            <div class="owed-summary-sub">${invRows.length} job${invRows.length===1?'':'s'}</div>
          </div>
          <div class="owed-summary-card owed-summary-card--total">
            <div class="owed-summary-label">Total Outstanding</div>
            <div class="owed-summary-value">${money(owedTotal)}</div>
          </div>
        </div>

        ${owedTable('Deposits Outstanding', depRows, 'deposit')}
        ${owedTable('Invoices Outstanding', invRows, 'invoice')}

        <div class="sm8-section-label" style="margin-top:1.5rem">&#128203; Quotes in Pipeline</div>
        <div class="myjobs-table-card">
          <div class="myjobs-table-total">Total pipeline value: <strong>${money(quotesTotal)}</strong></div>
          ${quoteRows.length === 0
            ? '<div class="myjobs-empty">No quotes out at the moment.</div>'
            : `<table class="myjobs-table"><thead><tr>
                  <th>Client</th><th>Address</th><th>Job Type</th><th>Quote Amount</th><th>Days Out</th><th></th>
                </tr></thead><tbody>${quoteRows.map(j => `
                  <tr data-job-id="${esc(j.id)}" class="myjobs-row">
                    <td>${esc(j.clientName || '—')}</td>
                    <td>${esc(j.jobAddress || '—')}</td>
                    <td>${esc(j.jobType || '—')}</td>
                    <td>${money(j.quoteAmount)}</td>
                    <td>${daysSince(j.dateQuoteSent || j.dateCreated) ?? '—'}d</td>
                    <td><button class="myjobs-row-btn" data-action="open">View</button></td>
                  </tr>`).join('')}</tbody></table>`}
        </div>

        <div class="sm8-section-label" style="margin-top:1.5rem">&#10003; Paid This Month</div>
        <div class="myjobs-table-card">
          <div class="myjobs-table-total">Collected this month: <strong>${money(paidTotal)}</strong></div>
          ${paidRows.length === 0
            ? '<div class="myjobs-empty">No payments collected yet this month.</div>'
            : `<table class="myjobs-table"><thead><tr>
                  <th>Client</th><th>Address</th><th>Job Type</th><th>Amount</th><th>Date Paid</th>
                </tr></thead><tbody>${paidRows.map(j => `
                  <tr data-job-id="${esc(j.id)}" class="myjobs-row">
                    <td>${esc(j.clientName || '—')}</td>
                    <td>${esc(j.jobAddress || '—')}</td>
                    <td>${esc(j.jobType || '—')}</td>
                    <td>${money(j.quoteAmount)}</td>
                    <td>${fmtDateDisplay(j.dateCompleted)}</td>
                  </tr>`).join('')}</tbody></table>`}
        </div>
      </div>`;

    host.querySelector('#btnQuickAddFinance')?.addEventListener('click', openQuickAddModal);
    host.querySelectorAll('.myjobs-row').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('button[data-action="chase"]')) return;
        openDetailModal(row.dataset.jobId);
      });
    });
    host.querySelectorAll('button[data-action="chase"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = btn.closest('[data-job-id]')?.dataset.jobId;
        const kind = btn.dataset.kind;
        if (id) chaseJob(id, kind, btn);
      });
    });
  }

  function owedTable(title, rows, kind) {
    const refField = kind === 'deposit' ? 'dateQuoteSent' : 'dateCompleted';
    const dayLabel = kind === 'deposit' ? 'Days Since Quote' : 'Days Overdue';
    const amtField = kind === 'deposit' ? 'depositAmount' : 'balanceAmount';
    return `
      <div class="myjobs-owed-section">
        <div class="myjobs-owed-title">${esc(title)}</div>
        ${rows.length === 0
          ? '<div class="myjobs-empty">Nothing outstanding here.</div>'
          : `<table class="myjobs-table"><thead><tr>
                <th>Client</th><th>Address</th><th>Job</th><th>Amount</th><th>${dayLabel}</th><th></th>
              </tr></thead><tbody>${rows.map(j => {
                const days = daysSince(j[refField]) ?? '—';
                return `
                  <tr data-job-id="${esc(j.id)}" class="myjobs-row">
                    <td>${esc(j.clientName || '—')}</td>
                    <td>${esc(j.jobAddress || '—')}</td>
                    <td>${esc(j.jobType || '—')}</td>
                    <td>${money(j[amtField] || (kind === 'invoice' ? j.quoteAmount : 0))}</td>
                    <td>${days}${days === '—' ? '' : 'd'}</td>
                    <td>
                      <button class="chase-btn" data-action="chase" data-kind="${kind}">Chase</button>
                    </td>
                  </tr>`;
              }).join('')}</tbody></table>`}
      </div>`;
  }

  function chaseJob(id, kind, btn) {
    const job = get(id);
    if (!job) return;
    const amt = kind === 'deposit'
      ? Number(job.depositAmount || 0)
      : Number(job.balanceAmount || job.quoteAmount || 0);
    const label = kind === 'deposit' ? `Deposit of ${money(amt)}` : `Invoice of ${money(amt)}`;
    const msg = `Hi ${job.clientName || 'there'}, just following up on ${job.jobType || 'your job'} at ${job.jobAddress || ''}. ${label} is outstanding. Please get in touch to arrange payment.`;
    copyText(msg, btn);
  }

  function copyText(text, srcBtn) {
    const done = () => {
      if (!srcBtn) return;
      const orig = srcBtn.textContent;
      srcBtn.textContent = 'Copied ✓';
      srcBtn.classList.add('chase-btn--done');
      setTimeout(() => {
        srcBtn.textContent = orig;
        srcBtn.classList.remove('chase-btn--done');
      }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }
  function fallbackCopy(text, cb) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(ta); cb && cb();
  }

  // ─── My Jobs table (for the Jobs tab) ──────────────────────────────────────
  function renderMyJobsTable(tbody, opts = {}) {
    const jobs = loadAll();
    const includeSource = opts.combined && Array.isArray(opts.sm8Jobs);

    const rows = jobs.map(j => `
      <tr data-job-id="${esc(j.id)}" class="myjobs-row">
        ${includeSource ? '<td><span class="src-pill src-pill--mine">My Job</span></td>' : ''}
        <td>${esc(j.clientName || '—')}</td>
        <td>${esc(j.jobAddress || '—')}</td>
        <td>${esc(j.jobType || '—')}</td>
        <td>${money(j.quoteAmount)}</td>
        <td><span class="status-badge status-badge--${STATUS_SLUG[j.status] || 'quotes'}">${esc(j.status)}</span></td>
        <td>${j.depositPaid ? '<span class="paid-pip">Deposit ✓</span>' : ''}
            ${j.balancePaid ? '<span class="paid-pip">Balance ✓</span>' : ''}</td>
        <td>${fmtDateDisplay(j.dateCreated)}</td>
        <td><button class="myjobs-row-btn" data-action="open">Open</button></td>
      </tr>`).join('');

    tbody.innerHTML = rows || `<tr><td colspan="${includeSource ? 9 : 8}" class="table-empty">No jobs yet — click Quick Add Job to create one.</td></tr>`;

    tbody.querySelectorAll('.myjobs-row').forEach(row => {
      row.addEventListener('click', () => openDetailModal(row.dataset.jobId));
    });
  }

  // ─── Quick Add Job modal ───────────────────────────────────────────────────
  function ensureQuickAddModal() {
    if (document.getElementById('quickAddOverlay')) return;
    const html = `
      <div id="quickAddOverlay" class="ai-modal-overlay" role="dialog" aria-modal="true">
        <div class="ai-modal">
          <div class="ai-modal-header">
            <span class="ai-modal-title">+ Quick Add Job</span>
            <button class="btn-modal-close" id="quickAddClose" aria-label="Close">&#10005;</button>
          </div>
          <div class="ai-modal-body">
            <div class="subbie-form">
              <div class="subbie-form-row">
                <label class="calc-label">Client Name <span style="color:#e05252">*</span></label>
                <input id="qa_clientName" class="calc-input" placeholder="e.g. John Smith" />
              </div>
              <div class="subbie-form-row">
                <label class="calc-label">Phone</label>
                <input id="qa_clientPhone" class="calc-input" placeholder="0412 345 678" />
              </div>
              <div class="subbie-form-row">
                <label class="calc-label">Job Address</label>
                <input id="qa_jobAddress" class="calc-input" placeholder="12 Main St, Goulburn NSW" />
              </div>
              <div class="subbie-form-row">
                <label class="calc-label">Job Type</label>
                <select id="qa_jobType" class="calc-input">
                  ${JOB_TYPES.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
                </select>
              </div>
              <div class="subbie-form-row">
                <label class="calc-label">Quote Amount ($)</label>
                <input id="qa_quoteAmount" class="calc-input" type="number" min="0" step="0.01" placeholder="0.00" />
              </div>
              <div class="subbie-form-row">
                <label class="calc-label">Estimated Start Date</label>
                <input id="qa_startDate" class="calc-input" type="date" />
              </div>
            </div>
            <button class="calc-run-btn" id="qa_save" style="margin-top:1rem">&#10003; Create Job</button>
            <p class="settings-msg" id="qa_msg"></p>
          </div>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    document.getElementById('quickAddClose').addEventListener('click', closeQuickAddModal);
    document.getElementById('quickAddOverlay').addEventListener('click', e => {
      if (e.target.id === 'quickAddOverlay') closeQuickAddModal();
    });
    document.getElementById('qa_save').addEventListener('click', submitQuickAdd);
  }

  function openQuickAddModal() {
    ensureQuickAddModal();
    document.getElementById('qa_clientName').value = '';
    document.getElementById('qa_clientPhone').value = '';
    document.getElementById('qa_jobAddress').value = '';
    document.getElementById('qa_jobType').value = JOB_TYPES[0];
    document.getElementById('qa_quoteAmount').value = '';
    document.getElementById('qa_startDate').value = '';
    document.getElementById('qa_msg').textContent = '';
    document.getElementById('quickAddOverlay').classList.add('is-open');
  }
  function closeQuickAddModal() {
    const o = document.getElementById('quickAddOverlay');
    if (o) o.classList.remove('is-open');
  }

  function submitQuickAdd() {
    const name = document.getElementById('qa_clientName').value.trim();
    const msgEl = document.getElementById('qa_msg');
    if (!name) {
      msgEl.textContent = 'Client name is required.';
      msgEl.style.color = '#e05252';
      return;
    }
    const quote = Number(document.getElementById('qa_quoteAmount').value || 0);
    const start = document.getElementById('qa_startDate').value;
    const job = {
      clientName:   name,
      clientPhone:  document.getElementById('qa_clientPhone').value.trim(),
      clientEmail:  '',
      jobAddress:   document.getElementById('qa_jobAddress').value.trim(),
      jobType:      document.getElementById('qa_jobType').value,
      description:  '',
      quoteAmount:  quote,
      depositAmount: +(quote * 0.30).toFixed(2),
      depositPaid:   false,
      balanceAmount: +(quote * 0.70).toFixed(2),
      balancePaid:   false,
      status:        'Quote Sent',
      invoiceRef:    '',
      dateCreated:   todayIso(),
      dateQuoteSent: todayIso(),
      dateStarted:   start ? new Date(start).toISOString() : '',
      dateCompleted: '',
      notes:         '',
    };
    upsert(job);
    closeQuickAddModal();
    refreshActiveView();
  }

  // ─── Job Detail / Edit modal ───────────────────────────────────────────────
  function ensureDetailModal() {
    if (document.getElementById('jobDetailOverlay')) return;
    const html = `
      <div id="jobDetailOverlay" class="ai-modal-overlay" role="dialog" aria-modal="true">
        <div class="ai-modal ai-modal--wide">
          <div class="ai-modal-header">
            <span class="ai-modal-title" id="jd_title">Job Detail</span>
            <button class="btn-modal-close" id="jd_close" aria-label="Close">&#10005;</button>
          </div>
          <div class="ai-modal-body">
            <div class="jd-grid">
              <div class="subbie-form-row">
                <label class="calc-label">Status</label>
                <select id="jd_status" class="calc-input">
                  ${STATUSES.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
                </select>
              </div>
              <div class="subbie-form-row">
                <label class="calc-label">Job Type</label>
                <select id="jd_jobType" class="calc-input">
                  ${JOB_TYPES.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
                </select>
              </div>
              <div class="subbie-form-row">
                <label class="calc-label">Client Name</label>
                <input id="jd_clientName" class="calc-input" />
              </div>
              <div class="subbie-form-row">
                <label class="calc-label">Phone</label>
                <input id="jd_clientPhone" class="calc-input" />
              </div>
              <div class="subbie-form-row">
                <label class="calc-label">Email</label>
                <input id="jd_clientEmail" class="calc-input" type="email" />
              </div>
              <div class="subbie-form-row">
                <label class="calc-label">Job Address</label>
                <input id="jd_jobAddress" class="calc-input" />
              </div>
              <div class="subbie-form-row jd-row-full">
                <label class="calc-label">Description</label>
                <textarea id="jd_description" class="calc-input" rows="2"></textarea>
              </div>
              <div class="subbie-form-row">
                <label class="calc-label">Quote Amount ($)</label>
                <input id="jd_quoteAmount" class="calc-input" type="number" min="0" step="0.01" />
              </div>
              <div class="subbie-form-row">
                <label class="calc-label">Quote Ref</label>
                <input id="jd_quoteRef" class="calc-input" />
              </div>
              <div class="subbie-form-row">
                <label class="calc-label">Deposit ($)</label>
                <input id="jd_depositAmount" class="calc-input" type="number" min="0" step="0.01" />
              </div>
              <div class="subbie-form-row">
                <label class="calc-label">Balance ($)</label>
                <input id="jd_balanceAmount" class="calc-input" type="number" min="0" step="0.01" />
              </div>
              <div class="subbie-form-row">
                <label class="jd-check"><input type="checkbox" id="jd_depositPaid" /> Deposit Paid</label>
              </div>
              <div class="subbie-form-row">
                <label class="jd-check"><input type="checkbox" id="jd_balancePaid" /> Balance Paid</label>
              </div>
              <div class="subbie-form-row">
                <label class="calc-label">Invoice Ref</label>
                <input id="jd_invoiceRef" class="calc-input" placeholder="auto on Invoice Sent" />
              </div>
              <div class="subbie-form-row">
                <label class="calc-label">Quote Sent Date</label>
                <input id="jd_dateQuoteSent" class="calc-input" type="date" />
              </div>
              <div class="subbie-form-row">
                <label class="calc-label">Start Date</label>
                <input id="jd_dateStarted" class="calc-input" type="date" />
              </div>
              <div class="subbie-form-row">
                <label class="calc-label">Completed Date</label>
                <input id="jd_dateCompleted" class="calc-input" type="date" />
              </div>
              <div class="subbie-form-row jd-row-full">
                <label class="calc-label">Notes</label>
                <textarea id="jd_notes" class="calc-input" rows="3" placeholder="Internal notes…"></textarea>
              </div>
            </div>
            <div class="jd-actions">
              <button class="calc-run-btn" id="jd_save">&#10003; Save Changes</button>
              <button class="jd-delete-btn" id="jd_delete">&#128465; Delete Job</button>
            </div>
            <p class="settings-msg" id="jd_msg"></p>
          </div>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    document.getElementById('jd_close').addEventListener('click', closeDetailModal);
    document.getElementById('jobDetailOverlay').addEventListener('click', e => {
      if (e.target.id === 'jobDetailOverlay') closeDetailModal();
    });
    document.getElementById('jd_save').addEventListener('click', submitDetail);
    document.getElementById('jd_delete').addEventListener('click', deleteDetail);
    document.getElementById('jd_quoteAmount').addEventListener('blur', () => {
      // Auto-suggest 30/70 split if user blanks deposit/balance
      const q = Number(document.getElementById('jd_quoteAmount').value || 0);
      const dep = document.getElementById('jd_depositAmount');
      const bal = document.getElementById('jd_balanceAmount');
      if (!dep.value) dep.value = (q * 0.30).toFixed(2);
      if (!bal.value) bal.value = (q * 0.70).toFixed(2);
    });
  }

  let _currentDetailId = null;

  function openDetailModal(id) {
    ensureDetailModal();
    const job = get(id);
    if (!job) return;
    _currentDetailId = id;

    document.getElementById('jd_title').textContent =
      `${job.quoteRef || ''} — ${job.clientName || 'Job'}`;
    document.getElementById('jd_status').value         = job.status || 'Quote Sent';
    document.getElementById('jd_jobType').value        = job.jobType || JOB_TYPES[0];
    document.getElementById('jd_clientName').value     = job.clientName || '';
    document.getElementById('jd_clientPhone').value    = job.clientPhone || '';
    document.getElementById('jd_clientEmail').value    = job.clientEmail || '';
    document.getElementById('jd_jobAddress').value     = job.jobAddress || '';
    document.getElementById('jd_description').value    = job.description || '';
    document.getElementById('jd_quoteAmount').value    = job.quoteAmount ?? '';
    document.getElementById('jd_quoteRef').value       = job.quoteRef || '';
    document.getElementById('jd_depositAmount').value  = job.depositAmount ?? '';
    document.getElementById('jd_balanceAmount').value  = job.balanceAmount ?? '';
    document.getElementById('jd_depositPaid').checked  = !!job.depositPaid;
    document.getElementById('jd_balancePaid').checked  = !!job.balancePaid;
    document.getElementById('jd_invoiceRef').value     = job.invoiceRef || '';
    document.getElementById('jd_dateQuoteSent').value  = fmtDateInput(job.dateQuoteSent);
    document.getElementById('jd_dateStarted').value    = fmtDateInput(job.dateStarted);
    document.getElementById('jd_dateCompleted').value  = fmtDateInput(job.dateCompleted);
    document.getElementById('jd_notes').value          = job.notes || '';
    document.getElementById('jd_msg').textContent      = '';

    document.getElementById('jobDetailOverlay').classList.add('is-open');
  }

  function closeDetailModal() {
    const o = document.getElementById('jobDetailOverlay');
    if (o) o.classList.remove('is-open');
    _currentDetailId = null;
  }

  function submitDetail() {
    if (!_currentDetailId) return;
    const job = get(_currentDetailId);
    if (!job) return;

    job.status        = document.getElementById('jd_status').value;
    job.jobType       = document.getElementById('jd_jobType').value;
    job.clientName    = document.getElementById('jd_clientName').value.trim();
    job.clientPhone   = document.getElementById('jd_clientPhone').value.trim();
    job.clientEmail   = document.getElementById('jd_clientEmail').value.trim();
    job.jobAddress    = document.getElementById('jd_jobAddress').value.trim();
    job.description   = document.getElementById('jd_description').value.trim();
    job.quoteAmount   = Number(document.getElementById('jd_quoteAmount').value || 0);
    job.quoteRef      = document.getElementById('jd_quoteRef').value.trim();
    job.depositAmount = Number(document.getElementById('jd_depositAmount').value || 0);
    job.balanceAmount = Number(document.getElementById('jd_balanceAmount').value || 0);
    job.depositPaid   = document.getElementById('jd_depositPaid').checked;
    job.balancePaid   = document.getElementById('jd_balancePaid').checked;
    job.notes         = document.getElementById('jd_notes').value;

    const dqs = document.getElementById('jd_dateQuoteSent').value;
    const dst = document.getElementById('jd_dateStarted').value;
    const dcp = document.getElementById('jd_dateCompleted').value;
    job.dateQuoteSent = dqs ? new Date(dqs).toISOString() : '';
    job.dateStarted   = dst ? new Date(dst).toISOString() : '';
    job.dateCompleted = dcp ? new Date(dcp).toISOString() : '';

    // Auto-generate invoice ref when transitioning to Invoice Sent
    let invRef = document.getElementById('jd_invoiceRef').value.trim();
    if (job.status === 'Invoice Sent' && !invRef) {
      invRef = nextRef(loadAll(), 'INV-');
    }
    job.invoiceRef = invRef;

    // Auto-set completion date when transitioning to Paid
    if (job.status === 'Paid' && !job.dateCompleted) {
      job.dateCompleted = todayIso();
    }

    upsert(job);
    closeDetailModal();
    refreshActiveView();
  }

  function deleteDetail() {
    if (!_currentDetailId) return;
    if (!confirm('Delete this job? This cannot be undone.')) return;
    remove(_currentDetailId);
    closeDetailModal();
    refreshActiveView();
  }

  // ─── Active-view refresher ─────────────────────────────────────────────────
  function refreshActiveView() {
    const view = (typeof activeTab === 'string') ? activeTab : null;
    if (view === '__pipeline__') renderPipeline();
    else if (view === '__finance__') {
      renderFinanceSections();
      // also re-render SM8 finance if present
      if (typeof renderFinanceTabContent === 'function' && typeof jobsLoaded !== 'undefined' && jobsLoaded) {
        try { renderFinanceTabContent(); } catch {}
      }
    } else if (view === '__jobs__') {
      if (typeof renderJobsSource === 'function') renderJobsSource();
    } else if (view === '__all__') {
      if (typeof renderAllJobs === 'function' && typeof currentBySite !== 'undefined') {
        renderAllJobs(currentBySite);
      }
    }
  }

  // ─── Jobs tab — source toggle (My Jobs / ServiceM8 / All) ──────────────────
  let _jobsSource = 'mine';

  function bindJobsToggleOnce() {
    const toggle = document.getElementById('jobsSourceToggle');
    if (!toggle || toggle._bound) return;
    toggle._bound = true;
    toggle.querySelectorAll('.jobs-source-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _jobsSource = btn.dataset.src;
        toggle.querySelectorAll('.jobs-source-btn').forEach(b =>
          b.classList.toggle('jobs-source-btn--active', b === btn));
        renderJobsSourceImpl();
      });
    });
    document.getElementById('btnQuickAddJobs')?.addEventListener('click', openQuickAddModal);
  }

  function renderJobsSourceImpl() {
    bindJobsToggleOnce();
    const sm8Wrap = document.getElementById('sm8JobsWrap');
    const mineWrap = document.getElementById('myJobsWrap');
    if (!sm8Wrap || !mineWrap) return;

    if (_jobsSource === 'sm8') {
      sm8Wrap.hidden  = false;
      mineWrap.hidden = true;
      if (typeof loadServiceM8Data === 'function') loadServiceM8Data('__jobs__');
      return;
    }
    if (_jobsSource === 'mine') {
      sm8Wrap.hidden  = true;
      mineWrap.hidden = false;
      const head = document.getElementById('myJobsTableHead');
      const tbody = document.getElementById('myJobsTableBody');
      if (head) head.innerHTML = `
        <th>Client</th><th>Address</th><th>Job Type</th>
        <th>Quote</th><th>Status</th><th>Payment</th>
        <th>Created</th><th></th>`;
      renderMyJobsTable(tbody);
      return;
    }
    // _jobsSource === 'all' — show both: My Jobs table on top, SM8 below
    sm8Wrap.hidden  = false;
    mineWrap.hidden = false;
    const head = document.getElementById('myJobsTableHead');
    const tbody = document.getElementById('myJobsTableBody');
    if (head) head.innerHTML = `
      <th>Source</th><th>Client</th><th>Address</th><th>Job Type</th>
      <th>Quote</th><th>Status</th><th>Payment</th>
      <th>Created</th><th></th>`;
    renderMyJobsTable(tbody, { combined: true, sm8Jobs: [] });
    if (typeof loadServiceM8Data === 'function') loadServiceM8Data('__jobs__');
  }

  window.renderJobsSource = renderJobsSourceImpl;

  // ─── Public surface ────────────────────────────────────────────────────────
  window.MyJobs = {
    STATUSES, STATUS_SLUG, JOB_TYPES,
    list: loadAll,
    get,
    upsert,
    remove,
    recalcSplit,
    renderPipeline,
    renderFinanceSections,
    renderMyJobsTable,
    openQuickAddModal,
    openDetailModal,
    refresh: refreshActiveView,
    money,
    fmtDateDisplay,
  };
})();
